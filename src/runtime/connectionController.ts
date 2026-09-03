import { buildHttpUrl, createRequestId, utf8ByteLength, type ConnectionSettings } from '../lib/todex';
import { ConnectionError, ConnectionErrorType } from '../lib/connectionError';
import {
  inspectServerUrl,
  nextReconnectDelayMs,
  probeBackendConnection,
  type BackendProbeResult,
} from '../lib/connectionProbe';
import { MAX_LEGACY_MESSAGE_BYTES } from '../lib/transport';
import { createTransportCryptoSession, type TransportCryptoSession } from '../lib/transportCrypto';
import { buildV2WebSocketUrlWithOptions } from '../lib/v2';
import {
  CONNECTION_HEALTH_INTERVAL_MS,
  CONNECTION_HEALTH_TIMEOUT_MS,
  defaultConnectionHealth,
  type ConnectionHealth,
  type ConnectionState,
} from '../lib/connectionState';
import type { PendingSocketFrame } from '../lib/appCore';
import { ConversationReplayTracker } from '../lib/timelineStore';
import { ExternalStore, RuntimeTransaction } from './externalStore';

export type ProtocolMessage = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
};

type ConnectionSocket = {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send: (value: string) => void;
  close: () => void;
};

export type ConnectionControllerHandlers = {
  onProbe: (probe: BackendProbeResult) => void;
  onOpen: () => void;
  onFrame: (frame: PendingSocketFrame) => void;
  onResetTransport: () => void;
  onError: (message: string) => void;
  onClearError: () => void;
};

type ConnectionControllerDependencies = {
  transaction?: RuntimeTransaction;
  createSocket?: (url: string) => ConnectionSocket;
  createCryptoSession?: typeof createTransportCryptoSession;
  probeConnection?: typeof probeBackendConnection;
  fetchImpl?: typeof fetch;
  now?: () => number;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
};

const NOOP_HANDLERS: ConnectionControllerHandlers = {
  onProbe: () => undefined,
  onOpen: () => undefined,
  onFrame: () => undefined,
  onResetTransport: () => undefined,
  onError: () => undefined,
  onClearError: () => undefined,
};

const SOCKET_OPEN = 1;

function sameSettings(left: ConnectionSettings, right: ConnectionSettings): boolean {
  return left.serverUrl === right.serverUrl
    && left.authToken === right.authToken
    && left.tenantId === right.tenantId
    && left.encryptionProtocol === right.encryptionProtocol
    && left.encryptionPublicKey === right.encryptionPublicKey;
}

export class ConnectionController {
  readonly state: ExternalStore<ConnectionState>;
  readonly health: ExternalStore<ConnectionHealth>;

  private handlers = NOOP_HANDLERS;
  private settings: ConnectionSettings | null = null;
  private socket: ConnectionSocket | null = null;
  private crypto: TransportCryptoSession | null = null;
  private generation = 0;
  private replayTracker = new ConversationReplayTracker();
  private started = false;
  private autoConnectEnabled = false;
  private autoConnectAttempted = false;
  private manualDisconnect = false;
  private lastFailureRetryable = true;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private healthTimeout: ReturnType<typeof setTimeout> | null = null;
  private healthAbortController: AbortController | null = null;
  private healthProbeSequence = 0;

  private readonly transaction: RuntimeTransaction;
  private readonly createSocket: (url: string) => ConnectionSocket;
  private readonly createCryptoSession: typeof createTransportCryptoSession;
  private readonly probeConnection: typeof probeBackendConnection;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly setTimeoutImpl: typeof setTimeout;
  private readonly clearTimeoutImpl: typeof clearTimeout;
  private readonly setIntervalImpl: typeof setInterval;
  private readonly clearIntervalImpl: typeof clearInterval;

  constructor(dependencies: ConnectionControllerDependencies = {}) {
    this.transaction = dependencies.transaction ?? new RuntimeTransaction();
    this.state = new ExternalStore<ConnectionState>('idle', this.transaction);
    this.health = new ExternalStore<ConnectionHealth>(defaultConnectionHealth, this.transaction);
    this.createSocket = dependencies.createSocket ?? ((url) => new WebSocket(url) as unknown as ConnectionSocket);
    this.createCryptoSession = dependencies.createCryptoSession ?? createTransportCryptoSession;
    this.probeConnection = dependencies.probeConnection ?? probeBackendConnection;
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.now = dependencies.now ?? Date.now;
    this.setTimeoutImpl = dependencies.setTimeoutImpl ?? setTimeout;
    this.clearTimeoutImpl = dependencies.clearTimeoutImpl ?? clearTimeout;
    this.setIntervalImpl = dependencies.setIntervalImpl ?? setInterval;
    this.clearIntervalImpl = dependencies.clearIntervalImpl ?? clearInterval;
  }

  bindHandlers(handlers: ConnectionControllerHandlers): void {
    this.handlers = handlers;
  }

  configure(settings: ConnectionSettings): void {
    const serverUrlChanged = this.settings?.serverUrl !== settings.serverUrl;
    if (this.settings && sameSettings(this.settings, settings)) return;
    this.settings = { ...settings };
    if (this.started && serverUrlChanged) this.restartHealthPolling();
  }

  start(settings: ConnectionSettings, autoConnect: boolean): void {
    this.configure(settings);
    if (!this.started) {
      this.started = true;
      this.restartHealthPolling();
    }
    if (autoConnect) this.autoConnectEnabled = true;
    if (autoConnect && !this.autoConnectAttempted) {
      this.autoConnectAttempted = true;
      this.connect();
    }
  }

  restart(settings: ConnectionSettings): void {
    this.configure(settings);
    this.manualDisconnect = false;
    this.autoConnectEnabled = true;
    this.closeTransport();
    this.publishState('closed');
  }

  connect = (): void => {
    const settings = this.settings;
    if (!settings) {
      this.fail(ConnectionError.invalidServerUrl('connection settings are not configured'));
      return;
    }

    this.manualDisconnect = false;
    this.autoConnectAttempted = true;
    this.autoConnectEnabled = true;
    this.closeTransport();
    this.handlers.onClearError();
    this.transaction.run(() => {
      this.state.set('connecting');
      this.health.set({ ...this.health.getSnapshot(), status: 'checking', error: '', code: '' });
    });

    const generation = this.generation;
    const handlers = this.handlers;
    void this.open(settings, generation, handlers);
  };

  disconnect = (manual = true): void => {
    if (manual) {
      this.manualDisconnect = true;
      this.autoConnectEnabled = false;
    }
    this.closeTransport();
    if (manual) this.publishState('closed');
  };

  dispose(): void {
    this.started = false;
    this.autoConnectEnabled = false;
    this.autoConnectAttempted = false;
    this.manualDisconnect = false;
    this.lastFailureRetryable = true;
    this.reconnectAttempt = 0;
    this.stopHealthPolling();
    this.closeTransport();
  }

  isCurrentGeneration(generation: number): boolean {
    return generation === this.generation;
  }

  send(message: ProtocolMessage): ProtocolMessage | null {
    const socket = this.socket;
    if (!socket || socket.readyState !== SOCKET_OPEN) return null;
    let frame: string;
    try {
      frame = JSON.stringify(message);
    } catch (error) {
      this.handlers.onError(error instanceof Error ? error.message : '消息序列化失败。');
      return null;
    }
    frame = this.crypto?.encryptClientText(frame) ?? frame;
    const size = utf8ByteLength(frame);
    if (size > MAX_LEGACY_MESSAGE_BYTES) {
      throw ConnectionError.messageTooLarge(size, MAX_LEGACY_MESSAGE_BYTES);
    }
    socket.send(frame);
    return message;
  }

  subscribeConversation(conversationId: string): boolean {
    const afterSequence = this.replayTracker.subscriptionCursor(conversationId);
    if (afterSequence === null) return Boolean(conversationId);
    const sent = this.send({
      id: createRequestId('sub'),
      type: 'conversation.subscribe',
      payload: { conversationId, afterSequence, limit: 200 },
    });
    if (sent) this.replayTracker.markSubscribed(conversationId);
    return Boolean(sent);
  }

  checkHealth = async (): Promise<void> => {
    const settings = this.settings;
    if (!settings) return;
    const probeId = ++this.healthProbeSequence;
    const startedAt = this.now();
    this.healthAbortController?.abort();
    if (this.healthTimeout !== null) this.clearTimeoutImpl(this.healthTimeout);
    const controller = new AbortController();
    this.healthAbortController = controller;
    this.healthTimeout = this.setTimeoutImpl(() => controller.abort(), CONNECTION_HEALTH_TIMEOUT_MS);

    const current = this.health.getSnapshot();
    if (current.status === 'unknown') {
      this.health.set({ ...current, status: 'checking', error: '', code: '' });
    }

    try {
      const response = await this.fetchImpl(buildHttpUrl(settings.serverUrl, '/health'), {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (probeId !== this.healthProbeSequence) return;
      if (!response.ok) throw new Error(`health endpoint returned ${response.status}`);
      this.health.set({
        status: 'online',
        latencyMs: this.now() - startedAt,
        lastCheckedAt: this.now(),
        error: '',
        code: '',
      });
    } catch (error) {
      if (probeId !== this.healthProbeSequence) return;
      const isAbort = error instanceof Error && error.name === 'AbortError';
      this.health.set({
        status: 'offline',
        latencyMs: null,
        lastCheckedAt: this.now(),
        error: isAbort ? '健康检查超时' : error instanceof Error ? error.message : '健康检查失败',
        code: '',
      });
    } finally {
      if (probeId === this.healthProbeSequence) {
        if (this.healthTimeout !== null) this.clearTimeoutImpl(this.healthTimeout);
        this.healthTimeout = null;
        this.healthAbortController = null;
      }
    }
  };

  private async open(
    settings: ConnectionSettings,
    generation: number,
    handlers: ConnectionControllerHandlers,
  ): Promise<void> {
    const inspected = inspectServerUrl(settings.serverUrl);
    if (inspected.error) {
      if (this.isCurrentGeneration(generation)) this.fail(inspected.error, handlers);
      return;
    }

    const probe = await this.probeConnection({ serverUrl: inspected.origin, authToken: settings.authToken });
    if (!this.isCurrentGeneration(generation)) return;
    handlers.onProbe(probe);
    if (!probe.ok || probe.error) {
      this.fail(probe.error ?? ConnectionError.unreachable('backend probe failed'), handlers);
      return;
    }

    this.health.set({ status: 'online', latencyMs: null, lastCheckedAt: this.now(), error: '', code: '' });
    let crypto: TransportCryptoSession | null = null;
    try {
      crypto = this.createCryptoSession({ ...settings, serverUrl: inspected.origin });
    } catch (error) {
      this.fail(new ConnectionError(
        ConnectionErrorType.PROTOCOL_ERROR,
        error instanceof Error ? error.message : '无法初始化加密连接',
        error instanceof Error ? error.message : 'crypto initialization failed',
        false,
        'request_failed',
      ), handlers);
      return;
    }

    const wsUrl = buildV2WebSocketUrlWithOptions(inspected.origin, {
      cryptoQueryString: crypto?.queryString,
      authToken: settings.authToken,
    });
    try {
      const socket = this.createSocket(wsUrl);
      if (!this.isCurrentGeneration(generation)) {
        socket.close();
        return;
      }
      this.replayTracker.resetConnection();
      this.socket = socket;
      this.crypto = crypto;

      socket.onopen = () => {
        if (!this.isCurrentGeneration(generation) || this.socket !== socket) return;
        this.reconnectAttempt = 0;
        this.lastFailureRetryable = true;
        this.clearReconnectTimer();
        this.publishState('open');
        handlers.onOpen();
        void this.checkHealth();
      };
      socket.onmessage = (event) => {
        if (!this.isCurrentGeneration(generation) || this.socket !== socket) return;
        handlers.onFrame({ data: String(event.data), generation, crypto: this.crypto });
      };
      socket.onerror = () => {
        if (!this.isCurrentGeneration(generation) || this.socket !== socket) return;
        const error = ConnectionError.websocketFailed(wsUrl);
        this.lastFailureRetryable = true;
        this.transaction.run(() => {
          this.state.set('error');
          this.health.set({ ...this.health.getSnapshot(), status: 'offline', error: error.userMessage, code: error.code });
        });
        handlers.onError(error.userMessage);
        this.scheduleReconnect();
      };
      socket.onclose = () => {
        if (!this.isCurrentGeneration(generation) || this.socket !== socket) return;
        this.socket = null;
        this.crypto = null;
        const state = this.state.getSnapshot();
        if (state === 'open' || state === 'connecting') this.publishState('closed');
      };
    } catch (error) {
      if (!this.isCurrentGeneration(generation)) return;
      this.crypto = null;
      this.fail(error instanceof ConnectionError
        ? error
        : ConnectionError.websocketFailed(error instanceof Error ? error.message : wsUrl), handlers);
    }
  }

  private fail(error: ConnectionError, handlers = this.handlers): void {
    this.lastFailureRetryable = error.retryable;
    this.transaction.run(() => {
      this.state.set('error');
      this.health.set({
        status: 'offline',
        latencyMs: null,
        lastCheckedAt: this.now(),
        error: error.userMessage,
        code: error.code,
      });
    });
    handlers.onError(error.userMessage);
    this.scheduleReconnect();
  }

  private publishState(state: ConnectionState): void {
    this.state.set(state);
    if (state === 'closed' || state === 'error') this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (
      !this.started
      || !this.autoConnectEnabled
      || this.manualDisconnect
      || !this.lastFailureRetryable
      || (this.state.getSnapshot() !== 'closed' && this.state.getSnapshot() !== 'error')
      || this.reconnectTimer !== null
    ) return;
    const delay = nextReconnectDelayMs(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.setTimeoutImpl(() => {
      this.reconnectTimer = null;
      if (!this.manualDisconnect) this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    this.clearTimeoutImpl(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private closeTransport(): void {
    this.generation += 1;
    this.replayTracker.resetConnection();
    this.clearReconnectTimer();
    const socket = this.socket;
    this.socket = null;
    this.crypto = null;
    this.handlers.onResetTransport();
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // Cleanup must continue even if a platform socket is already invalid.
    }
  }

  private restartHealthPolling(): void {
    this.stopHealthPolling();
    this.health.set(defaultConnectionHealth);
    if (!this.started || !this.settings) return;
    void this.checkHealth();
    this.healthInterval = this.setIntervalImpl(() => void this.checkHealth(), CONNECTION_HEALTH_INTERVAL_MS);
  }

  private stopHealthPolling(): void {
    this.healthProbeSequence += 1;
    this.healthAbortController?.abort();
    this.healthAbortController = null;
    if (this.healthTimeout !== null) this.clearTimeoutImpl(this.healthTimeout);
    this.healthTimeout = null;
    if (this.healthInterval !== null) this.clearIntervalImpl(this.healthInterval);
    this.healthInterval = null;
  }
}

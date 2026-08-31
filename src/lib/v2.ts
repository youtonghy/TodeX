import { buildHttpUrl, utf8ByteLength } from './todex';
import { ConnectionError } from './connectionError';
import { MetricsCollector, type ConnectionMetrics } from './connectionMetrics';

/**
 * Matches MAX_WS_MESSAGE_BYTES in the backend's server/v2.rs. The legacy `/v1/ws`
 * plane uses a separate, larger limit (MAX_LEGACY_MESSAGE_BYTES in transport.ts)
 * because it has no outbound chunking; the two converge once chunking lands.
 */
export const MAX_MESSAGE_SIZE = 4 * 1024 * 1024;

export type ProviderKind = 'acp' | 'codex' | 'pi' | 'claude-code';

export type ProviderDescriptor = {
  id: ProviderKind;
  displayName: string;
  available: boolean;
  unavailableReason?: string;
  profiles: string[];
  capabilities: Record<string, boolean>;
};

export type CatalogScope = 'user' | 'project';

export type SkillCatalogDescriptor = {
  resourceId: string;
  name: string;
  description: string;
  scope: CatalogScope;
  source: string;
  active: boolean;
  shadowedBy?: string;
  valid: boolean;
  error?: string;
};

export type SkillCatalog = {
  provider: ProviderKind;
  skills: SkillCatalogDescriptor[];
};

export type McpServerCatalogDescriptor = {
  resourceId: string;
  name: string;
  provider: ProviderKind;
  scope: CatalogScope;
  source: string;
  transport: 'stdio' | 'http' | 'unknown';
  enabled: boolean;
  active: boolean;
  shadowedBy?: string;
};

export type McpCatalog = {
  provider: ProviderKind;
  servers: McpServerCatalogDescriptor[];
};

export type ConversationManifest = {
  schemaVersion: number;
  id: string;
  provider: ProviderKind;
  ownerId: string;
  workspace: string;
  title?: string;
  providerProfile?: string;
  status: string;
  lastSequence: number;
  createdAt: string;
  updatedAt: string;
};

export type ConversationEvent = {
  schemaVersion: number;
  eventId: string;
  conversationId: string;
  sequence: number;
  time: string;
  type: string;
  payload: unknown;
};

export type ConversationReplay = {
  conversationId: string;
  fromSequence: number;
  nextSequence: number;
  hasMore: boolean;
  events: ConversationEvent[];
};

export type V2Message = {
  id?: string;
  type: string;
  payload?: Record<string, unknown>;
};

export type V2ApiOptions = {
  serverUrl: string;
  authToken?: string;
  fetchImpl?: typeof fetch;
  timeout?: number;
};

export type CreateConversationInput = {
  provider: ProviderKind;
  workspace: string;
  title?: string;
  providerProfile?: string;
};

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function parseV2Message(raw: string | ArrayBuffer): V2Message | null {
  try {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    const parsed = JSON.parse(text) as unknown;
    const object = jsonObject(parsed);
    return typeof object.type === 'string' ? {
      id: typeof object.id === 'string' ? object.id : undefined,
      type: object.type,
      payload: jsonObject(object.payload),
    } : null;
  } catch {
    return null;
  }
}

export function buildV2WebSocketUrl(serverUrl: string): string {
  const normalized = serverUrl.trim().replace(/\/+$/, '');
  const url = normalized.startsWith('ws://') || normalized.startsWith('wss://')
    ? new URL('/v2/ws', normalized)
    : new URL('/v2/ws', normalized.startsWith('https://')
      ? normalized.replace(/^https:\/\//i, 'wss://')
      : normalized.replace(/^http:\/\//i, 'ws://'));
  return url.toString();
}

export function buildV2WebSocketUrlWithToken(serverUrl: string, authToken?: string): string {
  const url = new URL(buildV2WebSocketUrl(serverUrl));
  if (authToken) url.searchParams.set('access_token', authToken);
  return url.toString();
}

export class V2ApiClient {
  private readonly serverUrl: string;
  private readonly authToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeout: number;

  constructor(options: V2ApiOptions) {
    this.serverUrl = options.serverUrl;
    this.authToken = options.authToken ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeout = options.timeout ?? 30000;
  }

  async listProviders(): Promise<{ providers: ProviderDescriptor[] }> {
    return this.request('/v2/providers');
  }

  async listSkillCatalog(provider: ProviderKind, workspace: string): Promise<SkillCatalog> {
    const query = new URLSearchParams({ provider, workspace });
    return this.request(`/v2/catalog/skills?${query}`);
  }

  async getSkillResource(provider: ProviderKind, workspace: string, resourceId: string): Promise<{ resourceId: string; content: string }> {
    const query = new URLSearchParams({ provider, workspace });
    return this.request(`/v2/catalog/skills/${encodeURIComponent(resourceId)}?${query}`);
  }

  async listMcpCatalog(provider: ProviderKind, workspace: string): Promise<McpCatalog> {
    const query = new URLSearchParams({ provider, workspace });
    return this.request(`/v2/catalog/mcp?${query}`);
  }

  async listWorkspaceDirectories(path?: string): Promise<{ root: string; current: string; parent: string | null; entries: Array<{ name: string; path: string; kind: 'directory' }> }> {
    const query = path ? `?path=${encodeURIComponent(path)}` : '';
    return this.request(`/v1/workspace/directories${query}`);
  }

  async readWorkspaceFile(path: string): Promise<{ name: string; path: string; mimeType: string; sizeBytes: number; text?: string }> {
    return this.request(`/v1/workspace/file?path=${encodeURIComponent(path)}`);
  }

  async fetchBrowser(url: string): Promise<{ url: string; status: number; contentType: string; body: string }> {
    return this.request('/v1/browser/fetch', { method: 'POST', body: JSON.stringify({ url }) });
  }

  async listConversations(): Promise<{ conversations: ConversationManifest[] }> {
    return this.request('/v2/conversations');
  }

  async createConversation(input: CreateConversationInput): Promise<ConversationManifest> {
    return this.request('/v2/conversations', { method: 'POST', body: JSON.stringify(input) });
  }

  async getConversation(id: string): Promise<ConversationManifest> {
    return this.request(`/v2/conversations/${encodeURIComponent(id)}`);
  }

  async replayEvents(id: string, afterSequence = 0, limit = 200): Promise<ConversationReplay> {
    const query = new URLSearchParams({ afterSequence: String(afterSequence), limit: String(limit) });
    return this.request(`/v2/conversations/${encodeURIComponent(id)}/events?${query}`);
  }

  async prompt(id: string, text: string, model?: string): Promise<{ conversationId: string; turnId: string }> {
    return this.request(`/v2/conversations/${encodeURIComponent(id)}/prompt`, {
      method: 'POST', body: JSON.stringify(model ? { text, model } : { text }),
    });
  }

  async cancel(id: string): Promise<{ conversationId: string; accepted: boolean }> {
    return this.request(`/v2/conversations/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  }

  async respondPermission(id: string, permissionId: string, decision: Record<string, unknown>): Promise<void> {
    await this.request(`/v2/conversations/${encodeURIComponent(id)}/permissions/${encodeURIComponent(permissionId)}`, {
      method: 'POST', body: JSON.stringify(decision),
    });
  }

  private async request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers = new Headers(init.headers);
      headers.set('Accept', 'application/json');
      if (init.body) headers.set('Content-Type', 'application/json');
      if (this.authToken) headers.set('Authorization', `Bearer ${this.authToken}`);

      const response = await this.fetchImpl(buildHttpUrl(this.serverUrl, pathname), {
        ...init,
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw ConnectionError.authenticationFailed(response.status);
        }
        if (response.status >= 500) {
          throw ConnectionError.serverError(response.status);
        }
        throw ConnectionError.protocolError(response.status);
      }

      return await response.json() as T;
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      if (error instanceof ConnectionError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw ConnectionError.timeout(`Request timeout after ${this.timeout}ms`);
      }

      // 网络错误
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage?.toLowerCase().includes('network') ||
          errorMessage?.toLowerCase().includes('fetch')) {
        throw ConnectionError.networkOffline(errorMessage);
      }

      throw error;
    }
  }
}

export type V2SocketOptions = {
  serverUrl: string;
  authToken?: string;
  WebSocketImpl?: typeof WebSocket;
  onEvent?: (event: ConversationEvent) => void;
  onResult?: (message: V2Message) => void;
  onError?: (error: Error) => void;
  onStatus?: (status: 'connecting' | 'open' | 'closed' | 'error') => void;
  connectionTimeout?: number;
  heartbeatInterval?: number;
  maxMissedHeartbeats?: number;
};

type Subscription = { afterSequence: number; limit: number };

export class V2ConversationSocket {
  private readonly options: V2SocketOptions;
  private readonly subscriptions = new Map<string, Subscription>();
  private socket: WebSocket | null = null;
  private nextId = 1;
  private closedExplicitly = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = 1000;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** Pings sent but not yet answered. Size is the missed-heartbeat count. */
  private pendingPingIds = new Set<string>();
  private readonly connectionTimeout: number;
  private readonly heartbeatInterval: number;
  private readonly maxMissedHeartbeats: number;
  private netInfoUnsubscribe?: () => void;
  private wasConnected = false;
  private metrics = new MetricsCollector();

  constructor(options: V2SocketOptions) {
    this.options = options;
    this.connectionTimeout = options.connectionTimeout ?? 10000;
    this.heartbeatInterval = options.heartbeatInterval ?? 30000;
    this.maxMissedHeartbeats = options.maxMissedHeartbeats ?? 3;
  }

  getMetrics(): Readonly<ConnectionMetrics> {
    return this.metrics.getMetrics();
  }

  connect(): void {
    this.closedExplicitly = false;
    this.options.onStatus?.('connecting');
    const WebSocketImpl = this.options.WebSocketImpl ?? WebSocket;
    let socket: WebSocket;
    try {
      socket = new WebSocketImpl(buildV2WebSocketUrlWithToken(this.options.serverUrl, this.options.authToken), this.options.authToken
        ? { headers: { Authorization: `Bearer ${this.options.authToken}` } } as never : undefined);
    } catch {
      // Browser WebSocket implementations reject React Native's header options.
      socket = new WebSocketImpl(buildV2WebSocketUrlWithToken(this.options.serverUrl, this.options.authToken));
    }
    this.socket = socket;

    // 连接超时检测
    this.connectionTimer = setTimeout(() => {
      if (socket.readyState === WebSocket.CONNECTING) {
        this.options.onError?.(ConnectionError.connectionTimeout());
        socket.close();
      }
    }, this.connectionTimeout);

    // 网络状态监听 (仅在React Native环境)
    if (typeof navigator !== 'undefined' && 'product' in navigator) {
      this.setupNetworkListener();
    }

    socket.onopen = () => {
      if (this.connectionTimer) {
        clearTimeout(this.connectionTimer);
        this.connectionTimer = null;
      }
      this.reconnectDelayMs = 1000;
      this.metrics.onConnect();
      this.options.onStatus?.('open');
      this.startHeartbeat();
      for (const [conversationId, subscription] of this.subscriptions) {
        this.send('conversation.subscribe', { conversationId, afterSequence: subscription.afterSequence, limit: subscription.limit });
      }
    };
    socket.onmessage = (message) => this.handleMessage(typeof message.data === 'string' || message.data instanceof ArrayBuffer ? message.data : String(message.data));
    socket.onerror = () => {
      if (this.connectionTimer) {
        clearTimeout(this.connectionTimer);
        this.connectionTimer = null;
      }
      this.stopHeartbeat();
      this.options.onStatus?.('error');
      const error = new Error('TodeX v2 WebSocket error');
      this.metrics.onError('websocket_error', error.message);
      this.options.onError?.(error);
    };
    socket.onclose = () => {
      if (this.connectionTimer) {
        clearTimeout(this.connectionTimer);
        this.connectionTimer = null;
      }
      this.socket = null;
      this.stopHeartbeat();
      this.options.onStatus?.('closed');
      if (!this.closedExplicitly && !this.reconnectTimer) {
        const delay = this.reconnectDelayMs;
        this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, delay);
      }
    };
  }

  close(): void {
    this.closedExplicitly = true;
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    if (this.netInfoUnsubscribe) {
      this.netInfoUnsubscribe();
      this.netInfoUnsubscribe = undefined;
    }
    this.socket?.close();
    this.socket = null;
  }

  subscribe(conversationId: string, afterSequence = 0, limit = 200): void {
    const current = this.subscriptions.get(conversationId);
    this.subscriptions.set(conversationId, { afterSequence: Math.max(afterSequence, current?.afterSequence ?? 0), limit });
    this.send('conversation.subscribe', { conversationId, afterSequence, limit });
  }

  sendPrompt(conversationId: string, text: string, model?: string): void { this.send('conversation.prompt', { conversationId, text, ...(model ? { model } : {}) }); }
  cancel(conversationId: string): void { this.send('conversation.cancel', { conversationId }); }
  respondPermission(conversationId: string, permissionId: string, decision: Record<string, unknown>): void { this.send('conversation.permission.respond', { conversationId, permissionId, ...decision }); }
  ping(): void {
    const id = this.send('server.ping', {});
    if (id) this.pendingPingIds.add(id);
  }

  acknowledge(conversationId: string, sequence: number): void {
    const current = this.subscriptions.get(conversationId);
    if (current && sequence > current.afterSequence) current.afterSequence = sequence;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        this.stopHeartbeat();
        return;
      }

      // Only an unanswered ping counts as missed. Incrementing before sending
      // would also count intervals where `send` bailed out, which says nothing
      // about the link.
      if (this.pendingPingIds.size >= this.maxMissedHeartbeats) {
        this.options.onError?.(ConnectionError.heartbeatTimeout());
        this.socket.close();
        this.stopHeartbeat();
        return;
      }

      this.ping();
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.pendingPingIds.clear();
  }

  /** Returns the id the message was sent under, or null if it never left. */
  private send(type: string, payload: Record<string, unknown>): string | null {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return null;

    const id = `v2-${this.nextId++}`;
    const message = JSON.stringify({ id, type, payload });

    // 消息大小检查：后端按字节计，String.length 是 UTF-16 码元数
    const size = utf8ByteLength(message);
    if (size > MAX_MESSAGE_SIZE) {
      const error = ConnectionError.messageTooLarge(size, MAX_MESSAGE_SIZE);
      this.metrics.onError(error.type, error.message);
      this.options.onError?.(error);
      return null;
    }

    this.socket.send(message);
    this.metrics.onMessageSent();
    return id;
  }

  private handleMessage(raw: string | ArrayBuffer): void {
    this.metrics.onMessageReceived();

    const message = parseV2Message(raw);
    if (!message) {
      const error = new Error('Invalid TodeX v2 WebSocket message');
      this.metrics.onError('invalid_message', error.message);
      this.options.onError?.(error);
      return;
    }
    // 只有对 ping 的应答才算心跳存活。任意入站消息都重置计数的话，
    // 服务端流式推送期间上行链路已死也检测不到——恰好是最需要心跳的场景。
    // 应答不区分成败：对 ping 的 server.error 同样证明双向链路是通的。
    if (message.id && this.pendingPingIds.delete(message.id)) {
      return;
    }
    if (message.type === 'conversation.event') {
      const payload = message.payload ?? {};
      const event = payload as unknown as ConversationEvent;
      if (typeof event.conversationId === 'string' && Number.isInteger(event.sequence)) {
        this.acknowledge(event.conversationId, event.sequence);
        this.options.onEvent?.(event);
      }
    } else if (message.type === 'server.error') {
      // 后端在 payload.code 里给出结构化错误码（PROVIDER_UNAVAILABLE 等），
      // 只取 message 会让"provider 未安装"和"内部错误"在 UI 上无法区分。
      const code = typeof message.payload?.code === 'string' ? message.payload.code : '';
      const detail = String(message.payload?.message ?? 'TodeX v2 server error');
      const errorMsg = code ? `[${code}] ${detail}` : detail;
      this.metrics.onError('server_error', errorMsg);
      this.options.onError?.(new Error(errorMsg));
    } else {
      this.options.onResult?.(message);
    }
  }

  private async setupNetworkListener(): Promise<void> {
    try {
      const NetInfo = await import('@react-native-community/netinfo');

      this.netInfoUnsubscribe = NetInfo.default.addEventListener(state => {
        const isConnected = state.isConnected === true && state.isInternetReachable !== false;

        if (!this.wasConnected && isConnected) {
          // 网络恢复
          if (this.socket?.readyState !== WebSocket.OPEN && !this.closedExplicitly) {
            console.log('[V2Socket] Network restored, reconnecting');
            this.connect();
          }
        } else if (this.wasConnected && !isConnected) {
          // 网络断开
          console.log('[V2Socket] Network lost');
          this.options.onStatus?.('error');
        }

        this.wasConnected = isConnected;
      });
    } catch (error) {
      // NetInfo不可用（Web环境），忽略
      console.log('[V2Socket] NetInfo not available, skipping network listener');
    }
  }
}

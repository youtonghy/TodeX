import { buildHttpUrl } from './todex';

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

export class V2ApiClient {
  private readonly serverUrl: string;
  private readonly authToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: V2ApiOptions) {
    this.serverUrl = options.serverUrl;
    this.authToken = options.authToken ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
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
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body) headers.set('Content-Type', 'application/json');
    if (this.authToken) headers.set('Authorization', `Bearer ${this.authToken}`);
    const response = await this.fetchImpl(buildHttpUrl(this.serverUrl, pathname), { ...init, headers });
    if (!response.ok) throw new Error(`TodeX v2 request failed (${response.status})`);
    return await response.json() as T;
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

  constructor(options: V2SocketOptions) { this.options = options; }

  connect(): void {
    this.closedExplicitly = false;
    this.options.onStatus?.('connecting');
    const WebSocketImpl = this.options.WebSocketImpl ?? WebSocket;
    let socket: WebSocket;
    try {
      socket = new WebSocketImpl(buildV2WebSocketUrl(this.options.serverUrl), this.options.authToken
        ? { headers: { Authorization: `Bearer ${this.options.authToken}` } } as never : undefined);
    } catch {
      // Browser WebSocket implementations reject React Native's header options.
      socket = new WebSocketImpl(buildV2WebSocketUrl(this.options.serverUrl));
    }
    this.socket = socket;
    socket.onopen = () => {
      this.reconnectDelayMs = 1000;
      this.options.onStatus?.('open');
      for (const [conversationId, subscription] of this.subscriptions) {
        this.send('conversation.subscribe', { conversationId, afterSequence: subscription.afterSequence, limit: subscription.limit });
      }
    };
    socket.onmessage = (message) => this.handleMessage(typeof message.data === 'string' || message.data instanceof ArrayBuffer ? message.data : String(message.data));
    socket.onerror = () => { this.options.onStatus?.('error'); this.options.onError?.(new Error('TodeX v2 WebSocket error')); };
    socket.onclose = () => {
      this.socket = null;
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
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
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
  ping(): void { this.send('server.ping', {}); }

  acknowledge(conversationId: string, sequence: number): void {
    const current = this.subscriptions.get(conversationId);
    if (current && sequence > current.afterSequence) current.afterSequence = sequence;
  }

  private send(type: string, payload: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ id: `v2-${this.nextId++}`, type, payload }));
  }

  private handleMessage(raw: string | ArrayBuffer): void {
    const message = parseV2Message(raw);
    if (!message) { this.options.onError?.(new Error('Invalid TodeX v2 WebSocket message')); return; }
    if (message.type === 'conversation.event') {
      const payload = message.payload ?? {};
      const event = payload as unknown as ConversationEvent;
      if (typeof event.conversationId === 'string' && Number.isInteger(event.sequence)) {
        this.acknowledge(event.conversationId, event.sequence);
        this.options.onEvent?.(event);
      }
    } else if (message.type === 'server.error') {
      this.options.onError?.(new Error(String(message.payload?.message ?? 'TodeX v2 server error')));
    } else {
      this.options.onResult?.(message);
    }
  }
}

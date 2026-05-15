import { createRequestId, isObject, type ServerEvent } from './todex';

export const TRANSPORT_VERSION = 1;
export const TRANSPORT_REASSEMBLY_LIMIT_BYTES = 100 * 1024 * 1024;
const TRANSPORT_ACK_FLUSH_DELAY_MS = 80;

export type TransportStatus = 'disabled' | 'handshaking' | 'ready' | 'error';

export type TransportStatusSnapshot = {
  status: TransportStatus;
  clientId: string;
  error: string;
};

export type TransportOutboundMessage = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
};

type TransportFrame =
  | { type: 'transport.event'; payload: TransportEventPayload }
  | { type: 'transport.chunk'; payload: TransportChunkPayload }
  | { type: 'transport.error'; payload: TransportErrorPayload };

type TransportEventPayload = {
  streamId?: string;
  seqId?: number;
  sessionId?: string;
  cursor?: number | string;
  payload: ServerEvent;
};

type TransportChunkPayload = {
  chunkId: string;
  index: number;
  total: number;
  encoding: string;
  totalBytes: number;
  data: string;
};

type TransportErrorPayload = {
  code?: string;
  message?: string;
};

type PartialChunk = {
  total: number;
  totalBytes: number;
  parts: Map<number, string>;
};

export type TransportClientOptions = {
  loadSessionCursors: () => Record<string, number>;
  onStatus?: (status: TransportStatusSnapshot) => void;
};

export class TodeXTransportClient {
  private clientId: string;
  private status: TransportStatus = 'disabled';
  private error = '';
  private socket: WebSocket | null = null;
  private encrypt: (text: string) => string;
  private loadSessionCursors: () => Record<string, number>;
  private onStatus?: (status: TransportStatusSnapshot) => void;
  private chunks = new Map<string, PartialChunk>();
  private pendingAcks = new Map<string, number>();
  private ackFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private supportsEnvelope = false;

  constructor(options: TransportClientOptions) {
    this.clientId = stableTransportClientId();
    this.encrypt = (text) => text;
    this.loadSessionCursors = options.loadSessionCursors;
    this.onStatus = options.onStatus;
  }

  get snapshot(): TransportStatusSnapshot {
    return {
      status: this.status,
      clientId: this.clientId,
      error: this.error,
    };
  }

  attach(socket: WebSocket, encrypt: (text: string) => string): void {
    this.socket = socket;
    this.encrypt = encrypt;
    this.chunks.clear();
    this.clearPendingAcks();
    this.supportsEnvelope = true;
    this.setStatus('handshaking', '');
    this.sendEnvelope('transport.hello', {
      transportVersion: TRANSPORT_VERSION,
      clientId: this.clientId,
      capabilities: ['ack', 'chunk'],
      sessionCursors: this.loadSessionCursors(),
    });
    this.setStatus('ready', '');
  }

  detach(error = ''): void {
    this.socket = null;
    this.encrypt = (text) => text;
    this.chunks.clear();
    this.clearPendingAcks();
    this.supportsEnvelope = false;
    this.setStatus(error ? 'error' : 'disabled', error);
  }

  send(type: string, payload: Record<string, unknown>, requestId = createRequestId('msg')): TransportOutboundMessage | null {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return null;
    }
    const message = { id: requestId, type, payload };
    if (this.supportsEnvelope) {
      this.sendEnvelope('transport.event', { payload: message });
    } else {
      this.socket.send(this.encrypt(JSON.stringify(message)));
    }
    return message;
  }

  decode(text: string): ServerEvent[] {
    const frame = parseTransportFrame(text);
    if (!frame) {
      return [JSON.parse(text) as ServerEvent];
    }

    if (frame.type === 'transport.error') {
      const message = frame.payload.message || frame.payload.code || 'transport error';
      this.setStatus('error', message);
      throw new Error(message);
    }

    if (frame.type === 'transport.event') {
      return [this.eventFromPayload(frame.payload)];
    }

    const completed = this.pushChunk(frame.payload);
    if (!completed) {
      return [];
    }
    return this.decode(completed);
  }

  ack(event: ServerEvent): void {
    const sessionId = sessionIdFromEvent(event);
    const cursor = cursorFromEvent(event);
    if (!sessionId || cursor === null) {
      return;
    }
    const previousCursor = this.pendingAcks.get(sessionId) ?? 0;
    if (cursor > previousCursor) {
      this.pendingAcks.set(sessionId, cursor);
    }
    this.scheduleAckFlush();
  }

  flushAcks(): void {
    if (this.ackFlushTimer) {
      clearTimeout(this.ackFlushTimer);
      this.ackFlushTimer = null;
    }
    if (this.pendingAcks.size === 0) {
      return;
    }
    const pending = Array.from(this.pendingAcks.entries());
    this.pendingAcks.clear();
    for (const [sessionId, cursor] of pending) {
      this.sendEnvelope('transport.ack', { sessionId, cursor });
    }
  }

  private eventFromPayload(payload: TransportEventPayload): ServerEvent {
    const event = payload.payload;
    if (payload.sessionId && !event.codex_session_id) {
      event.codex_session_id = payload.sessionId;
    }
    if (payload.cursor !== undefined && event.cursor === undefined) {
      event.cursor = payload.cursor;
    }
    return event;
  }

  private sendEnvelope(type: string, payload: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const json = JSON.stringify({ type, payload });
    this.socket.send(this.encrypt(json));
  }

  private pushChunk(chunk: TransportChunkPayload): string | null {
    if (chunk.encoding !== 'base64') {
      throw new Error(`unsupported transport chunk encoding ${chunk.encoding}`);
    }
    if (!Number.isInteger(chunk.index) || !Number.isInteger(chunk.total) || chunk.total <= 0 || chunk.index < 0 || chunk.index >= chunk.total) {
      throw new Error('invalid transport chunk index');
    }
    if (!Number.isFinite(chunk.totalBytes) || chunk.totalBytes > TRANSPORT_REASSEMBLY_LIMIT_BYTES) {
      throw new Error('transport chunk payload exceeds reassembly limit');
    }
    const current = this.chunks.get(chunk.chunkId) ?? {
      total: chunk.total,
      totalBytes: chunk.totalBytes,
      parts: new Map<number, string>(),
    };
    if (current.total !== chunk.total || current.totalBytes !== chunk.totalBytes) {
      throw new Error('transport chunk metadata changed mid-message');
    }
    current.parts.set(chunk.index, chunk.data);
    this.chunks.set(chunk.chunkId, current);
    if (current.parts.size !== current.total) {
      return null;
    }

    const bytes = new Uint8Array(current.totalBytes);
    let offset = 0;
    for (let index = 0; index < current.total; index += 1) {
      const part = current.parts.get(index);
      if (typeof part !== 'string') {
        throw new Error('transport chunk is missing a part');
      }
      const decoded = decodeBase64Bytes(part);
      if (offset + decoded.length > current.totalBytes) {
        throw new Error('transport chunk decoded size mismatch');
      }
      bytes.set(decoded, offset);
      offset += decoded.length;
    }
    this.chunks.delete(chunk.chunkId);
    if (offset !== current.totalBytes) {
      throw new Error('transport chunk decoded size mismatch');
    }
    return decodeUtf8Bytes(bytes);
  }

  private setStatus(status: TransportStatus, error: string): void {
    this.status = status;
    this.error = error;
    this.onStatus?.(this.snapshot);
  }

  private scheduleAckFlush(): void {
    if (this.ackFlushTimer || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ackFlushTimer = setTimeout(() => {
      this.flushAcks();
    }, TRANSPORT_ACK_FLUSH_DELAY_MS);
  }

  private clearPendingAcks(): void {
    if (this.ackFlushTimer) {
      clearTimeout(this.ackFlushTimer);
      this.ackFlushTimer = null;
    }
    this.pendingAcks.clear();
  }
}

export function cursorFromEvent(event: ServerEvent): number | null {
  if (typeof event.cursor === 'number' && Number.isFinite(event.cursor)) {
    return event.cursor;
  }
  if (typeof event.cursor === 'string') {
    const parsed = Number(event.cursor);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function sessionIdFromEvent(event: ServerEvent): string {
  const payload = isObject(event.payload) ? event.payload : {};
  const data = isObject(payload.data) ? payload.data : {};
  const candidates = [
    event.codex_session_id,
    data.codexSessionId,
    data.codex_session_id,
    data.sessionId,
    data.session_id,
    payload.codexSessionId,
    payload.codex_session_id,
    payload.sessionId,
    payload.session_id,
  ];
  const value = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  return typeof value === 'string' ? value : '';
}

function parseTransportFrame(text: string): TransportFrame | null {
  const parsed = JSON.parse(text) as unknown;
  if (!isObject(parsed) || typeof parsed.type !== 'string' || !parsed.type.startsWith('transport.')) {
    return null;
  }
  if (!isObject(parsed.payload)) {
    throw new Error('transport frame is missing payload');
  }
  if (parsed.type === 'transport.event') {
    return { type: 'transport.event', payload: parsed.payload as TransportEventPayload };
  }
  if (parsed.type === 'transport.chunk') {
    return { type: 'transport.chunk', payload: parsed.payload as TransportChunkPayload };
  }
  if (parsed.type === 'transport.error') {
    return { type: 'transport.error', payload: parsed.payload as TransportErrorPayload };
  }
  throw new Error(`unsupported transport frame ${parsed.type}`);
}

function stableTransportClientId(): string {
  return `mobile-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function decodeBase64Bytes(value: string): Uint8Array {
  const binary = decodeBase64Binary(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeUtf8Bytes(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes);
  }
  let escaped = '';
  bytes.forEach((byte) => {
    escaped += `%${byte.toString(16).padStart(2, '0')}`;
  });
  return decodeURIComponent(escaped);
}

function decodeBase64Binary(value: string): string {
  const globalAtob = (globalThis as unknown as { atob?: (input: string) => string }).atob;
  if (typeof globalAtob === 'function') {
    return globalAtob(value);
  }
  const nodeBuffer = (globalThis as unknown as { Buffer?: { from: (input: string, encoding: string) => { toString: (encoding: string) => string } } }).Buffer;
  if (nodeBuffer) {
    return nodeBuffer.from(value, 'base64').toString('binary');
  }
  throw new Error('base64 decoder is unavailable');
}

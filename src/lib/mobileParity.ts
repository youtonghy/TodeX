/**
 * Pure protocol/session helpers shared by the mobile client.
 *
 * This module deliberately has type-only imports.  It can therefore be
 * re-exported by the legacy protocol module without introducing a runtime
 * dependency cycle in the React Native bundle.
 */
import type {
  BackendConnectionProfile,
  ConnectionSettings,
  LocalAdapterState,
} from './todex';
import type {
  ConversationEvent,
  ConversationManifest,
  ProviderKind,
} from './v2';

type JsonRecord = Record<string, unknown>;

const DEFAULT_SERVER_URL = 'http://127.0.0.1:7345';
const DEFAULT_CONVERSATION_TITLE = '新对话';
const DEFAULT_MAX_USAGE_RECORDS = 2_000;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function readString(record: JsonRecord | null | undefined, keys: string[]): string {
  if (!record) {
    return '';
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function readBoolean(record: JsonRecord | null | undefined, keys: string[], fallback = false): boolean {
  if (!record) {
    return fallback;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      if (/^(true|yes|1)$/i.test(value.trim())) return true;
      if (/^(false|no|0)$/i.test(value.trim())) return false;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value !== 0;
    }
  }
  return fallback;
}

function readNumber(record: JsonRecord | null | undefined, keys: string[], fallback = 0): number {
  if (!record) {
    return fallback;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return fallback;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function resolveNow(value: number | { now?: number } | undefined, fallback = Date.now()): number {
  if (typeof value === 'number') {
    return finiteOr(value, fallback);
  }
  return value && typeof value.now === 'number' && Number.isFinite(value.now)
    ? value.now
    : fallback;
}

function parseTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (/^[+-]?\d+(?:\.\d+)?$/.test(value.trim()) && Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function normalizeProfileServerUrl(raw: string): string {
  const value = raw.trim();
  if (!value) {
    return DEFAULT_SERVER_URL;
  }

  let candidate = value;
  if (!/^https?:\/\//i.test(candidate) && !/^wss?:\/\//i.test(candidate)) {
    candidate = `http://${candidate}`;
  }
  candidate = candidate
    .replace(/^ws:\/\//i, 'http://')
    .replace(/^wss:\/\//i, 'https://');

  try {
    const parsed = new URL(candidate);
    const normalizedHostname = parsed.hostname.replace(/^\[|\]$/g, '');
    const hostname = ['localhost', '::1', '0:0:0:0:0:0:0:1'].includes(normalizedHostname.toLowerCase())
      ? '127.0.0.1'
      : normalizedHostname;
    const protocol = parsed.protocol === 'https:' ? 'https:' : 'http:';
    const host = hostname.includes(':') ? `[${hostname}]` : hostname;
    const origin = parsed.port
      ? `${protocol}//${host}:${parsed.port}`
      : `${protocol}//${host}`;
    return origin.replace(/\/+$/, '');
  } catch {
    return candidate.replace(/\/+$/, '');
  }
}

/** Normalize the aliases accepted by the desktop model selector. */
export function normalizeConversationReasoningEffort(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/[\s_-]+/g, '') ?? '';
  if (!normalized) {
    return null;
  }
  switch (normalized) {
    case 'none':
    case 'off':
      return 'none';
    case 'minimal':
    case 'min':
      return 'minimal';
    case 'low':
      return 'low';
    case 'medium':
    case 'med':
    case 'default':
      return 'medium';
    case 'high':
      return 'high';
    case 'xhigh':
    case 'extra':
    case 'extrahigh':
    case 'max':
      return 'xhigh';
    default:
      return null;
  }
}

function normalizeEncryptionProtocol(value: unknown): ConnectionSettings['encryptionProtocol'] {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'x25519') return 'x25519';
  if (normalized === 'ml-kem-768' || normalized === 'mlkem768' || normalized === 'ml_kem_768') {
    return 'ml-kem-768';
  }
  return 'none';
}

export type BackendProfileNormalizeOptions = {
  now?: number;
};

/** Normalize a persisted backend profile, including legacy snake_case fields. */
export function normalizeBackendConnectionProfile(
  value: unknown,
  options: BackendProfileNormalizeOptions | number = {},
): BackendConnectionProfile | null {
  const raw = asRecord(value);
  if (!raw) {
    return null;
  }
  const id = readString(raw, ['id', 'profileId', 'profile_id']);
  const serverUrl = readString(raw, ['serverUrl', 'server_url', 'url', 'endpoint']);
  if (!id || !serverUrl) {
    return null;
  }
  const now = resolveNow(options);
  const createdAt = parseTimestamp(raw.createdAt ?? raw.created_at, now);
  const updatedAt = parseTimestamp(raw.updatedAt ?? raw.updated_at, createdAt);
  return {
    id,
    name: readString(raw, ['name', 'displayName', 'display_name']) || '后端',
    serverUrl: normalizeProfileServerUrl(serverUrl),
    authToken: typeof raw.authToken === 'string'
      ? raw.authToken
      : typeof raw.auth_token === 'string' ? raw.auth_token : '',
    tenantId: readString(raw, ['tenantId', 'tenant_id']) || 'local',
    encryptionProtocol: normalizeEncryptionProtocol(raw.encryptionProtocol ?? raw.encryption_protocol),
    encryptionPublicKey: typeof raw.encryptionPublicKey === 'string'
      ? raw.encryptionPublicKey
      : typeof raw.encryption_public_key === 'string' ? raw.encryption_public_key : '',
    createdAt,
    updatedAt,
  };
}

export function normalizeBackendConnectionProfiles(
  value: unknown,
  options: BackendProfileNormalizeOptions | number = {},
): BackendConnectionProfile[] {
  const root = asRecord(value);
  const items = Array.isArray(value)
    ? value
    : (root && (Array.isArray(root.profiles) ? root.profiles : Array.isArray(root.connections) ? root.connections : [])) ?? [];
  const seen = new Set<string>();
  const profiles: BackendConnectionProfile[] = [];
  for (const item of items) {
    const profile = normalizeBackendConnectionProfile(item, options);
    if (!profile || seen.has(profile.id)) {
      continue;
    }
    seen.add(profile.id);
    profiles.push(profile);
  }
  return profiles;
}

export function profileFromSettings(
  settings: ConnectionSettings,
  name = '默认后端',
  id = 'default-backend',
  now = Date.now(),
): BackendConnectionProfile {
  const timestamp = finiteOr(now, Date.now());
  return {
    id: id.trim() || 'default-backend',
    name: name.trim() || '默认后端',
    serverUrl: normalizeProfileServerUrl(settings.serverUrl),
    authToken: settings.authToken,
    tenantId: settings.tenantId,
    encryptionProtocol: normalizeEncryptionProtocol(settings.encryptionProtocol),
    encryptionPublicKey: settings.encryptionPublicKey,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function settingsFromProfile(
  profile: BackendConnectionProfile,
  current: ConnectionSettings,
): ConnectionSettings {
  const normalized = normalizeBackendConnectionProfile(profile);
  if (!normalized) {
    return current;
  }
  return {
    ...current,
    serverUrl: normalized.serverUrl,
    authToken: normalized.authToken,
    tenantId: normalized.tenantId,
    encryptionProtocol: normalized.encryptionProtocol,
    encryptionPublicKey: normalized.encryptionPublicKey,
  };
}

export type ConversationRecord = {
  id: string;
  workspaceId: string;
  backendConnectionId?: string | null;
  title: string;
  preview?: string;
  nativeStatus?: string;
  archived?: boolean;
  sessionId: string;
  threadId: string;
  localAdapterState?: LocalAdapterState;
  mode?: 'plan' | 'implement';
  goalStatus?: string;
  goalObjective?: string;
  provider?: ProviderKind | string;
  providerProfile?: string;
  model?: string;
  reasoningEffort?: string | null;
  v2ConversationId?: string;
  lastSequence?: number;
  createdAt: number;
  updatedAt: number;
};

export type ConversationNormalizeOptions = {
  now?: number;
  fallbackWorkspaceId?: string;
  fallbackProvider?: ProviderKind | string;
  fallbackModel?: string;
  backendConnectionId?: string | null;
};

function normalizeLocalAdapterState(value: string): LocalAdapterState | undefined {
  switch (value.trim().toLowerCase()) {
    case 'idle':
    case 'starting':
    case 'running':
    case 'stopped':
    case 'error':
      return value.trim().toLowerCase() as LocalAdapterState;
    default:
      return undefined;
  }
}

function providerLabel(provider: string): string {
  const id = provider.trim().toLowerCase();
  if (id === 'codex' || id.includes('codex')) return 'Codex CLI';
  if (id === 'claude-code' || id.includes('claude')) return 'Claude Code';
  if (id === 'pi' || id.startsWith('pi-')) return 'Pi';
  if (id === 'acp') return 'ACP';
  if (id === 'grok-build' || id === 'grok') return 'Grok Build';
  return provider.trim() || 'Agent';
}

/** Normalize local/remote conversation rows into one mobile-safe shape. */
export function normalizeConversationRecord(
  value: unknown,
  options: ConversationNormalizeOptions = {},
): ConversationRecord | null {
  const raw = asRecord(value);
  if (!raw) {
    return null;
  }
  const explicitV2Id = readString(raw, ['v2ConversationId', 'v2_conversation_id']);
  const id = readString(raw, ['id', 'conversationId', 'conversation_id']) || explicitV2Id;
  const workspaceId = readString(raw, ['workspaceId', 'workspace_id', 'workspace'])
    || options.fallbackWorkspaceId?.trim()
    || '';
  if (!id || !workspaceId) {
    return null;
  }

  const provider = readString(raw, ['provider', 'providerKind', 'provider_kind', 'agentProvider'])
    || (typeof options.fallbackProvider === 'string' ? options.fallbackProvider.trim() : '');
  const hasManifestShape = Boolean(provider)
    && (Object.prototype.hasOwnProperty.call(raw, 'schemaVersion')
      || Object.prototype.hasOwnProperty.call(raw, 'lastSequence')
      || Object.prototype.hasOwnProperty.call(raw, 'status'));
  const v2ConversationId = explicitV2Id || (hasManifestShape ? id : '');
  const now = resolveNow(options);
  const createdAt = parseTimestamp(raw.createdAt ?? raw.created_at, now);
  const updatedAt = parseTimestamp(raw.updatedAt ?? raw.updated_at, createdAt);
  const model = readString(raw, ['model', 'modelId', 'model_id']) || options.fallbackModel?.trim() || '';
  const rawReasoning = readString(raw, ['reasoningEffort', 'reasoning_effort', 'reasoningLevel', 'reasoning_level']);
  const sequence = readNumber(raw, ['lastSequence', 'last_sequence', 'sequence'], Number.NaN);
  const backendConnectionId = readString(raw, ['backendConnectionId', 'backend_connection_id'])
    || options.backendConnectionId
    || null;
  const modeValue = readString(raw, ['mode']).toLowerCase();
  const mode = modeValue === 'plan' || modeValue === 'implement' ? modeValue : 'implement';

  return {
    id,
    workspaceId,
    backendConnectionId,
    title: readString(raw, ['title', 'name']) || (provider ? providerLabel(provider) : DEFAULT_CONVERSATION_TITLE),
    preview: readString(raw, ['preview', 'summary', 'firstMessage', 'first_message']),
    nativeStatus: readString(raw, ['nativeStatus', 'native_status', 'status']) || undefined,
    archived: readBoolean(raw, ['archived', 'isArchived', 'is_archived'], false),
    sessionId: readString(raw, ['sessionId', 'session_id']) || (v2ConversationId ? `v2_${v2ConversationId}` : `conversation_${id}`),
    threadId: readString(raw, ['threadId', 'thread_id']),
    localAdapterState: normalizeLocalAdapterState(readString(raw, ['localAdapterState', 'local_adapter_state'])) || 'idle',
    mode,
    goalStatus: readString(raw, ['goalStatus', 'goal_status']),
    goalObjective: readString(raw, ['goalObjective', 'goal_objective', 'objective']),
    provider: provider || undefined,
    providerProfile: readString(raw, ['providerProfile', 'provider_profile']) || undefined,
    model: model || undefined,
    reasoningEffort: normalizeConversationReasoningEffort(rawReasoning),
    v2ConversationId: v2ConversationId || undefined,
    lastSequence: Number.isFinite(sequence) ? sequence : undefined,
    createdAt,
    updatedAt,
  };
}

export type ConversationManifestNormalizeOptions = ConversationNormalizeOptions;

export function conversationFromManifest(
  manifest: ConversationManifest,
  workspaceId: string,
  options: ConversationManifestNormalizeOptions = {},
): ConversationRecord {
  const normalized = normalizeConversationRecord({
    ...manifest,
    workspaceId,
    v2ConversationId: manifest.id,
    sessionId: `v2_${manifest.id}`,
  }, {
    ...options,
    fallbackWorkspaceId: workspaceId,
    fallbackProvider: manifest.provider,
  });
  // A typed manifest always contains an id and workspace id; keep a defensive
  // fallback for data crossing the native bridge at runtime.
  if (normalized) {
    return normalized;
  }
  const now = resolveNow(options);
  return {
    id: manifest.id,
    workspaceId,
    title: manifest.title || providerLabel(manifest.provider),
    preview: '',
    nativeStatus: manifest.status,
    archived: false,
    sessionId: `v2_${manifest.id}`,
    threadId: '',
    localAdapterState: 'idle',
    mode: 'implement',
    goalStatus: '',
    goalObjective: '',
    provider: manifest.provider,
    providerProfile: manifest.providerProfile,
    v2ConversationId: manifest.id,
    lastSequence: manifest.lastSequence,
    createdAt: parseTimestamp(manifest.createdAt, now),
    updatedAt: parseTimestamp(manifest.updatedAt, now),
  };
}

export type ConversationContextUsage = {
  usedTokens: number;
  contextWindow?: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  model?: string;
  updatedAt: number;
};

export type UsageRecord = {
  id: string;
  conversationId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  updatedAt: number;
};

export type UsageNormalizeOptions = {
  now?: number;
  limit?: number;
};

export const MAX_USAGE_RECORDS = DEFAULT_MAX_USAGE_RECORDS;

export function usageNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function usageField(record: JsonRecord | null, keys: string[]): number {
  if (!record) return 0;
  for (const key of keys) {
    if (record[key] !== undefined) {
      return usageNumber(record[key]);
    }
  }
  return 0;
}

export function normalizeUsageRecords(
  value: unknown,
  options: UsageNormalizeOptions | number = {},
): UsageRecord[] {
  const root = asRecord(value);
  const items = Array.isArray(value)
    ? value
    : (root && (Array.isArray(root.records) ? root.records : Array.isArray(root.usage) ? root.usage : Array.isArray(root.items) ? root.items : [])) ?? [];
  const now = resolveNow(options);
  const limit = typeof options === 'object' && typeof options.limit === 'number' && options.limit >= 0
    ? Math.floor(options.limit)
    : DEFAULT_MAX_USAGE_RECORDS;
  if (limit === 0) {
    return [];
  }
  const seen = new Set<string>();
  const records: UsageRecord[] = [];
  for (const item of items) {
    const raw = asRecord(item);
    if (!raw) continue;
    const id = readString(raw, ['id', 'usageId', 'usage_id']);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const updatedAt = parseTimestamp(raw.updatedAt ?? raw.updated_at, now);
    records.push({
      id,
      conversationId: readString(raw, ['conversationId', 'conversation_id']),
      provider: readString(raw, ['provider']) || 'unknown',
      model: readString(raw, ['model', 'modelId', 'model_id']) || 'unknown',
      inputTokens: usageField(raw, ['inputTokens', 'input_tokens', 'input']),
      outputTokens: usageField(raw, ['outputTokens', 'output_tokens', 'output']),
      cachedInputTokens: usageField(raw, ['cachedInputTokens', 'cached_input_tokens', 'cacheRead', 'cache_read', 'cacheReadInputTokens', 'cache_read_input_tokens']),
      cacheWriteTokens: usageField(raw, ['cacheWriteTokens', 'cache_write_tokens', 'cacheWrite', 'cache_write', 'cacheCreationInputTokens', 'cache_creation_input_tokens']),
      updatedAt,
    });
    if (records.length >= limit) break;
  }
  return records;
}

function objectAt(record: JsonRecord | null, keys: string[]): JsonRecord | null {
  if (!record) return null;
  for (const key of keys) {
    const nested = asRecord(record[key]);
    if (nested) return nested;
  }
  return null;
}

function eventTime(event: ConversationEvent | JsonRecord, fallback: number): number {
  const raw = asRecord(event);
  return parseTimestamp(raw?.time ?? raw?.timestamp, fallback);
}

/** Extract usage snapshots emitted by Codex tokenUsage or provider messages. */
export function contextUsageFromV2Event(
  event: ConversationEvent,
  now = Date.now(),
): ConversationContextUsage | null {
  const eventRecord = asRecord(event);
  const payload = asRecord(eventRecord?.payload);
  if (!eventRecord || !payload) return null;
  const metadata = objectAt(payload, ['metadata', 'meta']);
  const tokenUsage = objectAt(metadata, ['tokenUsage', 'token_usage'])
    || objectAt(payload, ['tokenUsage', 'token_usage']);
  const last = objectAt(tokenUsage, ['last', 'latest', 'current']);
  const providerMethod = readString(payload, ['providerMethod', 'provider_method', 'method'])
    || readString(eventRecord, ['providerMethod', 'provider_method']);
  const eventType = readString(eventRecord, ['type', 'eventType', 'event_type']);
  const normalizedUsage = objectAt(payload, ['usage']);
  const normalizedLast = objectAt(normalizedUsage, ['last']);
  if (eventType === 'usage.updated' && normalizedLast) {
    const inputTokens = usageField(normalizedLast, ['input']);
    const outputTokens = usageField(normalizedLast, ['output']);
    const cachedInputTokens = usageField(normalizedLast, ['cacheRead']);
    const cacheWriteTokens = usageField(normalizedLast, ['cacheWrite']);
    const total = usageField(normalizedLast, ['total']);
    const model = readString(payload, ['model', 'modelId', 'model_id']);
    return {
      usedTokens: total || inputTokens + outputTokens + cachedInputTokens + cacheWriteTokens,
      contextWindow: usageField(payload, ['contextWindow', 'context_window']) || undefined,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheWriteTokens,
      ...(model ? { model } : {}),
      updatedAt: eventTime(event, now),
    };
  }
  if (last && (providerMethod === 'thread/tokenUsage/updated' || /tokenusage[./:_-]*updated/i.test(eventType))) {
    const inputTokens = usageField(last, ['inputTokens', 'input_tokens', 'input']);
    const outputTokens = usageField(last, ['outputTokens', 'output_tokens', 'output']);
    const cachedInputTokens = usageField(last, ['cachedInputTokens', 'cached_input_tokens', 'cacheReadInputTokens', 'cache_read_input_tokens', 'cacheRead']);
    const cacheWriteTokens = usageField(last, ['cacheWriteInputTokens', 'cache_write_input_tokens', 'cacheCreationInputTokens', 'cache_creation_input_tokens', 'cacheWrite']);
    const total = usageField(last, ['totalTokens', 'total_tokens', 'total']);
    const model = readString(payload, ['model', 'modelId', 'model_id']);
    return {
      usedTokens: total || inputTokens + outputTokens + cachedInputTokens + cacheWriteTokens,
      contextWindow: usageField(tokenUsage, ['modelContextWindow', 'model_context_window', 'contextWindow', 'context_window']) || undefined,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheWriteTokens,
      ...(model ? { model } : {}),
      updatedAt: eventTime(event, now),
    };
  }

  const message = objectAt(payload, ['message']);
  const usage = objectAt(message, ['usage']) || objectAt(payload, ['usage']);
  const role = readString(message, ['role']) || readString(payload, ['role']);
  if (eventType !== 'message.completed' || role.toLowerCase() !== 'assistant' || !usage) {
    return null;
  }
  const inputTokens = usageField(usage, ['input', 'inputTokens', 'input_tokens']);
  const outputTokens = usageField(usage, ['output', 'outputTokens', 'output_tokens']);
  const cachedInputTokens = usageField(usage, ['cacheRead', 'cache_read', 'cachedInputTokens', 'cached_input_tokens', 'cacheReadInputTokens']);
  const cacheWriteTokens = usageField(usage, ['cacheWrite', 'cache_write', 'cacheWriteInputTokens', 'cache_write_input_tokens', 'cacheCreationInputTokens', 'cache_creation_input_tokens']);
  const total = usageField(usage, ['totalTokens', 'total_tokens', 'total']);
  return {
    usedTokens: total || inputTokens + outputTokens + cachedInputTokens + cacheWriteTokens,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    model: readString(message, ['model', 'modelId', 'model_id']) || readString(payload, ['model', 'modelId', 'model_id']) || undefined,
    updatedAt: eventTime(event, now),
  };
}

export type UsageRecordContext = {
  conversationId?: string;
  provider?: string;
  model?: string;
};

export function usageRecordFromV2Event(
  event: ConversationEvent,
  context: UsageRecordContext = {},
  now = Date.now(),
): UsageRecord | null {
  const usage = contextUsageFromV2Event(event, now);
  if (!usage) return null;
  const eventRecord = asRecord(event);
  const payload = asRecord(eventRecord?.payload);
  const conversationId = context.conversationId?.trim() || readString(eventRecord, ['conversationId', 'conversation_id']);
  if (!conversationId) return null;
  const eventId = readString(eventRecord, ['eventId', 'event_id', 'id']) || `sequence-${readNumber(eventRecord, ['sequence'], 0)}`;
  return {
    id: `${conversationId}:${eventId}`,
    conversationId,
    provider: context.provider?.trim() || readString(payload, ['provider']) || 'unknown',
    model: context.model?.trim() || usage.model || readString(payload, ['model', 'modelId', 'model_id']) || 'unknown',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    updatedAt: usage.updatedAt,
  };
}

export const usageRecordFromEvent = usageRecordFromV2Event;

export type TimelineEntry = {
  id: string;
  kind: 'incoming' | 'outgoing' | 'system';
  title: string;
  subtitle: string;
  raw: string;
  at: number;
  workspaceId?: string;
  conversationId?: string;
  requestId?: string;
};

function shortJsonValue(value: unknown): string {
  try {
    const encoded = JSON.stringify(value);
    return typeof encoded === 'string' ? encoded : String(value);
  } catch {
    return String(value);
  }
}

function textFromUnknown(value: unknown, depth = 0): string {
  if (depth > 5) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => textFromUnknown(item, depth + 1)).filter(Boolean).join('');
  }
  const record = asRecord(value);
  if (!record) return '';
  for (const key of ['text', 'content', 'thinking', 'reasoning', 'analysis', 'delta', 'output_text', 'outputText', 'summary', 'message', 'partialResult', 'partial_result', 'result']) {
    const text = textFromUnknown(record[key], depth + 1);
    if (text) return text;
  }
  return '';
}

function conversationContent(payload: JsonRecord, message: JsonRecord | null, delta: JsonRecord | null): string {
  const candidates: unknown[] = [
    payload.content,
    payload.text,
    typeof payload.delta === 'string' ? payload.delta : undefined,
    delta?.text,
    delta?.delta,
    delta?.content,
    delta?.thinking,
    delta?.reasoning,
    delta?.output_text,
    payload.message,
    message?.content,
  ];
  for (const candidate of candidates) {
    const text = textFromUnknown(candidate);
    if (text) return text;
  }
  return '';
}

function normalizeEventType(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isProviderLifecycleMethod(value: string): boolean {
  return /(?:^|[\/._-])mcp(?:[\/._-])(?:initialized|server(?:[\/._-])?status)$/i.test(value);
}

export function shouldAppendV2ConversationEvent(event: ConversationEvent): boolean {
  const eventRecord = asRecord(event);
  const payload = asRecord(eventRecord?.payload);
  const delta = asRecord(payload?.delta);
  const type = readString(eventRecord, ['type', 'eventType', 'event_type']);
  const deltaType = readString(delta, ['type', 'deltaType', 'delta_type']);
  return type === 'message.delta'
    || type === 'thought.delta'
    || /(?:thinking|text|toolcall)_delta$/i.test(deltaType);
}

/** Convert a v2 event into a render-neutral timeline entry. */
export function classifyV2ConversationEvent(
  event: ConversationEvent,
  workspaceId: string,
  activeTurnId = '',
  now = Date.now(),
): TimelineEntry | null {
  const eventRecord = asRecord(event);
  const payload = asRecord(eventRecord?.payload) || {};
  const message = asRecord(payload.message);
  const delta = asRecord(payload.delta);
  const type = readString(eventRecord, ['type', 'eventType', 'event_type']) || normalizeEventType(eventRecord?.type);
  const eventId = readString(eventRecord, ['eventId', 'event_id', 'id']) || `sequence-${readNumber(eventRecord, ['sequence'], 0)}`;
  const conversationId = readString(eventRecord, ['conversationId', 'conversation_id']);
  const content = conversationContent(payload, message, delta);
  const role = (readString(payload, ['role']) || readString(message, ['role'])).toLowerCase();
  const turnId = readString(payload, ['turnId', 'turn_id']) || activeTurnId;
  const deltaType = readString(delta, ['type', 'deltaType', 'delta_type']);
  const contentIndex = readNumber(delta, ['contentIndex', 'content_index'], -1);
  const streamId = turnId || (contentIndex >= 0 ? `content-${contentIndex}` : 'current');
  const providerMethod = readString(payload, ['providerMethod', 'provider_method', 'method']);
  const messageRole = readString(message, ['role']).toLowerCase();
  const at = eventTime(event, now);
  const base = { raw: shortJsonValue(event), at, workspaceId, conversationId };

  if (type === 'provider.event' && isProviderLifecycleMethod(providerMethod)) {
    return null;
  }

  if (type === 'message.created' && (role === 'user' || role === 'human')) {
    return { id: eventId, kind: 'outgoing', title: 'You', subtitle: content, ...base };
  }
  if (type === 'message.completed' && (role === 'user' || role === 'human')) {
    return null;
  }

  const thoughtPayload = ['thought', 'thoughtText', 'thought_text', 'reasoning', 'thinking', 'analysis']
    .map((key) => textFromUnknown(payload[key]))
    .find(Boolean) || '';
  const isThoughtEvent = type.startsWith('thought.')
    || /thought|reasoning|thinking|analysis/i.test(type)
    || /reasoning|thinking|analysis/i.test(deltaType)
    || /reasoning|thinking|analysis/i.test(providerMethod)
    || Boolean(thoughtPayload);
  if (isThoughtEvent) {
    const thought = thoughtPayload || content;
    return thought
      ? { id: `v2-thought-${conversationId}-${streamId}`, kind: 'system', title: '思考中', subtitle: thought, ...base }
      : null;
  }

  const isToolEvent = /tool|command|function|mcp/i.test(type)
    || /tool|command|function|mcp/i.test(deltaType)
    || /tool|command|function|mcp/i.test(providerMethod)
    || messageRole === 'tool'
    || Boolean(payload.tool || payload.toolCall || payload.tool_call || payload.command || payload.function || payload.functionCall || payload.function_call);
  if (isToolEvent) {
    return {
      id: `v2-tool-${conversationId}-${turnId || (contentIndex >= 0 ? `content-${contentIndex}` : eventId)}`,
      kind: 'system',
      title: '工具调用',
      subtitle: content || shortJsonValue(payload),
      ...base,
    };
  }

  if (type === 'message.created' || type === 'message.completed' || type === 'message.delta' || type.includes('agent') || type.includes('assistant')) {
    if (!content && type === 'turn.started') return null;
    if (content || type === 'message.created') {
      return {
        id: type === 'message.delta' || type === 'message.completed'
          ? `v2-assistant-${conversationId}-${turnId || 'current'}`
          : eventId,
        kind: 'incoming',
        title: 'Agent',
        subtitle: content || type,
        ...base,
      };
    }
  }

  if (type === 'conversation.created' || type === 'turn.started' || type === 'turn.completed' || type === 'turn.cancelled') {
    return null;
  }
  if (type.startsWith('mcp.') || type === 'skill.injected' || type.startsWith('permission.') || type === 'turn.failed') {
    return {
      id: eventId,
      kind: 'system',
      title: type,
      subtitle: (content || shortJsonValue(payload)).slice(0, 220),
      ...base,
    };
  }
  if (content) {
    return { id: eventId, kind: 'incoming', title: 'Agent', subtitle: content, ...base };
  }
  return null;
}

export function isLifecycleProgressText(text: string): boolean {
  return /^(starting|ready|started|completed|running|idle|busy)$/i.test(text.trim());
}

export function isChatReminderEntry(entry: Pick<TimelineEntry, 'subtitle' | 'title'>): boolean {
  const subtitle = typeof entry.subtitle === 'string' ? entry.subtitle : '';
  const title = typeof entry.title === 'string' ? entry.title : '';
  return subtitle.includes('本地会话启动超时')
    || title === '本地会话启动超时'
    || /^codex\.local\.(?:start|turn|attach|status|stop|interrupt)$/i.test(subtitle.trim());
}

export function isVisibleConversationEntry(entry: TimelineEntry): boolean {
  if (isChatReminderEntry(entry)) return false;
  if (entry.kind === 'outgoing' || entry.kind === 'incoming') return true;
  if (/^sent codex\./i.test(entry.title)) return false;
  if (entry.title === '协议指令' || entry.title === '已开始思考') return false;
  if (isLifecycleProgressText(entry.subtitle)) return false;
  return true;
}

export function isStepProgressEntry(entry: TimelineEntry): boolean {
  return entry.kind === 'system' && (
    entry.title === '执行步骤'
    || entry.title === '步骤完成'
    || entry.title === '请求权限批准'
    || entry.title === '工具调用'
    || entry.title === '思考中'
  );
}

export function isThinkingProgressEntry(entry: TimelineEntry): boolean {
  return entry.kind === 'system' && entry.title === '思考中';
}

export function isCollapsibleProgressEntry(entry: TimelineEntry): boolean {
  return isStepProgressEntry(entry) || isThinkingProgressEntry(entry);
}

export type ConversationRenderItem =
  | { type: 'entry'; entry: TimelineEntry }
  | { type: 'executionGroup'; id: string; entries: TimelineEntry[] };

export function executionGroupId(entries: TimelineEntry[]): string {
  const first = entries[0]?.id || 'empty';
  const last = entries[entries.length - 1]?.id || first;
  return `execution-group-${first}-${last}`;
}

export function buildConversationRenderItems(entries: TimelineEntry[]): ConversationRenderItem[] {
  const items: ConversationRenderItem[] = [];
  let index = 0;
  while (index < entries.length) {
    if (!isStepProgressEntry(entries[index])) {
      items.push({ type: 'entry', entry: entries[index] });
      index += 1;
      continue;
    }
    const group: TimelineEntry[] = [];
    while (index < entries.length && isStepProgressEntry(entries[index])) {
      group.push(entries[index]);
      index += 1;
    }
    items.push({ type: 'executionGroup', id: executionGroupId(group), entries: group });
  }
  return items;
}

export function conversationPreviewText(latest: TimelineEntry | undefined): string {
  const text = (latest?.subtitle || latest?.title || '').replace(/\s+/g, ' ').trim();
  return text || '新的对话';
}

export type WorkspaceLinkTarget =
  | { kind: 'browser-url'; url: string }
  | { kind: 'browser-file'; filePath: string }
  | { kind: 'file'; filePath: string }
  | null;

export type WorkspaceLinkOptions = {
  requireLoopback?: boolean;
};

function normalizeWorkspacePath(path: string): string {
  const prefix = path.startsWith('/') ? '/' : '';
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') normalized.pop();
    else normalized.push(part);
  }
  return `${prefix}${normalized.join('/')}` || prefix || '.';
}

export function workspaceLinkTarget(
  href: string | undefined,
  workspacePath: string | undefined,
  options: WorkspaceLinkOptions = {},
): WorkspaceLinkTarget {
  if (!href?.trim() || !workspacePath?.trim()) return null;
  const raw = href.trim();
  // Protocol-relative links must not be reinterpreted as workspace paths.
  if (raw.startsWith('//')) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (options.requireLoopback && !isLoopbackUrl(parsed)) return null;
      return { kind: 'browser-url', url: parsed.toString() };
    }
    return null;
  } catch {
    // Relative and absolute workspace paths are handled below.
  }
  const pathPart = raw.split(/[?#]/, 1)[0];
  if (!pathPart) return null;
  let decodedPath = pathPart;
  try {
    decodedPath = decodeURIComponent(pathPart);
  } catch {
    return null;
  }
  const root = normalizeWorkspacePath(workspacePath);
  const rootWithoutSlash = root === '/' ? '/' : root.replace(/\/$/, '');
  const candidate = normalizeWorkspacePath(decodedPath.startsWith('/')
    ? decodedPath
    : `${rootWithoutSlash}/${decodedPath}`);
  const insideRoot = rootWithoutSlash === '/'
    ? candidate.startsWith('/')
    : candidate === rootWithoutSlash || candidate.startsWith(`${rootWithoutSlash}/`);
  if (!insideRoot) return null;
  const extension = candidate.split('/').pop()?.split('.').pop()?.toLowerCase() || '';
  if (extension === 'html' || extension === 'htm' || extension === 'xhtml' || extension === 'svg') {
    return { kind: 'browser-file', filePath: candidate };
  }
  return { kind: 'file', filePath: candidate };
}

function normalizedHostname(value: string): string {
  return value.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

export function isLoopbackHostname(hostname: string | null | undefined): boolean {
  if (typeof hostname !== 'string') return false;
  const host = normalizedHostname(hostname);
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  const ipv4 = host.split('.');
  if (ipv4.length === 4 && ipv4[0] === '127') {
    return ipv4.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
  }
  // URL.hostname can expose an IPv4-mapped IPv6 loopback address.
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isLoopbackHostname(mapped[1]);
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    const mappedIpv4 = `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
    return isLoopbackHostname(mappedIpv4);
  }
  return false;
}

export function isLoopbackUrl(value: string | URL): boolean {
  let parsed: URL;
  try {
    parsed = value instanceof URL ? value : new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  return isLoopbackHostname(parsed.hostname);
}

export type LoopbackUrlValidation =
  | { ok: true; url: string }
  | { ok: false; reason: string };

export function validateLoopbackUrl(value: string | null | undefined): LoopbackUrlValidation {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return { ok: false, reason: 'missing URL' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'only HTTP(S) URLs are supported' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'credentials are not allowed' };
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    return { ok: false, reason: 'URL must point to localhost or 127.0.0.0/8' };
  }
  return { ok: true, url: parsed.toString() };
}

export type ProviderIconMetadata = {
  id: string;
  label: string;
  icon: string;
  iconName: string;
  color: string;
  backgroundColor: string;
  accessibilityLabel: string;
};

const PROVIDER_ICON_FALLBACK: ProviderIconMetadata = {
  id: 'unknown',
  label: 'Agent',
  icon: 'cube-outline',
  iconName: 'cube-outline',
  color: '#66717c',
  backgroundColor: '#edf0f2',
  accessibilityLabel: 'Agent',
};

export const PROVIDER_ICON_METADATA: Readonly<Record<string, ProviderIconMetadata>> = Object.freeze({
  acp: {
    id: 'acp',
    label: 'ACP',
    icon: 'git-network-outline',
    iconName: 'git-network-outline',
    color: '#7c5cbf',
    backgroundColor: '#f0eafd',
    accessibilityLabel: 'ACP',
  },
  codex: {
    id: 'codex',
    label: 'Codex CLI',
    icon: 'code-slash-outline',
    iconName: 'code-slash-outline',
    color: '#2b7a70',
    backgroundColor: '#e2f4ef',
    accessibilityLabel: 'Codex CLI',
  },
  pi: {
    id: 'pi',
    label: 'Pi',
    icon: 'radio-outline',
    iconName: 'radio-outline',
    color: '#b26a2b',
    backgroundColor: '#fbefe2',
    accessibilityLabel: 'Pi',
  },
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code',
    icon: 'sparkles-outline',
    iconName: 'sparkles-outline',
    color: '#b4573f',
    backgroundColor: '#f9e8e2',
    accessibilityLabel: 'Claude Code',
  },
  'grok-build': {
    id: 'grok-build',
    label: 'Grok Build',
    icon: 'hammer-outline',
    iconName: 'hammer-outline',
    color: '#3d6c8e',
    backgroundColor: '#e5f0f6',
    accessibilityLabel: 'Grok Build',
  },
});

function canonicalProviderId(value: string): string {
  const id = value.trim().toLowerCase();
  if (id === 'claude-code' || id.includes('claude')) return 'claude-code';
  if (id === 'codex' || id.includes('codex')) return 'codex';
  if (id === 'pi' || id.startsWith('pi-')) return 'pi';
  if (id === 'acp') return 'acp';
  if (id === 'grok-build' || id === 'grok' || id === 'grok_build') return 'grok-build';
  return id;
}

/** Return icon metadata suitable for Ionicons/Touchable mobile components. */
export function providerIconMetadata(provider?: string | null): ProviderIconMetadata {
  const raw = provider?.trim() || '';
  const id = canonicalProviderId(raw);
  const known = PROVIDER_ICON_METADATA[id];
  if (known) return { ...known };
  if (!raw) return { ...PROVIDER_ICON_FALLBACK };
  return {
    ...PROVIDER_ICON_FALLBACK,
    id,
    label: raw,
    accessibilityLabel: raw,
  };
}

export const providerIconFor = providerIconMetadata;

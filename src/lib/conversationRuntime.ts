/** Shared deterministic projection for both realtime delivery and history replay. */
import { canonicalConversationEventType, contextCompactionStatus, normalizeConversationEvent } from './v2';
import type { ConversationEvent, ContextCompactionState, MemoryEntry, SubagentRun } from './v2';
import { classifyV2ConversationEvent, contextUsageFromV2Event, shouldAppendV2ConversationEvent, usageRecordFromV2Event } from './mobileParity';
import type { ConversationContextUsage, TimelineEntry, UsageRecord } from './mobileParity';

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const string = (value: unknown): string => typeof value === 'string' ? value : '';
const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
export type RuntimePermission = { id: string; turnId: string; event: ConversationEvent; payload: RecordValue };
export type RuntimeCompaction = ContextCompactionState & { recommended: boolean };
export type ConversationRuntime = {
  conversationId: string;
  workspaceId: string;
  appliedSequence: number;
  highWaterSequence: number;
  pendingEvents: Record<number, ConversationEvent>;
  timeline: TimelineEntry[];
  activeTurnId: string;
  status: 'idle' | 'running' | 'waitingPermission' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
  usageRecords: UsageRecord[];
  contextUsage: ConversationContextUsage | null;
  cumulativeUsage: Record<string, number> | null;
  subagents: SubagentRun[];
  compaction: RuntimeCompaction;
  memoryEntries: MemoryEntry[];
  pendingPermissions: RuntimePermission[];
  requestedConfig: RecordValue | null;
  effectiveConfig: RecordValue | null;
  configurationStatus: 'unknown' | 'validated' | 'provider-confirmed';
  lastProgressAt: string | null;
};
export function createConversationRuntime(conversationId: string, workspaceId: string): ConversationRuntime {
  return {
    conversationId, workspaceId, appliedSequence: 0, highWaterSequence: 0, pendingEvents: {},
    timeline: [], activeTurnId: '', status: 'idle', usageRecords: [], contextUsage: null, cumulativeUsage: null,
    subagents: [], compaction: { status: 'idle', recommended: false, updatedAt: '' }, memoryEntries: [],
    pendingPermissions: [], requestedConfig: null, effectiveConfig: null, configurationStatus: 'unknown', lastProgressAt: null,
  };
}

/** Cached tokens are a subset for included semantics; unknown counts are never added twice. */
export function usageTotalTokens(record: UsageRecord): number {
  return record.totalTokens ?? record.inputTokens + record.outputTokens
    + (record.cacheSemantics === 'additional' ? record.cachedInputTokens + record.cacheWriteTokens : 0);
}
export function upsertUsageRecord(records: UsageRecord[], record: UsageRecord, limit = 2000): UsageRecord[] {
  const previous = records.find(item => item.id === record.id);
  if (previous && (previous.sequence ?? 0) > (record.sequence ?? 0)) return records;
  return [record, ...records.filter(item => item.id !== record.id)].slice(0, limit);
}
function usageProjection(state: ConversationRuntime, event: ConversationEvent, turnId: string): void {
  const usage = contextUsageFromV2Event(event);
  if (!usage) return;
  state.contextUsage = usage;
  state.compaction = { ...state.compaction, usedTokens: usage.usedTokens, contextWindow: usage.contextWindow,
    recommended: contextCompactionStatus(usage.usedTokens, usage.contextWindow) === 'recommended' };
  const payload = object(event.payload);
  const provider = string(event.provider) || string(payload.provider) || 'unknown';
  const raw = usageRecordFromV2Event(event, { provider });
  if (!raw) return;
  const normalized = object(payload.usage);
  const tokenUsage = object(payload.tokenUsage ?? object(payload.metadata).tokenUsage);
  const cumulative = object(normalized.cumulative ?? tokenUsage.total);
  const read = (primary: string, alias: string) => number(cumulative[primary] ?? cumulative[alias]);
  const cacheSemantics = string(normalized.cacheSemantics ?? payload.cacheSemantics);
  const semantics: UsageRecord['cacheSemantics'] = cacheSemantics === 'included' || cacheSemantics === 'additional'
    ? cacheSemantics : provider === 'codex' ? 'included' : provider === 'claude-code' ? 'additional' : 'unknown';
  let record: UsageRecord = { ...raw, turnId: turnId || undefined, sequence: event.sequence,
    scope: turnId ? 'turn' : 'unknown', cacheSemantics: semantics };
  if (Object.keys(cumulative).length > 0) {
    const counters = { inputTokens: read('input', 'inputTokens'), outputTokens: read('output', 'outputTokens'),
      cachedInputTokens: read('cacheRead', 'cachedInputTokens'), cacheWriteTokens: read('cacheWrite', 'cacheWriteInputTokens'),
      totalTokens: read('total', 'totalTokens') };
    // Session counters can reset on process replacement. The new epoch starts at zero.
    const prior = state.cumulativeUsage;
    const reset = prior && Object.keys(counters).some(key => counters[key as keyof typeof counters] < (prior[key] ?? 0));
    const baseline = reset ? null : prior;
    const id = `${state.conversationId}:usage:${turnId || 'unattributed'}`;
    const previous = state.usageRecords.find(item => item.id === id);
    record = { ...record, id };
    for (const key of Object.keys(counters) as Array<keyof typeof counters>) {
      record[key] = (previous?.[key] ?? 0) + Math.max(0, counters[key] - (baseline?.[key] ?? 0));
    }
    if (!counters.totalTokens) record.totalTokens = record.inputTokens + record.outputTokens;
    state.cumulativeUsage = counters;
  } else {
    const message = object(payload.message);
    const messageId = string(payload.messageId ?? message.id ?? object(payload.block).id);
    const requestId = string(payload.usageId ?? payload.requestId);
    const messageScope = payload.scope === 'message' || canonicalConversationEventType(event) === 'message.completed';
    // Equal token values cannot prove two provider calls were the same call.
    const identity = messageId || requestId || (messageScope ? event.eventId : turnId || event.eventId);
    record.id = `${state.conversationId}:usage:${identity}`;
    record.scope = messageId || requestId || messageScope ? 'request' : turnId ? 'turn' : 'unknown';
    const explicitTotal = object(normalized.last).total ?? normalized.totalTokens ?? normalized.total_tokens ?? normalized.total
      ?? object(message.usage).totalTokens ?? object(message.usage).total_tokens ?? object(message.usage).total;
    if (typeof explicitTotal === 'number') record.totalTokens = number(explicitTotal);
  }
  state.usageRecords = upsertUsageRecord(state.usageRecords, record);
}

function projectEvent(state: ConversationRuntime, event: ConversationEvent): void {
  const payload = object(event.payload);
  const type = canonicalConversationEventType(event);
  const block = object(payload.block);
  const explicitTurnId = string(payload.turnId ?? payload.turn_id ?? block.turnId);
  const turnId = explicitTurnId || state.activeTurnId;
  if (type === 'turn.started') {
    state.activeTurnId = explicitTurnId;
    state.status = 'running';
    state.requestedConfig = payload.requestedPermissions ? object(payload.requestedPermissions) : null;
    state.effectiveConfig = payload.effectivePermissions
      ? { ...object(payload.effectivePermissions), source: 'locally-validated' } : null;
    state.configurationStatus = payload.configurationStatus === 'validated' ? 'validated' : 'unknown';
  }
  const entry = classifyV2ConversationEvent(event, state.workspaceId, turnId);
  if (entry) {
    const existing = state.timeline.find(item => item.id === entry.id);
    const next = existing && shouldAppendV2ConversationEvent(event)
      ? { ...existing, ...entry, subtitle: `${existing.subtitle === '正在回复...' ? '' : existing.subtitle}${entry.subtitle}` }
      : entry;
    state.timeline = existing ? state.timeline.map(item => item.id === next.id ? next : item) : [next, ...state.timeline];
  }
  if (type === 'permission.requested' || type === 'tool.awaitingApproval') {
    const id = string(payload.permissionId ?? payload.requestId);
    if (id) state.pendingPermissions = [...state.pendingPermissions.filter(item => item.id !== id), { id, turnId, event, payload }];
    if (id && (!explicitTurnId || explicitTurnId === state.activeTurnId)) state.status = 'waitingPermission';
  }
  if (type === 'permission.resolved') {
    const id = string(payload.permissionId ?? payload.requestId);
    state.pendingPermissions = state.pendingPermissions.filter(item => item.id !== id);
    if (!state.pendingPermissions.length && state.status === 'waitingPermission') state.status = state.activeTurnId ? 'running' : 'idle';
  }
  if (['turn.completed', 'turn.cancelled', 'turn.interrupted', 'turn.failed'].includes(type)) {
    state.pendingPermissions = state.pendingPermissions.filter(item => explicitTurnId && item.turnId !== explicitTurnId);
    if (!explicitTurnId || !state.activeTurnId || explicitTurnId === state.activeTurnId) {
      state.activeTurnId = '';
      state.status = type === 'turn.failed' ? 'failed' : type === 'turn.cancelled' ? 'cancelled' : type === 'turn.interrupted' ? 'interrupted' : 'completed';
    }
  }
  usageProjection(state, event, turnId);
  if (type.startsWith('compaction.')) {
    const phase = type.slice('compaction.'.length);
    if (['started', 'completed', 'failed', 'cancelled'].includes(phase)) {
      state.compaction = { ...state.compaction,
        status: phase === 'started' ? 'running' : phase === 'cancelled' ? 'idle' : phase as 'completed' | 'failed',
        updatedAt: event.time, summary: string(payload.summary) || undefined,
        error: phase === 'failed' ? string(payload.error ?? payload.message) || '上下文压缩失败' : undefined };
    }
  }
  if (type.startsWith('subagent.')) {
    const id = string(payload.subagentId ?? payload.agentId ?? payload.id);
    if (id) {
      const previous = state.subagents.find(item => item.id === id);
      const phase = type.slice('subagent.'.length);
      const status: SubagentRun['status'] = phase === 'started' ? 'running' : phase === 'completed' ? 'completed'
        : phase === 'failed' ? 'failed' : phase === 'cancelled' ? 'cancelled' : previous?.status ?? 'queued';
      const run: SubagentRun = { id, conversationId: state.conversationId,
        title: string(payload.title) || previous?.title || 'Subagent', task: string(payload.task ?? payload.prompt) || previous?.task || '',
        ...previous, status,
        ...(typeof payload.result === 'string' ? { result: payload.result } : {}),
        ...(typeof payload.error === 'string' ? { error: payload.error } : {}),
        ...(status === 'running' ? { startedAt: previous?.startedAt ?? event.time }
          : status !== 'queued' ? { finishedAt: event.time } : {}),
      };
      state.subagents = [run, ...state.subagents.filter(item => item.id !== id)];
    }
  }
  if (type === 'memory.updated' || type === 'memory.created') {
    const id = string(payload.memoryId ?? payload.id);
    const content = string(payload.content ?? payload.text);
    if (id && content) {
      const previous = state.memoryEntries.find(item => item.id === id);
      const memory: MemoryEntry = { id, content, scope: payload.scope === 'user' || payload.scope === 'workspace' ? payload.scope : 'conversation',
        source: string(payload.source) || undefined, createdAt: previous?.createdAt ?? event.time, updatedAt: event.time };
      state.memoryEntries = [memory, ...state.memoryEntries.filter(item => item.id !== id)];
    }
  } else if (type === 'memory.deleted') {
    state.memoryEntries = state.memoryEntries.filter(item => item.id !== string(payload.memoryId ?? payload.id));
  }
  if ((!explicitTurnId || !state.activeTurnId || explicitTurnId === state.activeTurnId)
    && (type === 'turn.configuration' || payload.effectiveConfig)) {
    if (payload.requested) state.requestedConfig = object(payload.requested);
    const effective = object(payload.effective ?? payload.effectiveConfig);
    state.effectiveConfig = effective;
    state.configurationStatus = effective.source === 'provider-confirmed' ? 'provider-confirmed' : 'unknown';
  }
  state.lastProgressAt = event.time;
}

export type ConversationRuntimeUpdate = { state: ConversationRuntime; appliedEvents: ConversationEvent[]; missingSequences: number[] };
/** Never seed appliedSequence from a high-water mark or a truncated timeline. */
export function applyConversationRuntimeEvents(previous: ConversationRuntime, events: readonly ConversationEvent[]): ConversationRuntimeUpdate {
  const incoming = events.map(normalizeConversationEvent).filter((event): event is ConversationEvent =>
    event !== null && event.conversationId === previous.conversationId && event.sequence > previous.appliedSequence
    && !previous.pendingEvents[event.sequence]);
  // Continuous journal sequence is the authoritative delivery identity.
  if (!incoming.length) return { state: previous, appliedEvents: [], missingSequences: missingRuntimeSequences(previous) };
  const state: ConversationRuntime = { ...previous, pendingEvents: { ...previous.pendingEvents } };
  const appliedEvents: ConversationEvent[] = [];
  for (const event of incoming) {
    state.highWaterSequence = Math.max(state.highWaterSequence, event.sequence);
    if (!state.pendingEvents[event.sequence]) state.pendingEvents[event.sequence] = event;
  }
  while (state.pendingEvents[state.appliedSequence + 1]) {
    const event = state.pendingEvents[state.appliedSequence + 1];
    delete state.pendingEvents[event.sequence];
    state.appliedSequence = event.sequence;
    projectEvent(state, event);
    appliedEvents.push(event);
  }
  return { state, appliedEvents, missingSequences: missingRuntimeSequences(state) };
}
function missingRuntimeSequences(state: ConversationRuntime): number[] {
  const missing: number[] = [];
  const end = Math.min(state.highWaterSequence, state.appliedSequence + 10000);
  for (let sequence = state.appliedSequence + 1; sequence <= end; sequence++) {
    if (!state.pendingEvents[sequence]) missing.push(sequence);
  }
  return missing;
}

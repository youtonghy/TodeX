import { type TextInputSelectionChangeEventData } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import {
  BackendConnectionProfile,
  ConnectionSettings,
  CodexNativeThread,
  CodexModelCatalogItem,
  CodexMcpServerStatus,
  CodexHooksListEntry,
  CodexMemorySettings,
  CodexPermissionProfileSummary,
  CodexPluginListResult,
  CodexReasoningEffortOption,
  DEFAULT_REASONING_EFFORT_OPTIONS,
  FAST_SERVICE_TIER,
  FALLBACK_CODEX_MODELS,
  LocalAdapterState,
  PendingRequest,
  ServerEvent,
  WorkspaceRecord,
  buildHttpUrl,
  createRequestId,
  eventId,
  eventPayloadData,
  extractThreadIdFromEvent,
  normalizeReasoningEffort,
  normalizeThreadId,
  normalizeServerUrl,
  parseCodexNativeThread,
  parseMcpServerStatusListResponse,
  parsePermissionProfileListResponse,
  prepareWorkspaceSyncPayload,
  shortJson,
  type CodexServiceTierOption,
  type CodexThreadHistoryEntry,
} from './todex';
import { type PairingQrChunk, type TransportCryptoSession } from './transportCrypto';
import {
  cursorFromEvent as transportCursorFromEvent,
  sessionIdFromEvent as transportSessionIdFromEvent,
} from './transport';
import { V2ApiClient, providerDisplayName, type ConversationEvent, type ConversationManifest, type ProviderDescriptor, type ProviderKind } from './v2';
import { WORKBENCH_TABS, type WorkbenchTab } from './workbench';
import {
  buildConversationRenderItems as sharedBuildConversationRenderItems,
  classifyV2ConversationEvent as sharedClassifyV2ConversationEvent,
  shouldAppendV2ConversationEvent as sharedShouldAppendV2ConversationEvent,
  isCollapsibleProgressEntry as sharedIsCollapsibleProgressEntry,
  isStepProgressEntry as sharedIsStepProgressEntry,
  isThinkingProgressEntry as sharedIsThinkingProgressEntry,
  isVisibleConversationEntry as sharedIsVisibleConversationEntry,
  normalizeBackendConnectionProfile as sharedNormalizeBackendConnectionProfile,
  profileFromSettings as sharedProfileFromSettings,
  settingsFromProfile as sharedSettingsFromProfile,
  validateLoopbackUrl,
} from './mobileParity';

export type ServerVersion = {
  name: string;
  version: string;
  data_dir: string;
  workspace_root: string;
};

export type WorkspaceDirectoryEntry = {
  name: string;
  path: string;
  kind: 'directory';
};

export type WorkspaceDirectorySnapshot = {
  root: string;
  current: string;
  parent: string | null;
  entries: WorkspaceDirectoryEntry[];
};

export type ConversationRecord = {
  id: string;
  workspaceId: string;
  backendConnectionId?: string | null;
  title: string;
  preview?: string;
  nativeStatus?: string;
  nativeUpdatedAt?: number;
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

export type MobileUsageRecord = {
  id: string;
  workspaceId: string;
  conversationId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  contextWindow?: number;
  updatedAt: number;
};

export type MobileContextUsage = {
  usedTokens: number;
  contextWindow?: number;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  updatedAt: number;
};

export type MobileWorkbenchState = {
  tabs: Array<'terminal' | 'browser' | 'files' | 'git-diff'>;
  activeTab: 'terminal' | 'browser' | 'files' | 'git-diff';
  browserUrl: string;
  browserFilePath: string;
  inspectedElement: { selector: string; tagName: string; text: string } | null;
};

export type GitRepositorySummary = {
  path: string;
  name: string;
  branch: string;
  initialEligible: boolean;
  files: Array<{ path: string; status: string; additions: number; deletions: number }>;
  additions: number;
  deletions: number;
  error?: string;
};

export type PendingThreadList = {
  workspaceId: string;
  sessionId: string;
  requestId: string;
  timeoutId: ReturnType<typeof setTimeout>;
};

export type PendingGitDiff = {
  workspaceId: string;
  conversationId: string;
  requestId: string;
  timeoutId: ReturnType<typeof setTimeout>;
};

export type ExperimentalFeatureId =
  | 'gitDiffViewer'
  | 'verboseRuntimeEvents'
  | 'composerFileMentions';

export type ExperimentalFeatureSettings = Record<ExperimentalFeatureId, boolean>;

export type ExperimentalFeatureDefinition = {
  id: ExperimentalFeatureId;
  title: string;
  description: string;
  scope: string;
};

export type GitDiffState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  diff: string;
  sha: string;
  error: string;
  updatedAt: number;
};

export type McpInventoryState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  detail: 'toolsAndAuthOnly' | 'full';
  servers: CodexMcpServerStatus[];
  raw: unknown;
  error: string;
  updatedAt: number;
};

export type PermissionProfilesState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  profiles: CodexPermissionProfileSummary[];
  raw: unknown;
  error: string;
  updatedAt: number;
};

export type HooksCatalogState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  entries: CodexHooksListEntry[];
  raw: unknown;
  error: string;
  updatedAt: number;
};

export type PluginsCatalogState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  catalog: CodexPluginListResult;
  raw: unknown;
  error: string;
  updatedAt: number;
};

export type MemorySettingsState = {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error';
  settings: CodexMemorySettings;
  raw: unknown;
  error: string;
  updatedAt: number;
};

export type TerminalLifecycleState = 'idle' | 'starting' | 'running' | 'stopping' | 'exited' | 'error';

export type TerminalOutputEntry = {
  id: string;
  kind: 'stdout' | 'stderr' | 'input' | 'system' | 'error';
  text: string;
  at: number;
};

export type TerminalClientState = {
  terminalId: string;
  workspaceId: string;
  conversationId: string;
  tenantId: string;
  cwd: string;
  shell: string;
  rows: number;
  cols: number;
  status: TerminalLifecycleState;
  output: TerminalOutputEntry[];
  outputTruncated?: boolean;
  error: string;
  pid?: number | null;
  exitCode?: number | null;
  updatedAt: number;
};

export type PendingThreadAction = {
  workspaceId: string;
  conversationId: string;
  requestId: string;
  action:
    | 'start'
    | 'resume'
    | 'fork'
    | 'archive'
    | 'unarchive'
    | 'rename'
    | 'rollback'
    | 'read'
    | 'detail'
    | 'turns'
    | 'items'
    | 'metadata'
    | 'memory'
    | 'memoryReset'
    | 'unsubscribe'
    | 'shell'
    | 'guardian'
    | 'clean'
    | 'loaded'
    | 'hooks'
    | 'plugins'
    | 'mcp'
    | 'permission'
    | 'permissionProfiles'
    | 'memorySettings'
    | 'inject';
  timeoutId: ReturnType<typeof setTimeout>;
  sourceConversationId?: string;
  title?: string;
  restoreHistory?: boolean;
  showResult?: boolean;
  resultTitle?: string;
  resultDetail?: string;
  memorySettings?: CodexMemorySettings;
};

export type ComposerSelection = TextInputSelectionChangeEventData['selection'];

export const DEFAULT_COMPOSER_SELECTION: ComposerSelection = { start: 0, end: 0 };

export type PairingChunkCollector = {
  checksum: string;
  total: number;
  chunks: Map<number, PairingQrChunk>;
};

export type ComposerAttachmentDraft = {
  id: string;
  kind: 'image' | 'file';
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  dataUrl: string;
  textContent?: string;
  source: 'clipboard' | 'library' | 'file';
};

export type QueuedChatSubmission = {
  id: string;
  text: string;
  attachments: ComposerAttachmentDraft[];
  skills: SelectedSkillAttachment[];
};

export type PendingLocalStart = {
  workspaceId: string;
  conversationId: string;
  sessionId: string;
  requestId: string;
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

export type PendingThreadStart = {
  conversationId: string;
  requestId: string;
  promise: Promise<string>;
  resolve: (threadId: string) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

export type PendingModelList = {
  requestId: string;
  timeoutId: ReturnType<typeof setTimeout>;
};

export type PendingSkillList = {
  workspaceId: string;
  conversationId: string;
  requestId: string;
  timeoutId: ReturnType<typeof setTimeout>;
};

export type PendingJsonSave = {
  timeoutId: ReturnType<typeof setTimeout>;
  value: unknown;
};

export type PendingSocketFrame = {
  data: string;
  generation: number;
  crypto: TransportCryptoSession | null;
};

export type PendingTimelineUpsert = {
  entry: TimelineEntry;
  appendSubtitle: boolean;
};

export type ConversationContext = {
  workspace: WorkspaceRecord;
  conversation: ConversationRecord;
};

export type ModelCommandPromptState = {
  conversationId: string;
  initialValue: string;
  target?: 'workspace' | 'settings';
};

export type ModelPickerPromptState = {
  target: 'workspace' | 'settings';
  conversationId?: string;
};

export type ThreadInfoModalState = {
  title: string;
  detail: string;
  raw?: unknown;
};

export type ThreadCommandPromptState = {
  conversationId: string;
  command: 'metadata' | 'memory' | 'shell' | 'items' | 'inject' | 'guardian';
  title: string;
  placeholder: string;
  initialValue: string;
  warning?: string;
  multiline?: boolean;
};

export type SkillListStatus = 'idle' | 'loading' | 'ready' | 'error';

export type SkillListItem = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  shortDescription: string;
  scope: string;
  path: string;
  enabled: boolean;
};

export type SelectedSkillAttachment = {
  name: string;
  path: string;
  displayName: string;
  resourceId?: string;
  provider?: ProviderKind | string;
};

export type ThreadMenuAction =
  | 'resume'
  | 'fork'
  | 'archive'
  | 'unarchive'
  | 'rollback'
  | 'compact'
  | 'detail'
  | 'history'
  | 'turns'
  | 'items'
  | 'metadata'
  | 'memory'
  | 'shell'
  | 'unsubscribe'
  | 'loaded'
  | 'clean'
  | 'inject';

export type TimelineTarget = {
  workspaceId: string;
  conversationId: string;
};

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export type RuntimeStatusState = {
  socket: ConnectionState;
  daemon: ConnectionHealth['status'];
  codexAdapter: LocalAdapterState | 'unknown';
  turn: 'idle' | 'running';
};

export type ConnectionHealth = {
  status: 'unknown' | 'checking' | 'online' | 'offline';
  latencyMs: number | null;
  lastCheckedAt: number | null;
  error: string;
  code?: string;
};

export const CONNECTION_HEALTH_INTERVAL_MS = 5000;
export const CONNECTION_HEALTH_TIMEOUT_MS = 3500;
export const MAX_COMPOSER_ATTACHMENTS = 8;
export const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_FILE_ATTACHMENT_BYTES = 512 * 1024;

export function localConversationStateOf(conversation: ConversationRecord | null): LocalAdapterState {
  return conversation?.localAdapterState ?? 'idle';
}

export function isConversationHighlighted(conversation: ConversationRecord, activeConversationId: string, activeTurns: Record<string, string>): boolean {
  return conversation.id === activeConversationId || Boolean(activeTurns[conversation.id]);
}

export function sessionIdForConversation(workspace: WorkspaceRecord, conversation: ConversationRecord): string {
  return conversation.sessionId || workspace.sessionId || createSessionId(workspace.name);
}

export function commandWorkspaceForConversation(workspace: WorkspaceRecord, conversation: ConversationRecord): WorkspaceRecord {
  return {
    ...workspace,
    sessionId: sessionIdForConversation(workspace, conversation),
    threadId: normalizeThreadId(conversation.threadId),
    localAdapterState: localConversationStateOf(conversation),
  };
}

export function isLocalAdapterAlreadyRunning(text: string): boolean {
  return /adapter already owns this session/i.test(text);
}

export function isLocalAdapterFailed(text: string): boolean {
  return /local Codex adapter is not ready;\s*current state is Failed/i.test(text);
}

export function isThreadNotFound(text: string): boolean {
  return /thread not found/i.test(text);
}

export function localTurnErrorMessage(text: string): string {
  if (isThreadNotFound(text)) {
    return '当前对话的 thread 已失效，下一次发送会为该对话自动创建新的 thread。';
  }
  if (isLocalAdapterFailed(text)) {
    return '本地会话状态已失效，请重新发送消息以启动新的会话。';
  }
  if (isLocalAdapterAlreadyRunning(text)) {
    return '本地会话已经在运行，不要重复启动。';
  }
  if (/unsupported_action/i.test(text) || /not running for this session/i.test(text)) {
    return '本地会话还没启动，先执行 start 再发送消息。';
  }
  return text;
}

export function attachmentId(): string {
  return createRequestId('att');
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) {
    return 'unknown';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 102.4) / 10} KB`;
  }
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
}

export function fileNameFromUri(uri: string, fallback: string): string {
  const clean = uri.split('?')[0]?.split('#')[0] ?? uri;
  const part = clean.split('/').filter(Boolean).pop();
  return part ? decodeURIComponent(part) : fallback;
}

export function inferMimeType(name: string, fallback = 'application/octet-stream'): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'txt':
      return 'text/plain';
    case 'md':
    case 'markdown':
      return 'text/markdown';
    case 'json':
      return 'application/json';
    case 'csv':
      return 'text/csv';
    case 'pdf':
      return 'application/pdf';
    default:
      return fallback;
  }
}

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('image/');
}

export function isTextAttachment(name: string, mimeType: string): boolean {
  const lowerMime = mimeType.toLowerCase();
  const lowerName = name.toLowerCase();
  return (
    lowerMime.startsWith('text/') ||
    lowerMime === 'application/json' ||
    lowerMime === 'application/xml' ||
    lowerName.endsWith('.md') ||
    lowerName.endsWith('.json') ||
    lowerName.endsWith('.csv') ||
    lowerName.endsWith('.xml') ||
    lowerName.endsWith('.yaml') ||
    lowerName.endsWith('.yml')
  );
}

export function mimeTypeFromDataUrl(dataUrl: string): string | null {
  const match = /^data:([^;,]+)[;,]/i.exec(dataUrl.trim());
  return match?.[1] ?? null;
}

export function base64FromDataUrl(dataUrl: string): string {
  const marker = ';base64,';
  const index = dataUrl.indexOf(marker);
  return index >= 0 ? dataUrl.slice(index + marker.length) : '';
}

export function dataUrlFromBase64(base64: string, mimeType: string): string {
  const trimmed = base64.trim();
  if (trimmed.startsWith('data:')) {
    return trimmed;
  }
  return `data:${mimeType};base64,${trimmed}`;
}

export function estimatedBytesFromBase64(base64: string): number {
  const normalized = base64.replace(/\s/g, '');
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

export async function readBase64DataUrl(uri: string, mimeType: string, base64?: string | null): Promise<{ dataUrl: string; sizeBytes: number | null }> {
  if (base64) {
    const dataUrl = dataUrlFromBase64(base64, mimeType);
    return {
      dataUrl,
      sizeBytes: estimatedBytesFromBase64(base64FromDataUrl(dataUrl) || base64),
    };
  }
  if (uri.startsWith('data:')) {
    return {
      dataUrl: uri,
      sizeBytes: estimatedBytesFromBase64(base64FromDataUrl(uri)),
    };
  }
  const encoded = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return {
    dataUrl: dataUrlFromBase64(encoded, mimeType),
    sizeBytes: estimatedBytesFromBase64(encoded),
  };
}

export async function resolveFileSizeBytes(uri: string, fallbackSizeBytes: number | null | undefined): Promise<number | null> {
  if (typeof fallbackSizeBytes === 'number') {
    return fallbackSizeBytes;
  }
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      return null;
    }
    return 'size' in info && typeof info.size === 'number' ? info.size : null;
  } catch {
    return null;
  }
}

export async function readTextAttachmentContent(uri: string, name: string, mimeType: string, sizeBytes: number | null): Promise<string | undefined> {
  if (!isTextAttachment(name, mimeType) || (sizeBytes ?? 0) > MAX_FILE_ATTACHMENT_BYTES) {
    return undefined;
  }
  if (uri.startsWith('data:')) {
    return undefined;
  }
  try {
    return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
  } catch {
    return undefined;
  }
}

export function attachmentPrompt(attachments: ComposerAttachmentDraft[]): string {
  if (attachments.length === 0) {
    return '';
  }
  const imageCount = attachments.filter((item) => item.kind === 'image').length;
  const fileCount = attachments.length - imageCount;
  if (imageCount > 0 && fileCount > 0) {
    return `请查看这 ${attachments.length} 个附件。`;
  }
  if (imageCount > 0) {
    return imageCount === 1 ? '请查看这张图片。' : `请查看这 ${imageCount} 张图片。`;
  }
  return fileCount === 1 ? '请查看这个文件。' : `请查看这 ${fileCount} 个文件。`;
}

export function attachmentTextBlock(attachment: ComposerAttachmentDraft): string {
  const header = [
    `[附件: ${attachment.name}]`,
    `MIME: ${attachment.mimeType}`,
    `Size: ${formatBytes(attachment.sizeBytes)}`,
  ].join('\n');
  if (attachment.textContent) {
    return `${header}\nContent:\n${attachment.textContent}`;
  }
  return `${header}\nData URL:\n${attachment.dataUrl}`;
}

export function codexInputFromComposer(
  text: string,
  attachments: ComposerAttachmentDraft[],
  skills: SelectedSkillAttachment[] = [],
): Record<string, unknown>[] {
  const trimmed = text.trim();
  const items: Record<string, unknown>[] = [
    { type: 'text', text: trimmed || attachmentPrompt(attachments) || (skills.length ? '请使用已选择的 Skill。' : '') },
  ];
  skills.forEach((skill) => {
    items.push({
      type: 'skill',
      name: skill.name,
      path: skill.path,
    });
  });
  attachments.forEach((attachment) => {
    if (attachment.kind === 'image') {
      items.push({
        type: 'image',
        url: attachment.dataUrl,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes ?? undefined,
      });
      return;
    }
    items.push({ type: 'text', text: attachmentTextBlock(attachment) });
  });
  return items;
}

export function attachmentSummary(attachments: ComposerAttachmentDraft[]): string {
  return attachments
    .map((item) => `${item.kind === 'image' ? '图片' : '文件'} ${item.name} (${formatBytes(item.sizeBytes)})`)
    .join('\n');
}

export function selectedSkillSummary(skills: SelectedSkillAttachment[]): string {
  return skills.map((item) => `${item.displayName || item.name} (${item.name})`).join('\n');
}

export function skillIdFromPath(name: string, path: string): string {
  return `${name}:${path}`;
}

export function parseSkillListItems(value: unknown): SkillListItem[] {
  const root = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const entries = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.skills)
      ? [{ skills: root.skills }]
      : Array.isArray(value)
        ? [{ skills: value }]
        : [];
  const byId = new Map<string, SkillListItem>();

  entries.forEach((entry) => {
    const entryRecord = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? entry as Record<string, unknown>
      : {};
    const skills = Array.isArray(entryRecord.skills) ? entryRecord.skills : [];
    skills.forEach((skill) => {
      if (!skill || typeof skill !== 'object' || Array.isArray(skill)) {
        return;
      }
      const record = skill as Record<string, unknown>;
      const name = stringFromUnknown(record.name).trim();
      const path = stringFromUnknown(record.path).trim();
      if (!name || !path) {
        return;
      }
      const interfaceRecord = record.interface && typeof record.interface === 'object' && !Array.isArray(record.interface)
        ? record.interface as Record<string, unknown>
        : {};
      const displayName = stringFromUnknown(interfaceRecord.displayName ?? interfaceRecord.display_name).trim() || name;
      const shortDescription = stringFromUnknown(interfaceRecord.shortDescription ?? interfaceRecord.short_description).trim()
        || stringFromUnknown(record.shortDescription ?? record.short_description).trim();
      const description = shortDescription || stringFromUnknown(record.description).trim();
      byId.set(skillIdFromPath(name, path), {
        id: skillIdFromPath(name, path),
        name,
        displayName,
        description,
        shortDescription,
        scope: stringFromUnknown(record.scope).trim() || 'unknown',
        path,
        enabled: record.enabled !== false,
      });
    });
  });

  return [...byId.values()].sort((left, right) => {
    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1;
    }
    return left.displayName.localeCompare(right.displayName);
  });
}

export function extractProtocolError(eventType: string, data: Record<string, unknown>): string {
  const rawError = data.error;
  if (typeof rawError === 'string' && rawError) {
    return rawError;
  }

  if (rawError && typeof rawError === 'object') {
    const errorData = rawError as Record<string, unknown>;
    const nestedMessage = errorData.message ?? errorData.error_message ?? errorData.reason;
    if (typeof nestedMessage === 'string' && nestedMessage) {
      return nestedMessage;
    }

    const nestedCode = errorData.code ?? errorData.error_code;
    if (typeof nestedCode === 'string' && nestedCode) {
      return nestedCode;
    }
  }

  const message = data.errorMessage ?? data.error_message ?? data.message;
  const code = data.errorCode ?? data.error_code ?? data.code;

  if (typeof message === 'string' && message) {
    return typeof code === 'string' && code ? `${code}: ${message}` : message;
  }

  if (typeof code === 'string' && code) {
    return code;
  }

  if (/error|failed/i.test(eventType)) {
    return eventType;
  }

  return '';
}

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

export type ConversationRenderItem =
  | { type: 'entry'; entry: TimelineEntry }
  | { type: 'executionGroup'; id: string; entries: TimelineEntry[] };

export type SlashCommand = {
  command: string;
  title: string;
  description: string;
  category: SlashCommandCategory;
};

export type SlashCommandCategory = 'core' | 'thread' | 'context' | 'runtime' | 'settings' | 'debug';

export type WorkspaceEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file';
};

export type MentionTrigger = {
  start: number;
  end: number;
  query: string;
};

export type MentionSuggestion = {
  id: string;
  title: string;
  description: string;
  insertText: string;
};

export type PermissionPresetId = 'read-only' | 'default' | 'auto-review' | 'full-access';

export type PermissionPreset = {
  id: PermissionPresetId;
  title: string;
  description: string;
  approvalPolicy: string;
  approvalsReviewer?: string | null;
  sandboxMode: string;
  profileId: string;
};

export type MentionReference = {
  kind: 'file' | 'workspace' | 'conversation' | 'request';
  value: string;
};

export type WorkspaceMentionHistory = {
  workspaceId: string;
  files: string[];
  updatedAt: number;
};

export const REASONING_EFFORT_LABELS: Record<string, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
};

export function reasoningEffortLabel(value: string | null | undefined): string {
  const normalized = normalizeReasoningEffort(value);
  return normalized ? REASONING_EFFORT_LABELS[normalized] ?? normalized : 'Default';
}

export function compactTokenCount(value: number | null | undefined): string {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`;
  if (numeric >= 10_000) return `${Math.round(numeric / 1_000)}K`;
  if (numeric >= 1_000) return `${(numeric / 1_000).toFixed(1)}K`;
  return String(Math.round(numeric));
}

export function extractMessageLinks(value: string): string[] {
  const markdownTargets = [...value.matchAll(/\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)]
    .map((match) => match[1]);
  const bareTargets = value.match(
    /https?:\/\/[^\s<>"']+|(?:\.\.?\/|\/)?(?:[\w@+.-]+\/)+[\w@+.-]+(?:#[^\s<>()"']*)?|(?:\.\.?\/|\/)[^\s<>()"'`]+|\b(?:Makefile|Dockerfile|Containerfile|Gemfile|Rakefile|Podfile)\b|\b[\w@+.-]+\.(?:mdx?|txt|json|jsonc|ya?ml|toml|ini|env|css|scss|sass|less|js|jsx|mjs|cjs|ts|tsx|rs|py|rb|php|sh|bash|zsh|fish|swift|go|java|kt|kts|c|cc|cpp|h|hpp|cs|html?|xhtml|svg|xml|sql|graphql|gql)(?:#[^\s<>()"']*)?/gi,
  ) ?? [];
  return [...new Set([...markdownTargets, ...bareTargets]
    .map((item) => item.replace(/^[`<]+|[`>),.;!?]+$/g, ''))
    .filter(Boolean))].slice(0, 8);
}

export function modelDisplayLabel(model: string | null | undefined, catalog: CodexModelCatalogItem[]): string {
  const normalized = model?.trim() ?? '';
  if (!normalized) {
    return '未设置';
  }
  return catalog.find((item) => item.model === normalized)?.displayName || normalized;
}

export function reasoningOptionsForModel(
  model: string | null | undefined,
  catalog: CodexModelCatalogItem[],
): CodexReasoningEffortOption[] {
  const preset = catalog.find((item) => item.model === model);
  return preset?.supportedReasoningEfforts.length ? preset.supportedReasoningEfforts : DEFAULT_REASONING_EFFORT_OPTIONS;
}

export function defaultReasoningForModel(model: string | null | undefined, catalog: CodexModelCatalogItem[]): string | null {
  const preset = catalog.find((item) => item.model === model);
  return preset?.defaultReasoningEffort ?? null;
}

export function serviceTiersForModel(model: string | null | undefined, catalog: CodexModelCatalogItem[]) {
  const preset = catalog.find((item) => item.model === model);
  return preset?.serviceTiers.length ? preset.serviceTiers : [FAST_SERVICE_TIER];
}

export function fastServiceTierForModel(model: string | null | undefined, catalog: CodexModelCatalogItem[]) {
  return (
    serviceTiersForModel(model, catalog).find((tier) => tier.name === 'fast' || tier.id === FAST_SERVICE_TIER.id) ??
    FAST_SERVICE_TIER
  );
}

export function serviceTierLabel(value: string | null | undefined): string {
  if (!value || value === 'default') {
    return 'Default';
  }
  if (value === FAST_SERVICE_TIER.id || value === 'fast') {
    return 'Fast';
  }
  return value;
}

export function mergeModelCatalog(remoteModels: CodexModelCatalogItem[], currentModels: string[]): CodexModelCatalogItem[] {
  const byModel = new Map<string, CodexModelCatalogItem>();
  FALLBACK_CODEX_MODELS.forEach((item) => byModel.set(item.model, item));
  remoteModels.forEach((item) => byModel.set(item.model, item));
  currentModels
    .map((model) => model.trim())
    .filter(Boolean)
    .forEach((model) => {
      if (!byModel.has(model)) {
        byModel.set(model, {
          id: model,
          model,
          displayName: model,
          description: 'Custom model',
          hidden: false,
          isDefault: false,
          supportedReasoningEfforts: DEFAULT_REASONING_EFFORT_OPTIONS,
          defaultReasoningEffort: 'medium',
          serviceTiers: [FAST_SERVICE_TIER],
        });
      }
    });
  return [...byModel.values()].filter((item) => !item.hidden);
}

export function normalizeExperimentalFeatures(value: Partial<ExperimentalFeatureSettings> | null | undefined): ExperimentalFeatureSettings {
  return {
    ...EXPERIMENTAL_FEATURE_DEFAULTS,
    ...(value && typeof value === 'object' ? value : {}),
  };
}

export function itemTypeOf(item: Record<string, unknown>): string {
  const rawType = item.type ?? item.itemType ?? item.item_type;
  return typeof rawType === 'string' ? rawType : '';
}

export function itemIdOf(item: Record<string, unknown>, fallback: string): string {
  const rawId = item.id ?? item.itemId ?? item.item_id;
  return typeof rawId === 'string' && rawId ? rawId : fallback;
}

export function textFromContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (!Array.isArray(value)) {
    return '';
  }

  return value
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (part && typeof part === 'object') {
        const record = part as Record<string, unknown>;
        if (typeof record.text === 'string') {
          return record.text;
        }
      }
      return '';
    })
    .filter(Boolean)
    .join('');
}

export function textFromItem(item: Record<string, unknown>): string {
  const directText = item.text ?? item.message;
  if (typeof directText === 'string') {
    return directText;
  }
  return textFromContent(item.content);
}

export type PersistedSettings = Omit<ConnectionSettings, 'authToken'>;
export type PersistedBackendConnectionProfile = Omit<BackendConnectionProfile, 'authToken'>;

export function profileSettings(profile: BackendConnectionProfile, base: ConnectionSettings = defaultSettings): ConnectionSettings {
  return sharedSettingsFromProfile(profile, base);
}

export function profileFromSettings(settings: ConnectionSettings, id: string, name?: string): BackendConnectionProfile {
  return sharedProfileFromSettings(settings, name?.trim() || '当前后端', id);
}

export function normalizeBackendProfile(value: unknown): BackendConnectionProfile | null {
  return sharedNormalizeBackendConnectionProfile(value);
}



export const SETTINGS_STORAGE_KEY = 'todex.mobile.settings.v1';
export const WORKSPACES_STORAGE_KEY = 'todex.mobile.workspaces.v1';
export const CONVERSATIONS_STORAGE_KEY = 'todex.mobile.conversations.v1';
export const TIMELINE_STORAGE_KEY = 'todex.mobile.timeline.v1';
export const ACTIVE_SELECTION_STORAGE_KEY = 'todex.mobile.activeSelection.v1';
export const MENTION_HISTORY_STORAGE_KEY = 'todex.mobile.mentionHistory.v1';
export const SESSION_CURSORS_STORAGE_KEY = 'todex.mobile.sessionCursors.v1';
export const EXPERIMENTAL_FEATURES_STORAGE_KEY = 'todex.mobile.experimentalFeatures.v1';
export const TOKEN_STORAGE_KEY = 'todex.mobile.token.v1';
export const TOKEN_ORIGIN_STORAGE_KEY = 'todex.mobile.tokenOrigin.v1';
export const BACKEND_PROFILES_STORAGE_KEY = 'todex.mobile.backendConnections.v1';
export const BACKEND_PROFILE_ACTIVE_STORAGE_KEY = 'todex.mobile.activeBackendConnection.v1';
export const USAGE_RECORDS_STORAGE_KEY = 'todex.mobile.usageRecords.v1';
export const WORKBENCH_STATE_STORAGE_KEY = 'todex.mobile.workbench.v1';
export const JSON_SAVE_DEBOUNCE_MS = 350;
export const SESSION_CURSOR_SAVE_DEBOUNCE_MS = 800;
export const WORKSPACE_SYNC_DEBOUNCE_MS = 900;
export const SOCKET_EVENT_BATCH_SIZE = 24;
export const SOCKET_FRAME_DECODE_BATCH_SIZE = 8;
export const SOCKET_FRAME_DECODE_BUDGET_MS = 10;
export const MAX_TRANSPORT_HELLO_SESSION_CURSORS = 12;
export const MAX_TIMELINE_ITEMS = 260;
export const MAX_USAGE_RECORDS = 2000;

export function backendProfileTokenKey(profileId: string): string {
  return `todex.mobile.backend.${encodeURIComponent(profileId)}.token.v1`;
}
export const CHAT_ATTACH_REPLAY_LIMIT = 200;
export const CHAT_BOTTOM_FOLLOW_THRESHOLD = 72;
export const TERMINAL_MAX_OUTPUT_ENTRIES = 420;
export const DEFAULT_TERMINAL_ROWS = 24;
export const DEFAULT_TERMINAL_COLS = 80;
export const LOCAL_SESSION_IDLE_SUSPEND_MS = 30 * 60 * 1000;
export const LOCAL_SESSION_IDLE_SWEEP_MS = 2 * 60 * 1000;

export const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/model', title: 'Model', description: 'choose what model and reasoning effort to use', category: 'settings' },
  { command: '/fast', title: 'Fast', description: 'toggle fastest inference with increased plan usage', category: 'core' },
  { command: '/permissions', title: 'Permissions', description: 'choose what Codex is allowed to do', category: 'settings' },
  { command: '/personality', title: 'Personality', description: 'choose a communication style for Codex', category: 'settings' },
  { command: '/experimental', title: 'Experimental', description: 'toggle experimental features', category: 'settings' },
  { command: '/approve', title: 'Approve', description: 'approve one retry of a recent auto-review denial', category: 'runtime' },
  { command: '/memories', title: 'Memories', description: 'configure memory use and generation', category: 'settings' },
  { command: '/skills', title: 'Skills', description: 'use skills to improve how Codex performs specific tasks', category: 'context' },
  { command: '/hooks', title: 'Hooks', description: 'view and manage lifecycle hooks', category: 'context' },
  { command: '/review', title: 'Review', description: 'review my current changes and find issues', category: 'context' },
  { command: '/rename', title: 'Rename', description: 'rename the current thread', category: 'thread' },
  { command: '/new', title: 'New', description: 'start a new chat during a conversation', category: 'thread' },
  { command: '/archive', title: 'Archive', description: 'archive this session and exit', category: 'thread' },
  { command: '/resume', title: 'Resume', description: 'resume a saved chat', category: 'thread' },
  { command: '/fork', title: 'Fork', description: 'fork the current chat', category: 'thread' },
  { command: '/init', title: 'Init', description: 'create an AGENTS.md file with instructions for Codex', category: 'context' },
  { command: '/compact', title: 'Compact', description: 'summarize conversation to prevent hitting the context limit', category: 'thread' },
  { command: '/plan', title: 'Plan', description: 'switch to Plan mode', category: 'core' },
  { command: '/goal', title: 'Goal', description: 'set or view the goal for a long-running task', category: 'thread' },
  { command: '/subagents', title: 'Subagents', description: 'manage and switch between sub-agent threads', category: 'thread' },
  { command: '/side', title: 'Side', description: 'start a side conversation in an ephemeral fork', category: 'thread' },
  { command: '/btw', title: 'BTW', description: 'alias for /side', category: 'thread' },
  { command: '/copy', title: 'Copy', description: 'copy last response as markdown', category: 'context' },
  { command: '/diff', title: 'Diff', description: 'show git diff including untracked files', category: 'context' },
  { command: '/mention', title: 'Mention', description: 'mention a file', category: 'context' },
  { command: '/status', title: 'Status', description: 'show current session configuration and token usage', category: 'core' },
  { command: '/mcp', title: 'MCP', description: 'list configured MCP tools; use /mcp verbose for details', category: 'context' },
  { command: '/apps', title: 'Apps', description: 'manage apps', category: 'context' },
  { command: '/plugins', title: 'Plugins', description: 'browse plugins', category: 'context' },
  { command: '/feedback', title: 'Feedback', description: 'send logs to maintainers', category: 'settings' },
  { command: '/logout', title: 'Logout', description: 'log out of Codex', category: 'settings' },
  { command: '/quit', title: 'Quit', description: 'exit Codex', category: 'runtime' },
  { command: '/exit', title: 'Exit', description: 'exit Codex', category: 'runtime' },
  { command: '/ps', title: 'PS', description: 'list background terminals', category: 'runtime' },
  { command: '/stop', title: 'Stop', description: 'stop all background terminals', category: 'runtime' },
  { command: '/clean', title: 'Clean', description: 'alias for /stop', category: 'runtime' },
  { command: '/clear', title: 'Clear', description: 'clear the terminal and start a new chat', category: 'thread' },
];

export const EXPERIMENTAL_FEATURE_DEFAULTS: ExperimentalFeatureSettings = {
  gitDiffViewer: false,
  verboseRuntimeEvents: false,
  composerFileMentions: false,
};

export const EXPERIMENTAL_FEATURES: ExperimentalFeatureDefinition[] = [
  {
    id: 'gitDiffViewer',
    title: 'Git diff 独立视图',
    description: '允许通过 /diff 打开单独的变更查看界面。',
    scope: 'App UI',
  },
  {
    id: 'verboseRuntimeEvents',
    title: '详细运行事件',
    description: '保留更多后端事件细节，便于排查连接和线程状态。',
    scope: 'Diagnostics',
  },
  {
    id: 'composerFileMentions',
    title: '@ 文件提及增强',
    description: '启用输入框内的文件提及辅助和最近文件记录。',
    scope: 'Composer',
  },
];

export const SLASH_COMMAND_CATEGORY_ORDER: SlashCommandCategory[] = ['core', 'thread', 'context', 'runtime', 'settings', 'debug'];

export const SLASH_COMMAND_CATEGORY_LABELS: Record<SlashCommandCategory, string> = {
  core: '核心',
  thread: 'Thread',
  context: '上下文',
  runtime: '运行时',
  settings: '设置',
  debug: '调试',
};

export const DIRECT_SLASH_COMMANDS = new Set([
  '/compact',
  '/init',
  '/mention',
  '/copy',
]);

export function canonicalSlashCommand(command: string): string {
  const normalized = command.trim().toLowerCase();
  if (normalized === '/clean') {
    return '/stop';
  }
  if (normalized === '/btw') {
    return '/side';
  }
  if (normalized === '/hook') {
    return '/hooks';
  }
  if (normalized === '/plugin') {
    return '/plugins';
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export function slashCommandDefinition(command: string): SlashCommand | null {
  const canonical = canonicalSlashCommand(command);
  return SLASH_COMMANDS.find((item) => canonicalSlashCommand(item.command) === canonical) ?? null;
}

export function slashCommandNeedsActionPage(command: string): boolean {
  return !DIRECT_SLASH_COMMANDS.has(canonicalSlashCommand(command));
}

export function serviceTierCommandForModel(command: string, model: string | null | undefined, catalog: CodexModelCatalogItem[]): CodexServiceTierOption | null {
  const normalized = command.replace(/^\//, '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return serviceTiersForModel(model, catalog).find(
    (tier) => tier.name.toLowerCase() === normalized || tier.id.toLowerCase() === normalized,
  ) ?? null;
}

export function serviceTierSlashCommandsForModel(model: string | null | undefined, catalog: CodexModelCatalogItem[]): SlashCommand[] {
  const existingCommands = new Set(SLASH_COMMANDS.map((item) => canonicalSlashCommand(item.command)));
  return serviceTiersForModel(model, catalog)
    .filter((tier) => !existingCommands.has(canonicalSlashCommand(`/${tier.name}`)))
    .map((tier) => ({
      command: `/${tier.name}`,
      title: tier.name === 'fast' ? 'Fast' : tier.name,
      description: tier.description,
      category: 'core',
    }));
}

export const PERMISSION_PRESETS: PermissionPreset[] = [
  {
    id: 'read-only',
    title: 'Read Only',
    description: 'Codex can read files. Approval is required to edit files or access the internet.',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxMode: 'read-only',
    profileId: ':read-only',
  },
  {
    id: 'default',
    title: 'Ask for approval',
    description: 'Codex can read and edit files in the current workspace. Approval is required for network or outside edits.',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxMode: 'workspace-write',
    profileId: ':workspace',
  },
  {
    id: 'auto-review',
    title: 'Approve for me',
    description: 'Route approval requests to Codex auto-review before asking you.',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
    sandboxMode: 'workspace-write',
    profileId: ':workspace',
  },
  {
    id: 'full-access',
    title: 'Full Access',
    description: 'Codex can edit files outside this workspace and access the internet without asking.',
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandboxMode: 'danger-full-access',
    profileId: ':danger-full-access',
  },
];

export function permissionPresetForProfile(
  profileId: string | null | undefined,
  approvalsReviewer?: string | null,
): PermissionPreset | null {
  if (!profileId) {
    return null;
  }
  const normalizedReviewer = approvalsReviewer || null;
  return (
    PERMISSION_PRESETS.find((preset) =>
      (preset.profileId === profileId || preset.id === profileId) &&
      (!normalizedReviewer || preset.approvalsReviewer === normalizedReviewer)
    ) ??
    PERMISSION_PRESETS.find((preset) =>
      (preset.profileId === profileId || preset.id === profileId) &&
      preset.approvalsReviewer !== 'auto_review'
    ) ??
    null
  );
}

export function permissionProfileLabel(profileId: string | null | undefined, approvalsReviewer?: string | null): string {
  const preset = permissionPresetForProfile(profileId, approvalsReviewer);
  return preset?.title ?? profileId ?? 'Legacy approval/sandbox';
}

export function approvalsReviewerValue(
  workspace: WorkspaceRecord | null | undefined,
  settings: ConnectionSettings,
): string | null {
  return workspace?.approvalsReviewer ?? settings.approvalsReviewer ?? null;
}

export function permissionPresetSelected(
  preset: PermissionPreset,
  workspace: WorkspaceRecord | null | undefined,
  settings: ConnectionSettings,
): boolean {
  return (
    workspace?.permissionProfile === preset.profileId &&
    (approvalsReviewerValue(workspace, settings) || 'user') === preset.approvalsReviewer
  );
}

// Codex `Personality` enum serializes lowercase: "none" | "friendly" | "pragmatic".
export const PERSONALITY_OPTIONS: { id: string; title: string; description: string }[] = [
  { id: 'friendly', title: 'Friendly', description: 'Warmer, more conversational communication style.' },
  { id: 'pragmatic', title: 'Pragmatic', description: 'Direct, concise, action-oriented communication style.' },
  { id: 'none', title: 'Default', description: 'Use the model default communication style.' },
];

export function personalityLabel(personality: string | null | undefined): string {
  const normalized = (personality || 'none').toLowerCase();
  return PERSONALITY_OPTIONS.find((option) => option.id === normalized)?.title ?? 'Default';
}

// Codex `feedback/upload` classification accepts these exact snake_case strings.
export const FEEDBACK_CATEGORIES: { id: string; title: string; description: string }[] = [
  { id: 'bad_result', title: 'Bad result', description: 'Codex produced an incorrect or unhelpful result.' },
  { id: 'good_result', title: 'Good result', description: 'Codex did well — share positive feedback.' },
  { id: 'bug', title: 'Bug', description: 'Something is broken in the app or Codex.' },
  { id: 'safety_check', title: 'Safety check', description: 'A safety/approval concern to report.' },
  { id: 'other', title: 'Other', description: 'Anything else worth telling the maintainers.' },
];

export const defaultSettings: ConnectionSettings = {
  serverUrl: 'http://127.0.0.1:7345',
  authToken: '',
  tenantId: 'local',
  encryptionProtocol: 'none',
  encryptionPublicKey: '',
  defaultWorkspacePath: '/home/dev/projects',
  defaultModel: 'gpt-5.5',
  defaultReasoningEffort: 'medium',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
  sandboxMode: 'workspace-write',
};

export const defaultConnectionHealth: ConnectionHealth = {
  status: 'unknown',
  latencyMs: null,
  lastCheckedAt: null,
  error: '',
  code: '',
};

export const DEFAULT_WORKBENCH_STATE: MobileWorkbenchState = {
  tabs: ['terminal', 'browser', 'files', 'git-diff'],
  activeTab: 'terminal',
  browserUrl: '',
  browserFilePath: '',
  inspectedElement: null,
};

export function normalizeWorkbenchState(value: unknown): MobileWorkbenchState {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const tabs = Array.isArray(raw.tabs)
    ? raw.tabs.filter((tab): tab is WorkbenchTab => typeof tab === 'string' && WORKBENCH_TABS.includes(tab as WorkbenchTab))
    : [];
  const normalizedTabs = tabs.length ? [...new Set(tabs)] : [...WORKBENCH_TABS];
  const activeTab = typeof raw.activeTab === 'string' && normalizedTabs.includes(raw.activeTab as WorkbenchTab)
    ? raw.activeTab as WorkbenchTab
    : normalizedTabs[0] as WorkbenchTab;
  const inspected = raw.inspectedElement && typeof raw.inspectedElement === 'object' && !Array.isArray(raw.inspectedElement)
    ? raw.inspectedElement as Record<string, unknown>
    : null;
  return {
    tabs: normalizedTabs,
    activeTab,
    browserUrl: typeof raw.browserUrl === 'string' ? raw.browserUrl : '',
    browserFilePath: typeof raw.browserFilePath === 'string' ? raw.browserFilePath : '',
    inspectedElement: inspected && typeof inspected.selector === 'string'
      ? {
          selector: inspected.selector.slice(0, 200),
          tagName: typeof inspected.tagName === 'string' ? inspected.tagName.slice(0, 40) : '',
          text: typeof inspected.text === 'string' ? inspected.text.slice(0, 500) : '',
        }
      : null,
  };
}

export function normalizeWorkbenchMap(value: unknown): Record<string, MobileWorkbenchState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, MobileWorkbenchState> = {};
  for (const [conversationId, state] of Object.entries(value as Record<string, unknown>)) {
    if (conversationId.trim()) result[conversationId] = normalizeWorkbenchState(state);
  }
  return result;
}

export function modelCommandInitialValue(workspace: WorkspaceRecord, settings: ConnectionSettings): string {
  return [workspace.model || settings.defaultModel, normalizeReasoningEffort(workspace.reasoningEffort)]
    .filter(Boolean)
    .join(' ');
}

export function parseModelCommandArgs(args: string[]): {
  model: string;
  reasoningEffort: string | null;
  invalidReasoningEffort: string;
} {
  let model = '';
  let reasoningEffort: string | null = null;
  let invalidReasoningEffort = '';
  let expected: 'model' | 'effort' | null = null;

  for (const rawArg of args) {
    const arg = rawArg.trim();
    if (!arg) {
      continue;
    }
    const lower = arg.toLowerCase();

    if (lower === '--model' || lower === '-m' || lower === 'model') {
      expected = 'model';
      continue;
    }
    if (
      lower === '--effort' ||
      lower === '--reasoning' ||
      lower === '--thinking' ||
      lower === '-e' ||
      lower === 'effort' ||
      lower === 'reasoning' ||
      lower === 'thinking'
    ) {
      expected = 'effort';
      continue;
    }

    if (expected === 'model') {
      model = arg;
      expected = null;
      continue;
    }

    const normalizedEffort = normalizeReasoningEffort(arg);
    if (expected === 'effort') {
      if (normalizedEffort) {
        reasoningEffort = normalizedEffort;
      } else {
        invalidReasoningEffort = arg;
      }
      expected = null;
      continue;
    }

    if (normalizedEffort) {
      reasoningEffort = normalizedEffort;
      continue;
    }

    if (!model) {
      model = arg;
    }
  }

  if (expected === 'effort') {
    invalidReasoningEffort = invalidReasoningEffort || 'missing';
  }

  return { model, reasoningEffort, invalidReasoningEffort };
}

export function toPersistedSettings(settings: ConnectionSettings): PersistedSettings {
  const { authToken: _authToken, ...rest } = settings;
  return rest;
}

export function fromPersistedSettings(raw: Partial<PersistedSettings> | null | undefined, authToken: string): ConnectionSettings {
  const { defaultThreadId: _legacyDefaultThreadId, ...safeRaw } = (raw ?? {}) as Partial<PersistedSettings> & {
    defaultThreadId?: string;
  };
  return {
    ...defaultSettings,
    ...safeRaw,
    defaultReasoningEffort: normalizeReasoningEffort(safeRaw.defaultReasoningEffort) ?? defaultSettings.defaultReasoningEffort,
    authToken,
  };
}

export function authHeaders(settings: ConnectionSettings, extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...extra,
    ...(settings.authToken ? { Authorization: `Bearer ${settings.authToken}` } : {}),
  };
}

export const apiClientCache = new Map<string, V2ApiClient>();

export function apiClientForConnection(settings: ConnectionSettings, profile?: BackendConnectionProfile | null): V2ApiClient {
  const serverUrl = profile ? profile.serverUrl : settings.serverUrl;
  const authToken = profile ? profile.authToken : settings.authToken;
  const key = `${serverUrl}\n${authToken}`;
  const cached = apiClientCache.get(key);
  if (cached) return cached;
  const client = new V2ApiClient({ serverUrl, authToken });
  apiClientCache.set(key, client);
  if (apiClientCache.size > 12) {
    const oldest = apiClientCache.keys().next().value;
    if (typeof oldest === 'string') apiClientCache.delete(oldest);
  }
  return client;
}

export function workspaceSyncPayloadEquals(left: WorkspaceRecord[], right: WorkspaceRecord[]): boolean {
  return JSON.stringify(prepareWorkspaceSyncPayload(left)) === JSON.stringify(prepareWorkspaceSyncPayload(right));
}

export function sanitizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export function createSessionId(name: string): string {
  const slug = sanitizeSlug(name) || 'workspace';
  return `cdxs_${slug}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function terminalIdForConversation(conversationId: string): string {
  return `term_${conversationId.replace(/[^a-zA-Z0-9_-]+/g, '_')}`;
}

export function terminalStatusLabel(status: TerminalLifecycleState): string {
  switch (status) {
    case 'starting':
      return '启动中';
    case 'running':
      return '运行中';
    case 'stopping':
      return '停止中';
    case 'exited':
      return '已退出';
    case 'error':
      return '异常';
    case 'idle':
    default:
      return '未启动';
  }
}

export function terminalOutputLine(kind: TerminalOutputEntry['kind'], text: string): TerminalOutputEntry {
  return {
    id: createRequestId(`terminal-${kind}`),
    kind,
    text,
    at: Date.now(),
  };
}

export function nowLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function connectionStateLabel(state: ConnectionState): string {
  switch (state) {
    case 'open':
      return '已连接';
    case 'connecting':
      return '连接中';
    case 'closed':
      return '已断开';
    case 'error':
      return '连接异常';
    case 'idle':
    default:
      return '未连接';
  }
}

export function latencyLabelOf(latencyMs: number | null): string {
  return latencyMs === null ? '未检测' : `${latencyMs} ms`;
}

export function healthLabelOf(health: ConnectionHealth): string {
  switch (health.status) {
    case 'online':
      return `后端在线 · ${latencyLabelOf(health.latencyMs)}`;
    case 'checking':
      return health.latencyMs === null ? '检测中' : `检测中 · ${latencyLabelOf(health.latencyMs)}`;
    case 'offline':
      return health.error || '后端不可达';
    case 'unknown':
    default:
      return '等待检测';
  }
}

export function isV2Conversation(conversation: ConversationRecord | null | undefined): boolean {
  return Boolean(conversation?.v2ConversationId || (conversation?.provider && conversation.provider !== ''));
}

export function resolveCreateAgent(
  requestedProvider: ProviderKind | undefined,
  requestedProfile: string | undefined,
  providers: ProviderDescriptor[],
  conversations: ConversationRecord[],
  activeConversationId: string,
  workspaceId: string,
): { provider: ProviderKind; providerProfile?: string } | null {
  const available = providers.filter((provider) => provider.available);
  const requested = requestedProvider ? available.find((provider) => provider.id === requestedProvider) : undefined;
  const active = conversations.find((conversation) => conversation.id === activeConversationId && conversation.workspaceId === workspaceId);
  const preferred = active?.provider ? available.find((provider) => provider.id === active.provider) : undefined;
  const last = conversations
    .filter((conversation) => conversation.workspaceId === workspaceId && conversation.provider)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((conversation) => available.find((provider) => provider.id === conversation.provider))
    .find((provider): provider is ProviderDescriptor => Boolean(provider));
  const descriptor = requested || preferred || last || available[0];
  if (!descriptor) return null;
  return {
    provider: descriptor.id,
    providerProfile: requestedProfile || descriptor.profiles[0],
  };
}

export function canSwitchConversationAgent(
  conversation: ConversationRecord,
  timeline: TimelineEntry[],
  thinking: boolean,
): boolean {
  if (thinking) return false;
  if (timeline.some((entry) => entry.conversationId === conversation.id && (entry.kind === 'incoming' || entry.kind === 'outgoing'))) {
    return false;
  }
  return !conversation.v2ConversationId || conversation.provider !== undefined;
}

export function browserHtmlForWebView(body: string, baseUrl: string, inspectMode: boolean): string {
  const withoutScripts = body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  const base = baseUrl
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const baseTag = validateLoopbackUrl(baseUrl).ok ? `<base href="${base}">` : '';
  const inspector = inspectMode ? `
    <script>
      (function () {
        document.addEventListener('click', function (event) {
          var target = event.target;
          if (!target || !target.closest) return;
          event.preventDefault();
          var node = target.closest('*');
          var selector = node && node.tagName ? node.tagName.toLowerCase() : '';
          if (node && node.id) selector += '#' + node.id;
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'inspect', selector: selector, tagName: node && node.tagName || '', text: (node && node.textContent || '').trim().slice(0, 500)
          }));
        }, true);
      }());
    </script>` : '';
  return `<!doctype html><html><head><meta charset="utf-8">${baseTag}<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'self' http://127.0.0.1:* http://localhost:* http://[::1]:*;"></head><body>${withoutScripts}${inspector}</body></html>`;
}

export function browserLivePreviewUrl(resultUrl: string, backendUrl: string): string | null {
  if (!validateLoopbackUrl(resultUrl).ok) return null;
  try {
    const target = new URL(resultUrl);
    const backend = new URL(normalizeServerUrl(backendUrl));
    target.hostname = backend.hostname;
    return target.toString();
  } catch {
    return null;
  }
}

export function browserPreviewNavigationAllowed(url: string, livePreviewUrl: string | null): boolean {
  if (url === 'about:blank' || url.startsWith('data:text/html')) return true;
  if (!livePreviewUrl) return validateLoopbackUrl(url).ok;
  try {
    return new URL(url).origin === new URL(livePreviewUrl).origin;
  } catch {
    return false;
  }
}


export function conversationFromManifest(manifest: ConversationManifest, workspaceId: string): ConversationRecord {
  const createdAt = Date.parse(manifest.createdAt) || Date.now();
  const updatedAt = Date.parse(manifest.updatedAt) || createdAt;
  return {
    id: manifest.id,
    workspaceId,
    title: manifest.title || providerDisplayName(manifest.provider),
    preview: '',
    nativeStatus: manifest.status,
    archived: Boolean(manifest.archivedAt),
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
    createdAt,
    updatedAt,
  };
}

export function mergeManifestConversations(
  current: ConversationRecord[],
  manifests: ConversationManifest[],
  workspaces: WorkspaceRecord[],
): ConversationRecord[] {
  const next = [...current];
  for (const manifest of manifests) {
    const workspace = (manifest.workspaceId
      ? workspaces.find((item) => item.id === manifest.workspaceId)
      : undefined)
      ?? workspaces.find((item) => item.path === manifest.workspace);
    if (!workspace) {
      continue;
    }
    const record = conversationFromManifest(manifest, workspace.id);
    const existing = next.findIndex((item) => item.v2ConversationId === manifest.id || item.id === manifest.id);
    if (existing >= 0) {
      next[existing] = {
        ...next[existing],
        ...record,
        sessionId: next[existing].sessionId || record.sessionId,
      };
    } else {
      next.unshift(record);
    }
  }
  return next.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function classifyV2ConversationEvent(event: ConversationEvent, workspaceId: string, activeTurnId = ''): TimelineEntry | null {
  return sharedClassifyV2ConversationEvent(event, workspaceId, activeTurnId) as TimelineEntry | null;
}

export function shouldAppendV2ConversationEvent(event: ConversationEvent): boolean {
  return sharedShouldAppendV2ConversationEvent(event);
}

export function modeLabelOf(mode: ConversationRecord['mode']): string {
  return mode === 'plan' ? 'Plan mode' : 'Implement mode';
}

export function compactGoalLabel(conversation: ConversationRecord): string {
  if (!conversation.goalStatus && !conversation.goalObjective) {
    return 'No goal';
  }
  if (conversation.goalObjective) {
    return `Goal · ${conversation.goalObjective}`;
  }
  return `Goal · ${conversation.goalStatus}`;
}

export function conversationTitleFromNativeThread(thread: CodexNativeThread): string {
  return thread.name || thread.preview || thread.title || thread.id;
}

export function conversationPatchFromNativeThread(thread: CodexNativeThread): Partial<ConversationRecord> {
  return {
    title: conversationTitleFromNativeThread(thread),
    preview: thread.preview,
    nativeStatus: thread.status,
    archived: thread.archived,
    threadId: thread.id,
    nativeUpdatedAt: thread.updatedAt || Date.now(),
    updatedAt: thread.updatedAt || Date.now(),
    createdAt: thread.createdAt || Date.now(),
  };
}

export function threadDateLabel(timestamp: number): string {
  if (!timestamp) {
    return 'unknown';
  }
  return new Date(timestamp).toLocaleString();
}

export function formatThreadSummary(thread: CodexNativeThread): string {
  const lines = [
    `Thread: ${thread.id || 'unknown'}`,
    `Title: ${conversationTitleFromNativeThread(thread)}`,
    `Status: ${thread.status || 'unknown'}`,
    `Archived: ${thread.archived ? 'yes' : 'no'}`,
    `CWD: ${thread.cwd || 'unknown'}`,
    `Model: ${thread.model || 'unknown'}`,
    `Session: ${thread.sessionId || 'unknown'}`,
    `Created: ${threadDateLabel(thread.createdAt)}`,
    `Updated: ${threadDateLabel(thread.updatedAt)}`,
  ];
  if (thread.preview) {
    lines.push('', thread.preview);
  }
  return lines.join('\n');
}

export function valueAtPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const part of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function resultThreadFromValue(value: unknown): CodexNativeThread | null {
  return (
    parseCodexNativeThread(value) ||
    parseCodexNativeThread(valueAtPath(value, ['thread'])) ||
    parseCodexNativeThread(valueAtPath(value, ['result', 'thread'])) ||
    null
  );
}

export function formatThreadActionResult(action: PendingThreadAction, responseValue: unknown): string {
  if (action.action === 'mcp') {
    const servers = parseMcpServerStatusListResponse(responseValue);
    if (!servers.length) {
      return 'No MCP servers returned.';
    }
    return servers
      .map((server) => `${server.name}: ${server.tools.length} tools, ${server.resources.length} resources, auth ${server.authStatus}`)
      .join('\n');
  }
  if (action.action === 'permissionProfiles') {
    const profiles = parsePermissionProfileListResponse(responseValue);
    return profiles.length
      ? profiles.map((profile) => `${profile.id}: ${profile.description}`).join('\n')
      : 'No permission profiles returned.';
  }
  const thread = resultThreadFromValue(responseValue);
  if (thread && (action.action === 'detail' || action.action === 'metadata' || action.action === 'rollback' || action.action === 'unarchive')) {
    return formatThreadSummary(thread);
  }
  return shortJson(responseValue);
}

export function parseThreadMetadataArgs(args: string[]): { gitInfo: Record<string, string | null>; error?: string } {
  const gitInfo: Record<string, string | null> = {};
  let index = 0;
  while (index < args.length) {
    const rawKey = args[index]?.toLowerCase();
    const key =
      rawKey === 'origin' || rawKey === 'originurl' || rawKey === 'origin-url'
        ? 'originUrl'
        : rawKey === 'branch' || rawKey === 'sha'
          ? rawKey
          : '';
    if (!key) {
      return { gitInfo, error: `未知 metadata 字段: ${args[index]}` };
    }
    const next = args[index + 1];
    if (!next) {
      return { gitInfo, error: `${args[index]} 需要一个值，或使用 clear/null 清空。` };
    }
    gitInfo[key] = /^(clear|null|none|-)$/i.test(next) ? null : next;
    index += 2;
  }
  if (Object.keys(gitInfo).length === 0) {
    return { gitInfo, error: '请输入 branch、sha 或 origin。' };
  }
  return { gitInfo };
}

export function parseThreadMetadataPrompt(value: string): { gitInfo: Record<string, string | null>; error?: string } {
  const args = value.trim().split(/\s+/).filter(Boolean);
  return parseThreadMetadataArgs(args);
}

export function parseThreadMemoryMode(value: string): 'enabled' | 'disabled' | 'reset' | '' {
  const normalized = value.trim().toLowerCase();
  if (/^(on|enable|enabled|true|1)$/i.test(normalized)) {
    return 'enabled';
  }
  if (/^(off|disable|disabled|false|0)$/i.test(normalized)) {
    return 'disabled';
  }
  if (/^(reset|clear)$/i.test(normalized)) {
    return 'reset';
  }
  return '';
}

export function parsePositiveLimit(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 100);
}

export function parseJsonArrayPrompt(value: string): unknown[] | null {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function nativeThreadPatchFromNotification(eventType: string, data: Record<string, unknown>): Partial<ConversationRecord> | null {
  const threadId = threadIdFromEventData({ type: eventType, payload: data } as ServerEvent, data);
  if (!threadId) {
    return null;
  }
  if (eventType === 'codex.thread/archived' || eventType === 'codex.thread.archived' || data.method === 'thread/archived') {
    return { archived: true, nativeStatus: 'archived', updatedAt: Date.now() };
  }
  if (eventType === 'codex.thread/unarchived' || eventType === 'codex.thread.unarchived' || data.method === 'thread/unarchived') {
    return { archived: false, nativeStatus: '', updatedAt: Date.now() };
  }
  if (eventType === 'codex.thread/closed' || eventType === 'codex.thread.closed' || data.method === 'thread/closed') {
    return { nativeStatus: 'closed', updatedAt: Date.now() };
  }
  if (eventType === 'codex.thread/status/changed' || eventType === 'codex.thread.status.changed' || data.method === 'thread/status/changed') {
    const status = typeof data.status === 'string'
      ? data.status
      : data.status && typeof data.status === 'object' && !Array.isArray(data.status)
        ? String((data.status as Record<string, unknown>).type ?? (data.status as Record<string, unknown>).state ?? '')
        : '';
    return { nativeStatus: status, updatedAt: Date.now() };
  }
  if (eventType === 'codex.thread/name/updated' || eventType === 'codex.thread.name.updated' || data.method === 'thread/name/updated') {
    const title = typeof data.threadName === 'string'
      ? data.threadName
      : typeof data.thread_name === 'string'
        ? data.thread_name
        : '';
    return title ? { title, updatedAt: Date.now() } : { title: '', updatedAt: Date.now() };
  }
  return null;
}

export function goalPatchFromEventData(data: Record<string, unknown>): Pick<ConversationRecord, 'goalStatus' | 'goalObjective'> | null {
  const result = data.result;
  const resultObject = result && typeof result === 'object' && !Array.isArray(result)
    ? result as Record<string, unknown>
    : null;
  const goalValue = resultObject?.goal ?? data.goal;
  const goal = goalValue && typeof goalValue === 'object' && !Array.isArray(goalValue)
    ? goalValue as Record<string, unknown>
    : null;

  if (goal) {
    return {
      goalStatus: typeof goal.status === 'string' ? goal.status : 'active',
      goalObjective: typeof goal.objective === 'string' ? goal.objective : '',
    };
  }

  if (resultObject?.cleared === true || data.cleared === true) {
    return {
      goalStatus: '',
      goalObjective: '',
    };
  }

  return null;
}

export function turnObjectFromEventData(data: Record<string, unknown>): Record<string, unknown> | null {
  const turn = data.turn;
  return turn && typeof turn === 'object' && !Array.isArray(turn)
    ? turn as Record<string, unknown>
    : null;
}

export function turnIdFromEventData(data: Record<string, unknown>): string {
  const turn = turnObjectFromEventData(data);
  const value = data.turnId ?? data.turn_id ?? data.codexTurnId ?? data.codex_turn_id ?? turn?.id;
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function turnStatusFromEventData(data: Record<string, unknown>): string {
  const turn = turnObjectFromEventData(data);
  const value = data.status ?? data.lifecycleState ?? data.lifecycle_state ?? turn?.status;
  return typeof value === 'string' ? value : '';
}

export function textFromLocalTurnPayload(payload: Record<string, unknown>): string {
  const input = payload.input;
  if (!Array.isArray(input)) {
    return shortJson(payload).slice(0, 240);
  }

  const text = input
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }
      const record = item as Record<string, unknown>;
      if (typeof record.text === 'string' && record.text) {
        if (record.text.startsWith('[附件:')) {
          return '';
        }
        return record.text;
      }
      if (record.type === 'image') {
        const name = typeof record.name === 'string' && record.name ? record.name : 'image';
        return `[图片附件: ${name}]`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');

  return text || shortJson(payload).slice(0, 240);
}

export function findMentionTrigger(text: string, cursor: number): MentionTrigger | null {
  const end = Math.max(0, Math.min(cursor, text.length));
  const beforeCursor = text.slice(0, end);
  const atIndex = beforeCursor.lastIndexOf('@');
  if (atIndex < 0) {
    return null;
  }

  const prefix = beforeCursor.slice(0, atIndex);
  if (prefix && !/\s$/.test(prefix)) {
    return null;
  }

  const query = beforeCursor.slice(atIndex + 1);
  if (/[^\s@]*\s/.test(query) || query.includes('@')) {
    return null;
  }

  return {
    start: atIndex,
    end,
    query,
  };
}

export function buildMentionSuggestions(
  trigger: MentionTrigger | null,
  entries: WorkspaceEntry[],
): MentionSuggestion[] {
  if (!trigger) {
    return [];
  }

  return entries.slice(0, 8).map((entry) => ({
    id: `${entry.kind}-${entry.path}`,
    title: entry.kind === 'directory' ? `${entry.name}/` : entry.name,
    description: entry.path,
    insertText: entry.kind === 'directory' ? `@${entry.path}` : `@${entry.path} `,
  }));
}

export function insertMention(text: string, trigger: MentionTrigger, insertText: string): string {
  return `${text.slice(0, trigger.start)}${insertText}${text.slice(trigger.end)}`;
}

export function parseMentionReferences(text: string): MentionReference[] {
  const references = new Map<string, MentionReference>();
  const mentionPattern = /(?:^|\s)@([^\s@]+)/g;
  let match: RegExpExecArray | null;

  while ((match = mentionPattern.exec(text)) !== null) {
    const raw = (match[1] ?? '').replace(/[.,;:!?，。；：！？]+$/g, '');
    if (!raw) {
      continue;
    }

    const [prefix, ...rest] = raw.split(':');
    const value = rest.join(':').trim();
    const kind =
      prefix === 'workspace' || prefix === 'conversation' || prefix === 'request'
        ? prefix
        : 'file';
    const resolvedValue = kind === 'file' ? raw : value;
    if (!resolvedValue) {
      continue;
    }
    references.set(`${kind}:${resolvedValue}`, { kind, value: resolvedValue });
  }

  return [...references.values()];
}

export function summarizeMentionReferences(references: MentionReference[]): string {
  const files = references.filter((item) => item.kind === 'file');
  if (!files.length) {
    return '';
  }
  return files.map((item) => item.value).join(', ');
}

export function stringFromUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

export function parseWorkspaceDirectorySnapshot(value: unknown): WorkspaceDirectorySnapshot {
  const root = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const entries = Array.isArray(root.entries)
    ? root.entries
        .map((entry): WorkspaceDirectoryEntry | null => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return null;
          }
          const record = entry as Record<string, unknown>;
          const name = stringFromUnknown(record.name).trim();
          const path = stringFromUnknown(record.path).trim();
          const kind = stringFromUnknown(record.kind);
          if (!name || !path || kind !== 'directory') {
            return null;
          }
          return { name, path, kind: 'directory' };
        })
        .filter((entry): entry is WorkspaceDirectoryEntry => Boolean(entry))
    : [];
  const parent = stringFromUnknown(root.parent).trim();
  return {
    root: stringFromUnknown(root.root).trim(),
    current: stringFromUnknown(root.current).trim(),
    parent: parent || null,
    entries,
  };
}

export async function fetchWorkspaceDirectorySnapshot(
  settings: ConnectionSettings,
  path?: string,
): Promise<WorkspaceDirectorySnapshot> {
  const url = new URL(buildHttpUrl(settings.serverUrl, '/v2/workspace/directories'));
  if (path) {
    url.searchParams.set('path', path);
  }
  const response = await fetch(url.toString(), {
    headers: authHeaders(settings),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === 'object' && !Array.isArray(body)
      ? stringFromUnknown((body as Record<string, unknown>).message)
      : '';
    throw new Error(message || `目录读取失败: ${response.status}`);
  }
  const snapshot = parseWorkspaceDirectorySnapshot(body);
  if (!snapshot.current) {
    throw new Error('后端没有返回当前目录');
  }
  return snapshot;
}

export function progressTextFromData(data: Record<string, unknown>, item: Record<string, unknown> | null): string {
  const direct = [
    data.delta,
    data.text,
    data.message,
    data.summary,
    data.status,
    data.reason,
    data.operation,
    data.command,
    data.question,
  ].map(stringFromUnknown).find(Boolean);
  if (direct) {
    return direct;
  }

  const questions = data.questions;
  if (Array.isArray(questions)) {
    const questionText = questions
      .map((question) => question && typeof question === 'object' && !Array.isArray(question)
        ? stringFromUnknown((question as Record<string, unknown>).question)
        : '')
      .find(Boolean);
    if (questionText) {
      return questionText;
    }
  }

  if (item) {
    const text = textFromItem(item);
    if (text) {
      return text;
    }
    const command = item.command ?? item.name ?? item.toolName ?? item.tool_name;
    if (typeof command === 'string' && command) {
      return command;
    }
  }

  const result = data.result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const resultText = progressTextFromData(result as Record<string, unknown>, null);
    if (resultText) {
      return resultText;
    }
  }

  return '';
}

export function isLifecycleProgressText(text: string): boolean {
  return /^(starting|ready|started|completed|running|idle|busy)$/i.test(text.trim());
}

export function objectPayloadOf(event: ServerEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
}

export function sessionIdFromEvent(event: ServerEvent, data = eventPayloadData(event)): string {
  const direct = transportSessionIdFromEvent(event);
  if (direct) {
    return direct;
  }
  const candidates = [
    data.codexSessionId,
    data.codex_session_id,
    data.sessionId,
    data.session_id,
  ];
  const value = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  return typeof value === 'string' ? value : '';
}

export function cursorFromEvent(event: ServerEvent): number | null {
  return transportCursorFromEvent(event);
}

export function threadIdFromEventData(event: ServerEvent, data = eventPayloadData(event)): string {
  const threadId = extractThreadIdFromEvent(event);
  if (threadId) {
    return threadId;
  }
  const payload = objectPayloadOf(event);
  const candidates = [
    event.codex_thread_id,
    payload.codexThreadId,
    payload.codex_thread_id,
    payload.threadId,
    payload.thread_id,
  ];
  const value = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  return typeof value === 'string' ? normalizeThreadId(value) : '';
}

export function classifyChatEvent(event: ServerEvent, workspaceId: string, conversationId: string): TimelineEntry | null {
  const data = eventPayloadData(event);
  const itemValue = data.item;
  const item = itemValue && typeof itemValue === 'object' && !Array.isArray(itemValue)
    ? itemValue as Record<string, unknown>
    : null;

  if (event.type === 'codex.item.agentMessage.delta') {
    const itemId = typeof data.itemId === 'string'
      ? data.itemId
      : typeof data.item_id === 'string'
        ? data.item_id
        : eventId(event);
    const delta = typeof data.delta === 'string' ? data.delta : '';
    return {
      id: itemId,
      kind: 'incoming',
      title: 'Codex',
      subtitle: delta,
      raw: shortJson(event),
      at: Date.now(),
      workspaceId,
      conversationId,
    };
  }

  if (!item || (event.type !== 'codex.item.started' && event.type !== 'codex.item.completed')) {
    return null;
  }

  const itemType = itemTypeOf(item);
  if (itemType !== 'agentMessage' && itemType !== 'agent_message') {
    return null;
  }

  const text = textFromItem(item);
  return {
    id: itemIdOf(item, eventId(event)),
    kind: 'incoming',
    title: 'Codex',
    subtitle: text || '正在回复...',
    raw: shortJson(event),
    at: Date.now(),
    workspaceId,
    conversationId,
  };
}

export function classifyProgressEvent(event: ServerEvent, workspaceId: string, conversationId: string): TimelineEntry | null {
  const data = eventPayloadData(event);
  const itemValue = data.item;
  const item = itemValue && typeof itemValue === 'object' && !Array.isArray(itemValue)
    ? itemValue as Record<string, unknown>
    : null;
  const type = event.type;
  const itemType = item ? itemTypeOf(item) : '';
  const progressText = progressTextFromData(data, item);
  const requestId = data.requestId ?? data.request_id;
  const pendingRequestId = typeof requestId === 'string' && requestId ? requestId : undefined;

  if (/reasoning|thinking|thought|analysis/i.test(type) || /reasoning|thinking|thought|analysis/i.test(itemType)) {
    if (!progressText || isLifecycleProgressText(progressText)) {
      return null;
    }
    return {
      id: `progress-${eventId(event)}`,
      kind: 'system',
      title: '思考中',
      subtitle: progressText,
      raw: shortJson(event),
      at: Date.now(),
      workspaceId,
      conversationId,
    };
  }

  if (type === 'codex.control.request.accepted' || type === 'codex.control.ready' || type === 'codex.control.response') {
    return null;
  }

  if (/tool|command|mcp|approval|requestUserInput/i.test(type) || /tool|command|mcp|approval/i.test(itemType)) {
    if ((!progressText || isLifecycleProgressText(progressText)) && !type.endsWith('.request')) {
      return null;
    }
    return {
      id: `progress-${eventId(event)}`,
      kind: 'system',
      title: type.endsWith('.request')
        ? '请求权限批准'
        : type.endsWith('.completed') || /resolved|completed/i.test(type)
          ? '步骤完成'
          : '执行步骤',
      subtitle: progressText || type,
      raw: shortJson(event),
      at: Date.now(),
      workspaceId,
      conversationId,
      requestId: pendingRequestId,
    };
  }

  if (/interrupted|failed|error/i.test(type)) {
    return {
      id: `progress-${eventId(event)}`,
      kind: 'system',
      title: /interrupted/i.test(type) ? '已停止' : '运行异常',
      subtitle: progressText || extractProtocolError(type, data) || type,
      raw: shortJson(event),
      at: Date.now(),
      workspaceId,
      conversationId,
    };
  }

  return null;
}

export function isTurnTerminalEvent(event: ServerEvent): boolean {
  return (
    event.type === 'codex.turn.completed' ||
    event.type === 'codex.turn.interrupted' ||
    event.type === 'codex.turn.failed' ||
    event.type === 'codex.error' ||
    event.type === 'codex.control.error'
  );
}

export function makeSystemEntry(title: string, subtitle = '', workspaceId = '', conversationId = ''): TimelineEntry {
  return {
    id: createRequestId('sys'),
    kind: 'system',
    title,
    subtitle,
    raw: '',
    at: Date.now(),
    workspaceId,
    conversationId,
  };
}

export function makeOutgoingEntry(
  message: { id: string; type: string; payload: Record<string, unknown> },
  workspaceId: string,
  conversationId: string,
): TimelineEntry {
  return {
    id: message.id,
    kind: message.type === 'codex.local.turn' ? 'outgoing' : 'system',
    title: message.type === 'codex.local.turn' ? 'You' : `sent ${message.type}`,
    subtitle:
      message.type === 'codex.local.turn'
        ? textFromLocalTurnPayload(message.payload)
        : shortJson(message.payload).slice(0, 220),
    raw: shortJson(message),
    at: Date.now(),
    workspaceId,
    conversationId,
  };
}

export function timelineEntryFromNativeHistoryEntry(
  entry: CodexThreadHistoryEntry,
  workspaceId: string,
  conversationId: string,
): TimelineEntry {
  return {
    ...entry,
    workspaceId,
    conversationId,
  };
}

export function isVisibleConversationEntry(entry: TimelineEntry): boolean {
  return sharedIsVisibleConversationEntry(entry);
}

export function conversationPreviewText(latest: TimelineEntry | undefined): string {
  const text = (latest?.subtitle || latest?.title || '').replace(/\s+/g, ' ').trim();
  return text || '新的对话';
}

export function isStepProgressEntry(entry: TimelineEntry): boolean {
  return sharedIsStepProgressEntry(entry);
}

export function isThinkingProgressEntry(entry: TimelineEntry): boolean {
  return sharedIsThinkingProgressEntry(entry);
}

export function isCollapsibleProgressEntry(entry: TimelineEntry): boolean {
  return sharedIsCollapsibleProgressEntry(entry);
}

export function executionGroupId(entries: TimelineEntry[]): string {
  const first = entries[0]?.id ?? 'empty';
  const last = entries[entries.length - 1]?.id ?? first;
  return `execution-group-${first}-${last}`;
}

export function buildConversationRenderItems(entries: TimelineEntry[]): ConversationRenderItem[] {
  return sharedBuildConversationRenderItems(entries) as ConversationRenderItem[];
}

export function createDefaultConversation(workspace: WorkspaceRecord): ConversationRecord {
  const createdAt = workspace.createdAt || Date.now();
  return {
    id: createRequestId('conversation'),
    workspaceId: workspace.id,
    backendConnectionId: workspace.backendConnectionId ?? null,
    title: '默认对话',
    preview: '',
    nativeStatus: '',
    archived: false,
    sessionId: createSessionId(`${workspace.name}_conversation`),
    threadId: '',
    localAdapterState: 'idle',
    mode: 'implement',
    goalStatus: '',
    goalObjective: '',
    createdAt,
    updatedAt: workspace.updatedAt || createdAt,
  };
}

export function conversationsForWorkspaceSnapshot(
  workspaces: WorkspaceRecord[],
  conversations: ConversationRecord[],
): ConversationRecord[] {
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));
  const next = conversations.filter((conversation) => workspaceIds.has(conversation.workspaceId));
  const existingWorkspaceIds = new Set(next.map((conversation) => conversation.workspaceId));
  for (const workspace of workspaces) {
    if (!existingWorkspaceIds.has(workspace.id)) {
      next.push(createDefaultConversation(workspace));
    }
  }
  return next.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function forkConversationRecord(conversation: ConversationRecord, title?: string): ConversationRecord {
  return {
    ...conversation,
    id: createRequestId('conversation'),
    title: title?.trim() || `${conversation.title || '新对话'} fork`,
    preview: '',
    nativeStatus: '',
    archived: false,
    sessionId: createSessionId(`${conversation.title || 'conversation'}_fork`),
    threadId: '',
    localAdapterState: 'idle',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

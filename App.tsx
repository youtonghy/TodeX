import 'react-native-get-random-values';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import {
  Alert,
  AppState,
  Image,
  Keyboard,
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type KeyboardEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  type StyleProp,
  type TextStyle,
  type TextInputSelectionChangeEventData,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';
import {
  Button,
  Card,
  Chip,
  HeroUINativeProvider,
  Input,
  Label,
  Surface,
  Text as HeroText,
  TextField,
} from 'heroui-native';
import { withUniwind } from 'uniwind';

import {
  ConnectionSettings,
  CodexNativeThread,
  CodexModelCatalogItem,
  CodexReasoningEffortOption,
  DEFAULT_REASONING_EFFORT_OPTIONS,
  FALLBACK_CODEX_MODELS,
  LocalAdapterState,
  PendingRequest,
  ServerEvent,
  WorkspaceRecord,
  approvalResponsePayload,
  buildHttpUrl,
  buildWebSocketUrl,
  classifyPendingRequest,
  createRequestId,
  displayNameFromPath,
  eventId,
  eventPayloadData,
  extractThreadIdFromEvent,
  inferApprovalResponseType,
  isThreadNotMaterializedHistoryError,
  normalizeReasoningEffort,
  normalizeThreadId,
  normalizeServerUrl,
  parseCodexModelListResponse,
  parseCodexNativeThread,
  parseCodexNativeThreadListResponse,
  parseCodexNativeThreadReadResponse,
  sandboxPolicyForMode,
  shortJson,
  type CodexThreadHistoryEntry,
} from './src/lib/todex';
import { loadJson, loadSecret, saveJson, saveSecret } from './src/lib/storage';
import {
  applyPairingToSettings,
  assemblePairingQrChunkPayload,
  createTransportCryptoSession,
  parsePairingQrFrame,
  resolvePairingPayload,
  type PairingQrChunk,
  type TransportCryptoSession,
} from './src/lib/transportCrypto';
import {
  TodeXTransportClient,
  type TransportStatusSnapshot,
  cursorFromEvent as transportCursorFromEvent,
  sessionIdFromEvent as transportSessionIdFromEvent,
} from './src/lib/transport';

type RootStackParamList = {
  Workspaces: undefined;
  Conversations: { workspaceId: string };
  Chat: { workspaceId: string; conversationId: string };
  SlashCommands: { workspaceId: string; conversationId: string };
  SlashCommandAction: { workspaceId: string; conversationId: string; command: string };
  Experimental: { workspaceId: string; conversationId: string };
  GitDiff: { workspaceId: string; conversationId: string };
  Settings: undefined;
};

type ServerVersion = {
  name: string;
  version: string;
  data_dir: string;
  workspace_root: string;
};

type ConversationRecord = {
  id: string;
  workspaceId: string;
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
  createdAt: number;
  updatedAt: number;
};

type PendingThreadList = {
  workspaceId: string;
  sessionId: string;
  requestId: string;
  timeoutId: ReturnType<typeof setTimeout>;
};

type PendingGitDiff = {
  workspaceId: string;
  conversationId: string;
  requestId: string;
  timeoutId: ReturnType<typeof setTimeout>;
};

type ExperimentalFeatureId =
  | 'gitDiffViewer'
  | 'verboseRuntimeEvents'
  | 'composerFileMentions';

type ExperimentalFeatureSettings = Record<ExperimentalFeatureId, boolean>;

type ExperimentalFeatureDefinition = {
  id: ExperimentalFeatureId;
  title: string;
  description: string;
  scope: string;
};

type GitDiffState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  diff: string;
  sha: string;
  error: string;
  updatedAt: number;
};

type PendingThreadAction = {
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
    | 'inject';
  timeoutId: ReturnType<typeof setTimeout>;
  sourceConversationId?: string;
  title?: string;
  restoreHistory?: boolean;
  showResult?: boolean;
  resultTitle?: string;
  resultDetail?: string;
};

type ComposerSelection = TextInputSelectionChangeEventData['selection'];

const DEFAULT_COMPOSER_SELECTION: ComposerSelection = { start: 0, end: 0 };
const DEFAULT_TRANSPORT_STATUS: TransportStatusSnapshot = {
  status: 'disabled',
  clientId: '',
  error: '',
};

type PairingChunkCollector = {
  checksum: string;
  total: number;
  chunks: Map<number, PairingQrChunk>;
};

type ComposerAttachmentDraft = {
  id: string;
  kind: 'image' | 'file';
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  dataUrl: string;
  textContent?: string;
  source: 'clipboard' | 'library' | 'file';
};

type QueuedChatSubmission = {
  id: string;
  text: string;
  attachments: ComposerAttachmentDraft[];
  skills: SelectedSkillAttachment[];
};

type PendingLocalStart = {
  workspaceId: string;
  conversationId: string;
  sessionId: string;
  requestId: string;
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type PendingThreadStart = {
  conversationId: string;
  requestId: string;
  promise: Promise<string>;
  resolve: (threadId: string) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type PendingModelList = {
  requestId: string;
  timeoutId: ReturnType<typeof setTimeout>;
};

type PendingSkillList = {
  workspaceId: string;
  conversationId: string;
  requestId: string;
  timeoutId: ReturnType<typeof setTimeout>;
};

type PendingJsonSave = {
  timeoutId: ReturnType<typeof setTimeout>;
  value: unknown;
};

type ConversationContext = {
  workspace: WorkspaceRecord;
  conversation: ConversationRecord;
};

type ModelCommandPromptState = {
  conversationId: string;
  initialValue: string;
  target?: 'workspace' | 'settings';
};

type ModelPickerPromptState = {
  target: 'workspace' | 'settings';
  conversationId?: string;
};

type ThreadInfoModalState = {
  title: string;
  detail: string;
  raw?: unknown;
};

type ThreadCommandPromptState = {
  conversationId: string;
  command: 'metadata' | 'memory' | 'shell' | 'items' | 'inject' | 'guardian';
  title: string;
  placeholder: string;
  initialValue: string;
  warning?: string;
  multiline?: boolean;
};

type SkillListStatus = 'idle' | 'loading' | 'ready' | 'error';

type SkillListItem = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  shortDescription: string;
  scope: string;
  path: string;
  enabled: boolean;
};

type SelectedSkillAttachment = {
  name: string;
  path: string;
  displayName: string;
};

type ThreadMenuAction =
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

type TimelineTarget = {
  workspaceId: string;
  conversationId: string;
};

type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

type RuntimeStatusState = {
  socket: ConnectionState;
  transport: TransportStatusSnapshot;
  daemon: ConnectionHealth['status'];
  codexAdapter: LocalAdapterState | 'unknown';
  turn: 'idle' | 'running';
};

type ConnectionHealth = {
  status: 'unknown' | 'checking' | 'online' | 'offline';
  latencyMs: number | null;
  lastCheckedAt: number | null;
  error: string;
};

const CONNECTION_HEALTH_INTERVAL_MS = 5000;
const CONNECTION_HEALTH_TIMEOUT_MS = 3500;
const MAX_COMPOSER_ATTACHMENTS = 8;
const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_FILE_ATTACHMENT_BYTES = 512 * 1024;

function localConversationStateOf(conversation: ConversationRecord | null): LocalAdapterState {
  return conversation?.localAdapterState ?? 'idle';
}

function isConversationHighlighted(conversation: ConversationRecord, activeConversationId: string, activeTurns: Record<string, string>): boolean {
  return conversation.id === activeConversationId || Boolean(activeTurns[conversation.id]);
}

function sessionIdForConversation(workspace: WorkspaceRecord, conversation: ConversationRecord): string {
  return workspace.sessionId || conversation.sessionId || createSessionId(workspace.name);
}

function commandWorkspaceForConversation(workspace: WorkspaceRecord, conversation: ConversationRecord): WorkspaceRecord {
  return {
    ...workspace,
    sessionId: sessionIdForConversation(workspace, conversation),
    threadId: normalizeThreadId(conversation.threadId),
    localAdapterState: localConversationStateOf(conversation),
  };
}

function isLocalAdapterAlreadyRunning(text: string): boolean {
  return /adapter already owns this session/i.test(text);
}

function isLocalAdapterFailed(text: string): boolean {
  return /local Codex adapter is not ready;\s*current state is Failed/i.test(text);
}

function isThreadNotFound(text: string): boolean {
  return /thread not found/i.test(text);
}

function localTurnErrorMessage(text: string): string {
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

function attachmentId(): string {
  return createRequestId('att');
}

function formatBytes(bytes: number | null | undefined): string {
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

function fileNameFromUri(uri: string, fallback: string): string {
  const clean = uri.split('?')[0]?.split('#')[0] ?? uri;
  const part = clean.split('/').filter(Boolean).pop();
  return part ? decodeURIComponent(part) : fallback;
}

function inferMimeType(name: string, fallback = 'application/octet-stream'): string {
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

function isImageMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('image/');
}

function isTextAttachment(name: string, mimeType: string): boolean {
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

function mimeTypeFromDataUrl(dataUrl: string): string | null {
  const match = /^data:([^;,]+)[;,]/i.exec(dataUrl.trim());
  return match?.[1] ?? null;
}

function base64FromDataUrl(dataUrl: string): string {
  const marker = ';base64,';
  const index = dataUrl.indexOf(marker);
  return index >= 0 ? dataUrl.slice(index + marker.length) : '';
}

function dataUrlFromBase64(base64: string, mimeType: string): string {
  const trimmed = base64.trim();
  if (trimmed.startsWith('data:')) {
    return trimmed;
  }
  return `data:${mimeType};base64,${trimmed}`;
}

function estimatedBytesFromBase64(base64: string): number {
  const normalized = base64.replace(/\s/g, '');
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

async function readBase64DataUrl(uri: string, mimeType: string, base64?: string | null): Promise<{ dataUrl: string; sizeBytes: number | null }> {
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

async function resolveFileSizeBytes(uri: string, fallbackSizeBytes: number | null | undefined): Promise<number | null> {
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

async function readTextAttachmentContent(uri: string, name: string, mimeType: string, sizeBytes: number | null): Promise<string | undefined> {
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

function attachmentPrompt(attachments: ComposerAttachmentDraft[]): string {
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

function attachmentTextBlock(attachment: ComposerAttachmentDraft): string {
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

function codexInputFromComposer(
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

function attachmentSummary(attachments: ComposerAttachmentDraft[]): string {
  return attachments
    .map((item) => `${item.kind === 'image' ? '图片' : '文件'} ${item.name} (${formatBytes(item.sizeBytes)})`)
    .join('\n');
}

function selectedSkillSummary(skills: SelectedSkillAttachment[]): string {
  return skills.map((item) => `${item.displayName || item.name} (${item.name})`).join('\n');
}

function skillIdFromPath(name: string, path: string): string {
  return `${name}:${path}`;
}

function parseSkillListItems(value: unknown): SkillListItem[] {
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

function extractProtocolError(eventType: string, data: Record<string, unknown>): string {
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

function keyboardHeightFromEvent(event: KeyboardEvent): number {
  const height = event.endCoordinates?.height ?? 0;
  return Number.isFinite(height) ? Math.max(0, height) : 0;
}

function useKeyboardInset(): number {
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const changeEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';

    const subscriptions = [
      Keyboard.addListener(showEvent, (event) => {
        setKeyboardInset(keyboardHeightFromEvent(event));
      }),
      Keyboard.addListener(hideEvent, () => {
        setKeyboardInset(0);
      }),
    ];

    if (changeEvent !== showEvent) {
      subscriptions.push(Keyboard.addListener(changeEvent, (event) => {
        setKeyboardInset(keyboardHeightFromEvent(event));
      }));
    }

    const visibleKeyboard = Keyboard.metrics?.();
    if (visibleKeyboard) {
      const height = visibleKeyboard.height ?? 0;
      setKeyboardInset(Number.isFinite(height) ? Math.max(0, height) : 0);
    }

    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, []);

  return keyboardInset;
}

type TimelineEntry = {
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

type ConversationRenderItem =
  | { type: 'entry'; entry: TimelineEntry }
  | { type: 'executionGroup'; id: string; entries: TimelineEntry[] };

type SlashCommand = {
  command: string;
  title: string;
  description: string;
  category: SlashCommandCategory;
};

type SlashCommandCategory = 'core' | 'thread' | 'context' | 'runtime' | 'settings' | 'debug';

type WorkspaceEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file';
};

type MentionTrigger = {
  start: number;
  end: number;
  query: string;
};

type MentionSuggestion = {
  id: string;
  title: string;
  description: string;
  insertText: string;
};

type PermissionPresetId = 'read-only' | 'default' | 'full-access';

type PermissionPreset = {
  id: PermissionPresetId;
  title: string;
  description: string;
  approvalPolicy: string;
  sandboxMode: string;
};

type MentionReference = {
  kind: 'file' | 'workspace' | 'conversation' | 'request';
  value: string;
};

type WorkspaceMentionHistory = {
  workspaceId: string;
  files: string[];
  updatedAt: number;
};

const REASONING_EFFORT_LABELS: Record<string, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
};

function reasoningEffortLabel(value: string | null | undefined): string {
  const normalized = normalizeReasoningEffort(value);
  return normalized ? REASONING_EFFORT_LABELS[normalized] ?? normalized : 'Default';
}

function modelDisplayLabel(model: string | null | undefined, catalog: CodexModelCatalogItem[]): string {
  const normalized = model?.trim() ?? '';
  if (!normalized) {
    return '未设置';
  }
  return catalog.find((item) => item.model === normalized)?.displayName || normalized;
}

function reasoningOptionsForModel(
  model: string | null | undefined,
  catalog: CodexModelCatalogItem[],
): CodexReasoningEffortOption[] {
  const preset = catalog.find((item) => item.model === model);
  return preset?.supportedReasoningEfforts.length ? preset.supportedReasoningEfforts : DEFAULT_REASONING_EFFORT_OPTIONS;
}

function defaultReasoningForModel(model: string | null | undefined, catalog: CodexModelCatalogItem[]): string | null {
  const preset = catalog.find((item) => item.model === model);
  return preset?.defaultReasoningEffort ?? null;
}

function mergeModelCatalog(remoteModels: CodexModelCatalogItem[], currentModels: string[]): CodexModelCatalogItem[] {
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
        });
      }
    });
  return [...byModel.values()].filter((item) => !item.hidden);
}

function normalizeExperimentalFeatures(value: Partial<ExperimentalFeatureSettings> | null | undefined): ExperimentalFeatureSettings {
  return {
    ...EXPERIMENTAL_FEATURE_DEFAULTS,
    ...(value && typeof value === 'object' ? value : {}),
  };
}

function itemTypeOf(item: Record<string, unknown>): string {
  const rawType = item.type ?? item.itemType ?? item.item_type;
  return typeof rawType === 'string' ? rawType : '';
}

function itemIdOf(item: Record<string, unknown>, fallback: string): string {
  const rawId = item.id ?? item.itemId ?? item.item_id;
  return typeof rawId === 'string' && rawId ? rawId : fallback;
}

function textFromContent(value: unknown): string {
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

function textFromItem(item: Record<string, unknown>): string {
  const directText = item.text ?? item.message;
  if (typeof directText === 'string') {
    return directText;
  }
  return textFromContent(item.content);
}

type PersistedSettings = Omit<ConnectionSettings, 'authToken'>;

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();
enableScreens(true);

const StyledIonicons = withUniwind(Ionicons);

const SETTINGS_STORAGE_KEY = 'todex.mobile.settings.v1';
const WORKSPACES_STORAGE_KEY = 'todex.mobile.workspaces.v1';
const CONVERSATIONS_STORAGE_KEY = 'todex.mobile.conversations.v1';
const TIMELINE_STORAGE_KEY = 'todex.mobile.timeline.v1';
const ACTIVE_SELECTION_STORAGE_KEY = 'todex.mobile.activeSelection.v1';
const MENTION_HISTORY_STORAGE_KEY = 'todex.mobile.mentionHistory.v1';
const SESSION_CURSORS_STORAGE_KEY = 'todex.mobile.sessionCursors.v1';
const EXPERIMENTAL_FEATURES_STORAGE_KEY = 'todex.mobile.experimentalFeatures.v1';
const TOKEN_STORAGE_KEY = 'todex.mobile.token.v1';
const JSON_SAVE_DEBOUNCE_MS = 350;
const SESSION_CURSOR_SAVE_DEBOUNCE_MS = 800;
const SOCKET_EVENT_BATCH_SIZE = 24;
const MAX_TIMELINE_ITEMS = 260;
const MAX_EVENTS = 220;
const RECONNECT_DELAY_MS = 2500;
const CHAT_ATTACH_REPLAY_LIMIT = 200;
const CHAT_BOTTOM_FOLLOW_THRESHOLD = 72;

const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/model', title: 'Model', description: 'choose what model and reasoning effort to use', category: 'settings' },
  { command: '/ide', title: 'IDE Context', description: 'include current selection, open files, and other context from your IDE', category: 'context' },
  { command: '/permissions', title: 'Permissions', description: 'choose what Codex is allowed to do', category: 'settings' },
  { command: '/keymap', title: 'Keymap', description: 'remap TUI shortcuts', category: 'settings' },
  { command: '/vim', title: 'Vim', description: 'toggle Vim mode for the composer', category: 'settings' },
  { command: '/setup-default-sandbox', title: 'Setup Default Sandbox', description: 'set up elevated agent sandbox', category: 'settings' },
  { command: '/sandbox-add-read-dir', title: 'Sandbox Read Root', description: 'let sandbox read a directory', category: 'settings' },
  { command: '/experimental', title: 'Experimental', description: 'toggle experimental features', category: 'settings' },
  { command: '/approve', title: 'Approve', description: 'approve one retry of a recent auto-review denial', category: 'runtime' },
  { command: '/memories', title: 'Memories', description: 'configure memory use and generation', category: 'settings' },
  { command: '/skills', title: 'Skills', description: 'use skills to improve how Codex performs specific tasks', category: 'context' },
  { command: '/hooks', title: 'Hooks', description: 'view and manage lifecycle hooks', category: 'context' },
  { command: '/review', title: 'Review', description: 'review my current changes and find issues', category: 'context' },
  { command: '/rename', title: 'Rename', description: 'rename the current thread', category: 'thread' },
  { command: '/new', title: 'New', description: 'start a new chat during a conversation', category: 'thread' },
  { command: '/resume', title: 'Resume', description: 'resume a saved chat', category: 'thread' },
  { command: '/fork', title: 'Fork', description: 'fork the current chat', category: 'thread' },
  { command: '/init', title: 'Init', description: 'create an AGENTS.md file with instructions for Codex', category: 'context' },
  { command: '/compact', title: 'Compact', description: 'summarize conversation to prevent hitting the context limit', category: 'thread' },
  { command: '/plan', title: 'Plan', description: 'switch to Plan mode', category: 'core' },
  { command: '/goal', title: 'Goal', description: 'set or view the goal for a long-running task', category: 'thread' },
  { command: '/agent', title: 'Agent', description: 'switch the active agent thread', category: 'thread' },
  { command: '/subagents', title: 'Subagents', description: 'switch the active agent thread', category: 'thread' },
  { command: '/side', title: 'Side', description: 'start a side conversation in an ephemeral fork', category: 'thread' },
  { command: '/copy', title: 'Copy', description: 'copy last response as markdown', category: 'context' },
  { command: '/raw', title: 'Raw', description: 'toggle raw scrollback mode for copy-friendly selection', category: 'context' },
  { command: '/diff', title: 'Diff', description: 'show git diff including untracked files', category: 'context' },
  { command: '/mention', title: 'Mention', description: 'mention a file', category: 'context' },
  { command: '/status', title: 'Status', description: 'show current session configuration and token usage', category: 'core' },
  { command: '/debug-config', title: 'Debug Config', description: 'show config layers and requirement sources', category: 'settings' },
  { command: '/title', title: 'Title', description: 'configure terminal title items', category: 'settings' },
  { command: '/statusline', title: 'Statusline', description: 'configure status line items', category: 'settings' },
  { command: '/theme', title: 'Theme', description: 'choose a syntax highlighting theme', category: 'settings' },
  { command: '/pets', title: 'Pets', description: 'choose or hide the terminal pet', category: 'settings' },
  { command: '/pet', title: 'Pets', description: 'alias for /pets', category: 'settings' },
  { command: '/mcp', title: 'MCP', description: 'list configured MCP tools; use /mcp verbose for details', category: 'context' },
  { command: '/apps', title: 'Apps', description: 'manage apps', category: 'context' },
  { command: '/plugins', title: 'Plugins', description: 'browse plugins', category: 'context' },
  { command: '/logout', title: 'Logout', description: 'log out of Codex', category: 'settings' },
  { command: '/quit', title: 'Quit', description: 'exit Codex', category: 'runtime' },
  { command: '/exit', title: 'Exit', description: 'exit Codex', category: 'runtime' },
  { command: '/feedback', title: 'Feedback', description: 'send logs to maintainers', category: 'settings' },
  { command: '/rollout', title: 'Rollout', description: 'print the rollout file path', category: 'thread' },
  { command: '/ps', title: 'PS', description: 'list background terminals', category: 'runtime' },
  { command: '/stop', title: 'Stop', description: 'stop all background terminals', category: 'runtime' },
  { command: '/clean', title: 'Clean', description: 'alias for /stop', category: 'runtime' },
  { command: '/clear', title: 'Clear', description: 'clear the terminal and start a new chat', category: 'thread' },
  { command: '/personality', title: 'Personality', description: 'choose a communication style for Codex', category: 'settings' },
  { command: '/realtime', title: 'Realtime', description: 'toggle realtime voice mode', category: 'settings' },
  { command: '/settings', title: 'Settings', description: 'configure realtime microphone/speaker', category: 'settings' },
  { command: '/test-approval', title: 'Test Approval', description: 'test approval request', category: 'debug' },
  { command: '/debug-m-drop', title: 'Debug Memory Drop', description: 'debug memory drop', category: 'debug' },
  { command: '/debug-m-update', title: 'Debug Memory Update', description: 'debug memory update', category: 'debug' },
];

const EXPERIMENTAL_FEATURE_DEFAULTS: ExperimentalFeatureSettings = {
  gitDiffViewer: false,
  verboseRuntimeEvents: false,
  composerFileMentions: false,
};

const EXPERIMENTAL_FEATURES: ExperimentalFeatureDefinition[] = [
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

const SLASH_COMMAND_CATEGORY_ORDER: SlashCommandCategory[] = ['core', 'thread', 'context', 'runtime', 'settings', 'debug'];

const SLASH_COMMAND_CATEGORY_LABELS: Record<SlashCommandCategory, string> = {
  core: '核心',
  thread: 'Thread',
  context: '上下文',
  runtime: '运行时',
  settings: '设置',
  debug: '调试',
};

const DIRECT_SLASH_COMMANDS = new Set([
  '/compact',
  '/init',
  '/mention',
  '/copy',
  '/raw',
  '/vim',
  '/rollout',
  '/debug-m-drop',
  '/debug-m-update',
]);

function canonicalSlashCommand(command: string): string {
  const normalized = command.trim().toLowerCase();
  if (normalized === '/pet') {
    return '/pets';
  }
  if (normalized === '/clean') {
    return '/stop';
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function slashCommandDefinition(command: string): SlashCommand | null {
  const canonical = canonicalSlashCommand(command);
  return SLASH_COMMANDS.find((item) => canonicalSlashCommand(item.command) === canonical) ?? null;
}

function slashCommandNeedsActionPage(command: string): boolean {
  return !DIRECT_SLASH_COMMANDS.has(canonicalSlashCommand(command));
}

const PERMISSION_PRESETS: PermissionPreset[] = [
  {
    id: 'read-only',
    title: 'Read Only',
    description: 'Codex can read files. Approval is required to edit files or access the internet.',
    approvalPolicy: 'on-request',
    sandboxMode: 'read-only',
  },
  {
    id: 'default',
    title: 'Default',
    description: 'Codex can read and edit files in the current workspace. Approval is required for network or outside edits.',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
  },
  {
    id: 'full-access',
    title: 'Full Access',
    description: 'Codex can edit files outside this workspace and access the internet without asking.',
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
  },
];

const defaultSettings: ConnectionSettings = {
  serverUrl: 'http://127.0.0.1:7345',
  authToken: '',
  tenantId: 'local',
  encryptionProtocol: 'none',
  encryptionPublicKey: '',
  defaultWorkspacePath: '/home/dev/projects',
  defaultModel: 'gpt-5.5',
  defaultReasoningEffort: 'medium',
  approvalPolicy: 'on-request',
  sandboxMode: 'workspace-write',
};

const defaultConnectionHealth: ConnectionHealth = {
  status: 'unknown',
  latencyMs: null,
  lastCheckedAt: null,
  error: '',
};

function modelCommandInitialValue(workspace: WorkspaceRecord, settings: ConnectionSettings): string {
  return [workspace.model || settings.defaultModel, normalizeReasoningEffort(workspace.reasoningEffort)]
    .filter(Boolean)
    .join(' ');
}

function parseModelCommandArgs(args: string[]): {
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

function toPersistedSettings(settings: ConnectionSettings): PersistedSettings {
  const { authToken: _authToken, ...rest } = settings;
  return rest;
}

function fromPersistedSettings(raw: Partial<PersistedSettings> | null | undefined, authToken: string): ConnectionSettings {
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

function sanitizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function createSessionId(name: string): string {
  const slug = sanitizeSlug(name) || 'workspace';
  return `cdxs_${slug}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function connectionStateLabel(state: ConnectionState): string {
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

function latencyLabelOf(latencyMs: number | null): string {
  return latencyMs === null ? '未检测' : `${latencyMs} ms`;
}

function healthLabelOf(health: ConnectionHealth): string {
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

function modeLabelOf(mode: ConversationRecord['mode']): string {
  return mode === 'plan' ? 'Plan mode' : 'Implement mode';
}

function compactGoalLabel(conversation: ConversationRecord): string {
  if (!conversation.goalStatus && !conversation.goalObjective) {
    return 'No goal';
  }
  if (conversation.goalObjective) {
    return `Goal · ${conversation.goalObjective}`;
  }
  return `Goal · ${conversation.goalStatus}`;
}

function conversationTitleFromNativeThread(thread: CodexNativeThread): string {
  return thread.name || thread.preview || thread.title || thread.id;
}

function conversationPatchFromNativeThread(thread: CodexNativeThread): Partial<ConversationRecord> {
  return {
    title: conversationTitleFromNativeThread(thread),
    preview: thread.preview,
    nativeStatus: thread.status,
    archived: thread.archived,
    threadId: thread.id,
    updatedAt: thread.updatedAt || Date.now(),
    createdAt: thread.createdAt || Date.now(),
  };
}

function threadDateLabel(timestamp: number): string {
  if (!timestamp) {
    return 'unknown';
  }
  return new Date(timestamp).toLocaleString();
}

function formatThreadSummary(thread: CodexNativeThread): string {
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

function valueAtPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const part of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resultThreadFromValue(value: unknown): CodexNativeThread | null {
  return (
    parseCodexNativeThread(value) ||
    parseCodexNativeThread(valueAtPath(value, ['thread'])) ||
    parseCodexNativeThread(valueAtPath(value, ['result', 'thread'])) ||
    null
  );
}

function formatThreadActionResult(action: PendingThreadAction, responseValue: unknown): string {
  const thread = resultThreadFromValue(responseValue);
  if (thread && (action.action === 'detail' || action.action === 'metadata' || action.action === 'rollback' || action.action === 'unarchive')) {
    return formatThreadSummary(thread);
  }
  return shortJson(responseValue);
}

function parseThreadMetadataArgs(args: string[]): { gitInfo: Record<string, string | null>; error?: string } {
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

function parseThreadMetadataPrompt(value: string): { gitInfo: Record<string, string | null>; error?: string } {
  const args = value.trim().split(/\s+/).filter(Boolean);
  return parseThreadMetadataArgs(args);
}

function parseThreadMemoryMode(value: string): 'enabled' | 'disabled' | 'reset' | '' {
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

function parsePositiveLimit(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 100);
}

function parseJsonArrayPrompt(value: string): unknown[] | null {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function nativeThreadPatchFromNotification(eventType: string, data: Record<string, unknown>): Partial<ConversationRecord> | null {
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

function goalPatchFromEventData(data: Record<string, unknown>): Pick<ConversationRecord, 'goalStatus' | 'goalObjective'> | null {
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

function turnObjectFromEventData(data: Record<string, unknown>): Record<string, unknown> | null {
  const turn = data.turn;
  return turn && typeof turn === 'object' && !Array.isArray(turn)
    ? turn as Record<string, unknown>
    : null;
}

function turnIdFromEventData(data: Record<string, unknown>): string {
  const turn = turnObjectFromEventData(data);
  const value = data.turnId ?? data.turn_id ?? data.codexTurnId ?? data.codex_turn_id ?? turn?.id;
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function turnStatusFromEventData(data: Record<string, unknown>): string {
  const turn = turnObjectFromEventData(data);
  const value = data.status ?? data.lifecycleState ?? data.lifecycle_state ?? turn?.status;
  return typeof value === 'string' ? value : '';
}

function textFromLocalTurnPayload(payload: Record<string, unknown>): string {
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

function findMentionTrigger(text: string, cursor: number): MentionTrigger | null {
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

function buildMentionSuggestions(
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

function insertMention(text: string, trigger: MentionTrigger, insertText: string): string {
  return `${text.slice(0, trigger.start)}${insertText}${text.slice(trigger.end)}`;
}

function parseMentionReferences(text: string): MentionReference[] {
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

function summarizeMentionReferences(references: MentionReference[]): string {
  const files = references.filter((item) => item.kind === 'file');
  if (!files.length) {
    return '';
  }
  return files.map((item) => item.value).join(', ');
}

function stringFromUnknown(value: unknown): string {
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

function progressTextFromData(data: Record<string, unknown>, item: Record<string, unknown> | null): string {
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

function isLifecycleProgressText(text: string): boolean {
  return /^(starting|ready|started|completed|running|idle|busy)$/i.test(text.trim());
}

function objectPayloadOf(event: ServerEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
}

function sessionIdFromEvent(event: ServerEvent, data = eventPayloadData(event)): string {
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

function cursorFromEvent(event: ServerEvent): number | null {
  return transportCursorFromEvent(event);
}

function threadIdFromEventData(event: ServerEvent, data = eventPayloadData(event)): string {
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

function classifyChatEvent(event: ServerEvent, workspaceId: string, conversationId: string): TimelineEntry | null {
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

function classifyProgressEvent(event: ServerEvent, workspaceId: string, conversationId: string): TimelineEntry | null {
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

function isTurnTerminalEvent(event: ServerEvent): boolean {
  return (
    event.type === 'codex.turn.completed' ||
    event.type === 'codex.turn.interrupted' ||
    event.type === 'codex.turn.failed' ||
    event.type === 'codex.error' ||
    event.type === 'codex.control.error'
  );
}

function makeSystemEntry(title: string, subtitle = '', workspaceId = '', conversationId = ''): TimelineEntry {
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

function makeOutgoingEntry(
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

function timelineEntryFromNativeHistoryEntry(
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

function isVisibleConversationEntry(entry: TimelineEntry): boolean {
  if (entry.kind === 'outgoing' || entry.kind === 'incoming') {
    return true;
  }

  if (/^sent codex\./i.test(entry.title)) {
    return false;
  }

  if (entry.title === '协议指令' || entry.title === '已开始思考') {
    return false;
  }

  if (isLifecycleProgressText(entry.subtitle)) {
    return false;
  }

  return true;
}

function conversationPreviewText(latest: TimelineEntry | undefined): string {
  const text = (latest?.subtitle || latest?.title || '').replace(/\s+/g, ' ').trim();
  return text || '新的对话';
}

function isStepProgressEntry(entry: TimelineEntry): boolean {
  return entry.kind === 'system' && (
    entry.title === '执行步骤' ||
    entry.title === '步骤完成' ||
    entry.title === '请求权限批准'
  );
}

function isThinkingProgressEntry(entry: TimelineEntry): boolean {
  return entry.kind === 'system' && entry.title === '思考中';
}

function isCollapsibleProgressEntry(entry: TimelineEntry): boolean {
  return isStepProgressEntry(entry) || isThinkingProgressEntry(entry);
}

function executionGroupId(entries: TimelineEntry[]): string {
  const first = entries[0]?.id ?? 'empty';
  const last = entries[entries.length - 1]?.id ?? first;
  return `execution-group-${first}-${last}`;
}

function buildConversationRenderItems(entries: TimelineEntry[]): ConversationRenderItem[] {
  const items: ConversationRenderItem[] = [];
  let index = 0;

  while (index < entries.length) {
    const entry = entries[index];
    if (!isStepProgressEntry(entry)) {
      items.push({ type: 'entry', entry });
      index += 1;
      continue;
    }

    const groupEntries: TimelineEntry[] = [];
    while (index < entries.length && isStepProgressEntry(entries[index])) {
      groupEntries.push(entries[index]);
      index += 1;
    }
    items.push({
      type: 'executionGroup',
      id: executionGroupId(groupEntries),
      entries: groupEntries,
    });
  }

  return items;
}

function createDefaultConversation(workspace: WorkspaceRecord): ConversationRecord {
  const createdAt = workspace.createdAt || Date.now();
  return {
    id: createRequestId('conversation'),
    workspaceId: workspace.id,
    title: '默认对话',
    preview: '',
    nativeStatus: '',
    archived: false,
    sessionId: workspace.sessionId || createSessionId(workspace.name),
    threadId: '',
    localAdapterState: 'idle',
    mode: 'implement',
    goalStatus: '',
    goalObjective: '',
    createdAt,
    updatedAt: workspace.updatedAt || createdAt,
  };
}

function forkConversationRecord(conversation: ConversationRecord, title?: string): ConversationRecord {
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

export default function App() {
  const socketRef = useRef<WebSocket | null>(null);
  const socketCryptoRef = useRef<TransportCryptoSession | null>(null);
  const activeWorkspaceRef = useRef('');
  const activeConversationRef = useRef('');
  const workspacesRef = useRef<WorkspaceRecord[]>([]);
  const conversationsRef = useRef<ConversationRecord[]>([]);
  const pendingLocalStartsRef = useRef(new Map<string, PendingLocalStart>());
  const pendingThreadStartsRef = useRef(new Map<string, PendingThreadStart>());
  const pendingThreadListsRef = useRef(new Map<string, PendingThreadList>());
  const pendingThreadActionsRef = useRef(new Map<string, PendingThreadAction>());
  const pendingGitDiffsRef = useRef(new Map<string, PendingGitDiff>());
  const pendingSkillListsRef = useRef(new Map<string, PendingSkillList>());
  const pendingModelListRef = useRef<PendingModelList | null>(null);
  const pendingJsonSavesRef = useRef(new Map<string, PendingJsonSave>());
  const pendingServerEventsRef = useRef<ServerEvent[]>([]);
  const pendingServerEventFrameRef = useRef<number | null>(null);
  const transportClientRef = useRef<TodeXTransportClient | null>(null);
  const autoConnectAttemptedRef = useRef(false);
  const sessionCursorsRef = useRef(new Map<string, number>());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualDisconnectRef = useRef(false);
  const healthProbeSeqRef = useRef(0);
  const loadedNativeThreadHistoryRef = useRef(new Map<string, number>());
  const unmaterializedNativeThreadIdsRef = useRef(new Set<string>());

  const [hydrated, setHydrated] = useState(false);
  const [autoConnectEnabled, setAutoConnectEnabled] = useState(false);
  const [settings, setSettings] = useState<ConnectionSettings>(defaultSettings);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('');
  const [activeConversationId, setActiveConversationId] = useState('');
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [connectionHealth, setConnectionHealth] = useState<ConnectionHealth>(defaultConnectionHealth);
  const [transportStatus, setTransportStatus] = useState<TransportStatusSnapshot>(DEFAULT_TRANSPORT_STATUS);
  const [remoteModelCatalog, setRemoteModelCatalog] = useState<CodexModelCatalogItem[]>([]);
  const [modelCatalogStatus, setModelCatalogStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [modelCatalogError, setModelCatalogError] = useState('');
  const [lastError, setLastError] = useState('');
  const [serverVersion, setServerVersion] = useState<ServerVersion | null>(null);
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [mentionHistory, setMentionHistory] = useState<WorkspaceMentionHistory[]>([]);
  const [experimentalFeatures, setExperimentalFeatures] = useState<ExperimentalFeatureSettings>(EXPERIMENTAL_FEATURE_DEFAULTS);
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [queuedChatDrafts, setQueuedChatDrafts] = useState<Record<string, QueuedChatSubmission[]>>({});
  const [composerAttachments, setComposerAttachments] = useState<Record<string, ComposerAttachmentDraft[]>>({});
  const [composerSelections, setComposerSelections] = useState<Record<string, ComposerSelection>>({});
  const [selectedSkills, setSelectedSkills] = useState<Record<string, SelectedSkillAttachment[]>>({});
  const [skillListVisible, setSkillListVisible] = useState(false);
  const [skillListConversationId, setSkillListConversationId] = useState('');
  const [skillListStatus, setSkillListStatus] = useState<SkillListStatus>('idle');
  const [skillListError, setSkillListError] = useState('');
  const [skillListItems, setSkillListItems] = useState<SkillListItem[]>([]);
  const [modelCommandPrompt, setModelCommandPrompt] = useState<ModelCommandPromptState | null>(null);
  const [modelPickerPrompt, setModelPickerPrompt] = useState<ModelPickerPromptState | null>(null);
  const [threadInfoModal, setThreadInfoModal] = useState<ThreadInfoModalState | null>(null);
  const [threadCommandPrompt, setThreadCommandPrompt] = useState<ThreadCommandPromptState | null>(null);
  const [turnIds, setTurnIds] = useState<Record<string, string>>({});
  const [thinkingConversations, setThinkingConversations] = useState<Record<string, boolean>>({});
  const [threadListStatusByWorkspace, setThreadListStatusByWorkspace] = useState<Record<string, 'idle' | 'loading' | 'ready' | 'error'>>({});
  const [threadListErrorByWorkspace, setThreadListErrorByWorkspace] = useState<Record<string, string>>({});
  const [gitDiffByConversation, setGitDiffByConversation] = useState<Record<string, GitDiffState>>({});
  const queuedChatDraftsRef = useRef<Record<string, QueuedChatSubmission[]>>({});
  const queuedChatDispatchingRef = useRef(new Set<string>());
  const sendQueuedChatDraftRef = useRef<(submission: QueuedChatSubmission, conversationId: string) => Promise<boolean>>(async () => false);

  const activeTurnId = activeConversationId ? turnIds[activeConversationId] ?? '' : '';
  const modelCatalog = useMemo(
    () => mergeModelCatalog(
      remoteModelCatalog,
      [
        settings.defaultModel,
        ...workspaces.map((workspace) => workspace.model),
      ],
    ),
    [remoteModelCatalog, settings.defaultModel, workspaces],
  );

  const setConversationChatDraft = useCallback((conversationId: string, value: SetStateAction<string>) => {
    if (!conversationId) {
      return;
    }
    setChatDrafts((current) => {
      const previous = current[conversationId] ?? '';
      const next = typeof value === 'function' ? value(previous) : value;
      if (next === previous) {
        return current;
      }
      return { ...current, [conversationId]: next };
    });
  }, []);

  const setConversationAttachments = useCallback((conversationId: string, value: SetStateAction<ComposerAttachmentDraft[]>) => {
    if (!conversationId) {
      return;
    }
    setComposerAttachments((current) => {
      const previous = current[conversationId] ?? [];
      const next = typeof value === 'function' ? value(previous) : value;
      if (next === previous) {
        return current;
      }
      if (next.length === 0) {
        const { [conversationId]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [conversationId]: next };
    });
  }, []);

  const setConversationSelectedSkills = useCallback((conversationId: string, value: SetStateAction<SelectedSkillAttachment[]>) => {
    if (!conversationId) {
      return;
    }
    setSelectedSkills((current) => {
      const previous = current[conversationId] ?? [];
      const next = typeof value === 'function' ? value(previous) : value;
      if (next === previous) {
        return current;
      }
      if (next.length === 0) {
        const { [conversationId]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [conversationId]: next };
    });
  }, []);

  useEffect(() => {
    queuedChatDraftsRef.current = queuedChatDrafts;
  }, [queuedChatDrafts]);

  const setConversationComposerSelection = useCallback((conversationId: string, value: SetStateAction<ComposerSelection>) => {
    if (!conversationId) {
      return;
    }
    setComposerSelections((current) => {
      const previous = current[conversationId] ?? DEFAULT_COMPOSER_SELECTION;
      const next = typeof value === 'function' ? value(previous) : value;
      if (next.start === previous.start && next.end === previous.end) {
        return current;
      }
      return { ...current, [conversationId]: next };
    });
  }, []);

  const setConversationTurnId = useCallback((conversationId: string, value: string) => {
    if (!conversationId) {
      return;
    }
    setTurnIds((current) => {
      if ((current[conversationId] ?? '') === value) {
        return current;
      }
      if (!value) {
        const { [conversationId]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [conversationId]: value };
    });
  }, []);

  const setConversationThinking = useCallback((conversationId: string, value: boolean) => {
    if (!conversationId) {
      return;
    }
    setThinkingConversations((current) => {
      if ((current[conversationId] === true) === value) {
        return current;
      }
      return { ...current, [conversationId]: value };
    });
  }, []);

  const flushJsonSave = useCallback((key?: string) => {
    const entries = key
      ? Array.from(pendingJsonSavesRef.current.entries()).filter(([entryKey]) => entryKey === key)
      : Array.from(pendingJsonSavesRef.current.entries());

    for (const [entryKey, pending] of entries) {
      clearTimeout(pending.timeoutId);
      pendingJsonSavesRef.current.delete(entryKey);
      void saveJson(entryKey, pending.value);
    }
  }, []);

  const scheduleJsonSave = useCallback(<T,>(key: string, value: T, delayMs = JSON_SAVE_DEBOUNCE_MS) => {
    const previous = pendingJsonSavesRef.current.get(key);
    if (previous) {
      clearTimeout(previous.timeoutId);
    }

    const timeoutId = setTimeout(() => {
      const pending = pendingJsonSavesRef.current.get(key);
      if (!pending || pending.timeoutId !== timeoutId) {
        return;
      }
      pendingJsonSavesRef.current.delete(key);
      void saveJson(key, pending.value);
    }, delayMs);

    pendingJsonSavesRef.current.set(key, { timeoutId, value });
  }, []);

  const persistSessionCursors = useCallback(() => {
    const cursors = Object.fromEntries(sessionCursorsRef.current.entries());
    scheduleJsonSave(SESSION_CURSORS_STORAGE_KEY, cursors, SESSION_CURSOR_SAVE_DEBOUNCE_MS);
  }, [scheduleJsonSave]);

  const getSessionCursorSnapshot = useCallback(() => {
    return Object.fromEntries(sessionCursorsRef.current.entries());
  }, []);

  const closeSocket = useCallback((manual = true) => {
    if (manual) {
      manualDisconnectRef.current = true;
      setAutoConnectEnabled(false);
      setConnectionState('closed');
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (socketRef.current) {
      transportClientRef.current?.flushAcks?.();
      try {
        socketRef.current.close();
      } catch {
        // ignore
      }
      socketRef.current = null;
    }
    socketCryptoRef.current = null;
    transportClientRef.current?.detach();
    pendingServerEventsRef.current = [];
    if (pendingServerEventFrameRef.current !== null) {
      cancelAnimationFrame(pendingServerEventFrameRef.current);
      pendingServerEventFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      flushJsonSave();
      pendingServerEventsRef.current = [];
      if (pendingServerEventFrameRef.current !== null) {
        cancelAnimationFrame(pendingServerEventFrameRef.current);
        pendingServerEventFrameRef.current = null;
      }
    };
  }, [flushJsonSave]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        flushJsonSave();
      }
    });
    return () => subscription.remove();
  }, [flushJsonSave]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [
        storedSettings,
        storedWorkspaces,
        storedConversations,
        storedTimeline,
        storedActiveSelection,
        storedMentionHistory,
        storedSessionCursors,
        storedExperimentalFeatures,
        storedToken,
      ] = await Promise.all([
        loadJson<PersistedSettings | null>(SETTINGS_STORAGE_KEY, null),
        loadJson<WorkspaceRecord[]>(WORKSPACES_STORAGE_KEY, []),
        loadJson<ConversationRecord[]>(CONVERSATIONS_STORAGE_KEY, []),
        loadJson<TimelineEntry[]>(TIMELINE_STORAGE_KEY, []),
        loadJson<{ workspaceId?: string; conversationId?: string } | null>(ACTIVE_SELECTION_STORAGE_KEY, null),
        loadJson<WorkspaceMentionHistory[]>(MENTION_HISTORY_STORAGE_KEY, []),
        loadJson<Record<string, number>>(SESSION_CURSORS_STORAGE_KEY, {}),
        loadJson<Partial<ExperimentalFeatureSettings> | null>(EXPERIMENTAL_FEATURES_STORAGE_KEY, null),
        loadSecret(TOKEN_STORAGE_KEY),
      ]);

      if (!alive) {
        return;
      }

      const nextSettings = fromPersistedSettings(storedSettings, storedToken);
      const normalizedWorkspaces = storedWorkspaces.map((workspace) => ({
        ...workspace,
        reasoningEffort: normalizeReasoningEffort(workspace.reasoningEffort),
        threadId: '',
        localAdapterState: 'idle' as LocalAdapterState,
      }));
      const existingWorkspaceIds = new Set(normalizedWorkspaces.map((workspace) => workspace.id));
      const seenSessionIds = new Set<string>();
      const seenThreadIds = new Set<string>();
      const normalizedConversations =
        storedConversations.length > 0
          ? storedConversations
              .filter((conversation) => existingWorkspaceIds.has(conversation.workspaceId))
              .map((conversation) => {
                const workspace = normalizedWorkspaces.find((item) => item.id === conversation.workspaceId);
                const sessionSeed = workspace ? `${workspace.name}_${conversation.title}` : conversation.title;
                let sessionId = conversation.sessionId || createSessionId(sessionSeed);
                if (seenSessionIds.has(sessionId)) {
                  sessionId = createSessionId(sessionSeed);
                }
                seenSessionIds.add(sessionId);

                let threadId = normalizeThreadId(conversation.threadId);
                if (threadId && seenThreadIds.has(threadId)) {
                  threadId = '';
                }
                if (threadId) {
                  seenThreadIds.add(threadId);
                }

                return {
                  ...conversation,
                  sessionId,
                  threadId,
                  preview: conversation.preview || '',
                  nativeStatus: conversation.nativeStatus || '',
                  archived: conversation.archived === true,
                  localAdapterState: 'idle' as LocalAdapterState,
                  mode: (conversation.mode === 'plan' ? 'plan' : 'implement') as ConversationRecord['mode'],
                  goalStatus: conversation.goalStatus || '',
                  goalObjective: conversation.goalObjective || '',
                };
              })
          : normalizedWorkspaces.map((workspace) => createDefaultConversation(workspace));
      const storedConversation = normalizedConversations.find((conversation) => conversation.id === storedActiveSelection?.conversationId);
      const storedWorkspace = normalizedWorkspaces.find((workspace) => workspace.id === storedActiveSelection?.workspaceId);
      const firstWorkspaceId = storedConversation?.workspaceId ?? storedWorkspace?.id ?? normalizedWorkspaces[0]?.id ?? '';
      const firstConversationId =
        storedConversation?.id ?? normalizedConversations.find((conversation) => conversation.workspaceId === firstWorkspaceId)?.id ?? '';
      sessionCursorsRef.current = new Map(
        Object.entries(storedSessionCursors)
          .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0),
      );

      setSettings(nextSettings);
      setWorkspaces(normalizedWorkspaces);
      setConversations(normalizedConversations);
      setTimeline(storedTimeline.slice(0, MAX_TIMELINE_ITEMS));
      setMentionHistory(storedMentionHistory);
      setExperimentalFeatures(normalizeExperimentalFeatures(storedExperimentalFeatures));
      setActiveWorkspaceId(firstWorkspaceId);
      setActiveConversationId(firstConversationId);
      setAutoConnectEnabled(Boolean(storedSettings?.serverUrl?.trim()));
      setHydrated(true);
    })();

    return () => {
      alive = false;
      closeSocket(false);
    };
  }, [closeSocket]);

  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  useEffect(() => {
    activeConversationRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    void saveJson(SETTINGS_STORAGE_KEY, toPersistedSettings(settings));
    void saveSecret(TOKEN_STORAGE_KEY, settings.authToken);
  }, [hydrated, settings]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    void saveJson(WORKSPACES_STORAGE_KEY, workspaces);
  }, [hydrated, workspaces]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    void saveJson(CONVERSATIONS_STORAGE_KEY, conversations);
  }, [conversations, hydrated]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    scheduleJsonSave(TIMELINE_STORAGE_KEY, timeline.slice(0, MAX_TIMELINE_ITEMS));
  }, [hydrated, scheduleJsonSave, timeline]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    void saveJson(MENTION_HISTORY_STORAGE_KEY, mentionHistory);
  }, [hydrated, mentionHistory]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    void saveJson(EXPERIMENTAL_FEATURES_STORAGE_KEY, experimentalFeatures);
  }, [experimentalFeatures, hydrated]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    void saveJson(ACTIVE_SELECTION_STORAGE_KEY, {
      workspaceId: activeWorkspaceId,
      conversationId: activeConversationId,
    });
  }, [activeConversationId, activeWorkspaceId, hydrated]);

  const activeWorkspace = useMemo(
    () => workspaces.find((item) => item.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );

  const runtimeStatus = useMemo<RuntimeStatusState>(() => ({
    socket: connectionState,
    transport: transportStatus,
    daemon: connectionHealth.status,
    codexAdapter: activeConversation?.localAdapterState ?? activeWorkspace?.localAdapterState ?? 'unknown',
    turn: activeTurnId ? 'running' : 'idle',
  }), [activeConversation?.localAdapterState, activeTurnId, activeWorkspace?.localAdapterState, connectionHealth.status, connectionState, transportStatus]);

  const getConversationContext = useCallback((conversationId = activeConversationRef.current): ConversationContext | null => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId) ?? null;
    const workspace = conversation
      ? workspacesRef.current.find((item) => item.id === conversation.workspaceId) ?? null
      : null;
    return workspace && conversation ? { workspace, conversation } : null;
  }, []);

  const pendingRequests = useMemo<PendingRequest[]>(() => {
    const open = new Map<string, PendingRequest>();
    const resolved = new Set<string>();

    for (const event of events) {
      if (event.type === 'codex.serverRequest.resolved') {
        const data = eventPayloadData(event);
        const resolvedId = data.requestId ?? data.request_id;
        if (typeof resolvedId === 'string' && resolvedId) {
          resolved.add(resolvedId);
        }
      }

      const request = classifyPendingRequest(event);
      if (request) {
        open.set(request.requestId, request);
      }
    }

    return [...open.values()].filter((request) => !resolved.has(request.requestId));
  }, [events]);

  useEffect(() => {
    if (!pendingRequests.length) {
      setSelectedRequestId('');
      return;
    }
    if (!selectedRequestId || !pendingRequests.some((request) => request.requestId === selectedRequestId)) {
      setSelectedRequestId(pendingRequests[0].requestId);
    }
  }, [pendingRequests, selectedRequestId]);

  const selectedRequest = useMemo(
    () => pendingRequests.find((request) => request.requestId === selectedRequestId) ?? pendingRequests[0] ?? null,
    [pendingRequests, selectedRequestId],
  );

  const updateWorkspace = useCallback((id: string, patch: Partial<WorkspaceRecord>) => {
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === id ? { ...workspace, ...patch, updatedAt: Date.now() } : workspace,
      ),
    );
  }, []);

  const updateConversation = useCallback((id: string, patch: Partial<ConversationRecord>) => {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === id ? { ...conversation, ...patch, updatedAt: Date.now() } : conversation,
      ),
    );
  }, []);

  const upsertNativeThreads = useCallback((workspaceId: string, sessionId: string, threads: CodexNativeThread[]) => {
    if (!threads.length) {
      return;
    }
    setConversations((current) => {
      const next = [...current];
      for (const thread of threads) {
        const threadId = normalizeThreadId(thread.id);
        if (!threadId) {
          continue;
        }
        const existingIndex = next.findIndex(
          (conversation) =>
            conversation.workspaceId === workspaceId &&
            normalizeThreadId(conversation.threadId) === threadId,
        );
        const patch = conversationPatchFromNativeThread(thread);
        if (existingIndex >= 0) {
          next[existingIndex] = {
            ...next[existingIndex],
            ...patch,
            sessionId: next[existingIndex].sessionId || sessionId,
          };
          continue;
        }
        next.push({
          id: createRequestId('thread'),
          workspaceId,
          title: patch.title || threadId,
          preview: patch.preview || '',
          nativeStatus: patch.nativeStatus || '',
          archived: patch.archived === true,
          sessionId,
          threadId,
          localAdapterState: 'idle',
          mode: 'implement',
          goalStatus: '',
          goalObjective: '',
          createdAt: patch.createdAt || Date.now(),
          updatedAt: patch.updatedAt || Date.now(),
        });
      }
      return next.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }, []);

  const resetWorkspaceSession = useCallback(
    (workspace: WorkspaceRecord) => {
      updateWorkspace(workspace.id, {
        sessionId: createSessionId(workspace.name),
        localAdapterState: 'idle',
      });
    },
    [updateWorkspace],
  );

  const appendTimeline = useCallback((entry: TimelineEntry) => {
    setTimeline((current) => [entry, ...current].slice(0, MAX_TIMELINE_ITEMS));
  }, []);

  const rememberMentionReferences = useCallback((workspaceId: string, references: MentionReference[]) => {
    const files = references
      .filter((reference) => reference.kind === 'file')
      .map((reference) => reference.value.trim())
      .filter(Boolean);

    if (!files.length) {
      return;
    }

    setMentionHistory((current) => {
      const existing = current.find((item) => item.workspaceId === workspaceId);
      const merged = [...files, ...(existing?.files ?? [])]
        .filter((file, index, list) => list.findIndex((candidate) => candidate === file) === index)
        .slice(0, 20);
      const nextRecord: WorkspaceMentionHistory = {
        workspaceId,
        files: merged,
        updatedAt: Date.now(),
      };
      return [nextRecord, ...current.filter((item) => item.workspaceId !== workspaceId)].slice(0, 50);
    });
  }, []);

  const resolveTimelineTarget = useCallback((event: ServerEvent, data = eventPayloadData(event)) => {
    const sessionId = sessionIdFromEvent(event, data);
    const threadId = threadIdFromEventData(event, data);
    const conversations = conversationsRef.current;
    const byThread = threadId
      ? conversations.find((conversation) => normalizeThreadId(conversation.threadId) === threadId)
      : null;
    const bySession = sessionId ? conversations.find((conversation) => conversation.sessionId === sessionId) : null;
    if (sessionId && !bySession && !byThread) {
      return {
        workspaceId: '',
        conversationId: '',
        conversation: null,
        sessionId,
        threadId,
      };
    }
    const conversation = byThread ?? bySession ?? conversations.find((item) => item.id === activeConversationRef.current) ?? null;

    return {
      workspaceId: conversation?.workspaceId ?? activeWorkspaceRef.current,
      conversationId: conversation?.id ?? activeConversationRef.current,
      conversation,
      sessionId,
      threadId,
    };
  }, []);

  const upsertChatTimeline = useCallback((entry: TimelineEntry, appendSubtitle = false) => {
    setTimeline((current) => {
      const index = current.findIndex(
        (item) =>
          item.id === entry.id &&
          item.workspaceId === entry.workspaceId &&
          item.conversationId === entry.conversationId,
      );

      if (index === -1) {
        return [entry, ...current].slice(0, MAX_TIMELINE_ITEMS);
      }

      const next = current.slice();
      const previous = next[index];
      next[index] = {
        ...previous,
        ...entry,
        subtitle: appendSubtitle ? `${previous.subtitle === '正在回复...' ? '' : previous.subtitle}${entry.subtitle}` : entry.subtitle,
        at: Date.now(),
      };
      return next;
    });
  }, []);

  const settlePendingThreadStart = useCallback(
    (pending: PendingThreadStart, threadId: string, errorMessage = '') => {
      clearTimeout(pending.timeoutId);
      pendingThreadStartsRef.current.delete(pending.conversationId);

      if (errorMessage || !threadId) {
        const error = new Error(errorMessage || '创建 thread 失败');
        pending.reject(error);
        setLastError(error.message);
        return;
      }

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === pending.conversationId ? { ...conversation, threadId, updatedAt: Date.now() } : conversation,
        ),
      );
      pending.resolve(threadId);
    },
    [],
  );

  const finishPendingThreadList = useCallback((pending: PendingThreadList, errorMessage = '') => {
    clearTimeout(pending.timeoutId);
    pendingThreadListsRef.current.delete(pending.workspaceId);
    setThreadListStatusByWorkspace((current) => ({
      ...current,
      [pending.workspaceId]: errorMessage ? 'error' : 'ready',
    }));
    setThreadListErrorByWorkspace((current) => ({
      ...current,
      [pending.workspaceId]: errorMessage,
    }));
    if (errorMessage) {
      setLastError(errorMessage);
    }
  }, []);

  const finishPendingGitDiff = useCallback((pending: PendingGitDiff, errorMessage = '') => {
    clearTimeout(pending.timeoutId);
    pendingGitDiffsRef.current.delete(pending.requestId);
    if (!errorMessage) {
      setLastError('');
      return;
    }
    setGitDiffByConversation((current) => ({
      ...current,
      [pending.conversationId]: {
        ...(current[pending.conversationId] ?? {
          status: 'idle',
          diff: '',
          sha: '',
          error: '',
          updatedAt: 0,
        }),
        status: 'error',
        error: errorMessage,
        updatedAt: Date.now(),
      },
    }));
    setLastError(errorMessage);
  }, []);

  const finishPendingSkillList = useCallback((pending: PendingSkillList, errorMessage = '') => {
    clearTimeout(pending.timeoutId);
    pendingSkillListsRef.current.delete(pending.requestId);
    if (!errorMessage) {
      setLastError('');
      return;
    }
    setSkillListStatus('error');
    setSkillListError(errorMessage);
    setLastError(errorMessage);
  }, []);

  const finishPendingThreadAction = useCallback((pending: PendingThreadAction, errorMessage = '') => {
    clearTimeout(pending.timeoutId);
    pendingThreadActionsRef.current.delete(pending.requestId);
    if (errorMessage) {
      if (pending.action === 'fork' && pending.sourceConversationId && pending.conversationId !== pending.sourceConversationId) {
        setConversations((current) => current.filter((conversation) => conversation.id !== pending.conversationId));
      }
      setLastError(errorMessage);
      return;
    }
    setLastError('');
  }, []);

  const findPendingLocalStart = useCallback((event: ServerEvent, data: Record<string, unknown>) => {
    const pendingStarts = [...pendingLocalStartsRef.current.values()];
    const requestId = data.requestId ?? data.request_id;
    if (typeof requestId === 'string' && requestId) {
      const byRequestId = pendingStarts.find((item) => item.requestId === requestId);
      if (byRequestId) {
        return byRequestId;
      }
    }

    const sessionId =
      data.codexSessionId ??
      data.codex_session_id ??
      data.sessionId ??
      data.session_id ??
      event.codex_session_id;
    if (typeof sessionId === 'string' && sessionId) {
      return pendingStarts.find((item) => item.sessionId === sessionId) ?? null;
    }

    return pendingStarts.length === 1 ? pendingStarts[0] : null;
  }, []);

  const settlePendingLocalStart = useCallback(
    (pending: PendingLocalStart, errorMessage = '') => {
      clearTimeout(pending.timeoutId);
      pendingLocalStartsRef.current.delete(pending.conversationId);

      if (isLocalAdapterAlreadyRunning(errorMessage)) {
        updateConversation(pending.conversationId, { localAdapterState: 'running' });
        setLastError('');
        pending.resolve();
        return;
      }

      if (errorMessage) {
        updateConversation(pending.conversationId, { localAdapterState: 'error' });
        const error = new Error(localTurnErrorMessage(errorMessage));
        pending.reject(error);
        setLastError(error.message);
        appendTimeline(makeSystemEntry('本地会话启动失败', error.message, activeWorkspaceRef.current, activeConversationRef.current));
        return;
      }

      updateConversation(pending.conversationId, { localAdapterState: 'running' });
      pending.resolve();
    },
    [appendTimeline, updateConversation],
  );

  const appendEvent = useCallback(
    (event: ServerEvent) => {
      const data = eventPayloadData(event);
      const sessionId = sessionIdFromEvent(event, data);
      const cursor = cursorFromEvent(event);
      if (sessionId && cursor !== null) {
        const previousCursor = sessionCursorsRef.current.get(sessionId) ?? 0;
        if (cursor <= previousCursor) {
          return;
        }
        sessionCursorsRef.current.set(sessionId, cursor);
        transportClientRef.current?.ack(event);
        persistSessionCursors();
      }
      setEvents((current) => [event, ...current].slice(0, MAX_EVENTS));
      const target = resolveTimelineTarget(event, data);
      const targetConversationId = target.conversationId || target.conversation?.id || activeConversationRef.current;
      const goalPatch = goalPatchFromEventData(data);
      if (
        target.conversation &&
        goalPatch &&
        (
          /goal/i.test(event.type) ||
          data.method === 'thread/goal/set' ||
          data.method === 'thread/goal/get' ||
          data.method === 'thread/goal/clear'
        )
      ) {
        updateConversation(target.conversation.id, goalPatch);
      }
      const threadPatch = nativeThreadPatchFromNotification(event.type, data);
      const threadPatchId = threadPatch ? threadIdFromEventData(event, data) : '';
      if (threadPatch && threadPatchId) {
        const existing = conversationsRef.current.find((conversation) => normalizeThreadId(conversation.threadId) === threadPatchId);
        if (existing) {
          updateConversation(existing.id, threadPatch);
        }
      }
      const chatEntry = classifyChatEvent(event, target.workspaceId, target.conversationId);
      if (chatEntry) {
        upsertChatTimeline(chatEntry, event.type === 'codex.item.agentMessage.delta');
        if (event.type === 'codex.item.completed') {
          setConversationThinking(targetConversationId, false);
        }
      }
      const protocolError = extractProtocolError(event.type, data);
      const pendingLocalStartForError = event.type === 'codex.control.error'
        ? findPendingLocalStart(event, data)
        : null;
      const suppressProgressError =
        Boolean(pendingLocalStartForError) ||
        (protocolError ? isThreadNotMaterializedHistoryError(protocolError) : false);
      const progressEntry = classifyProgressEvent(event, target.workspaceId, target.conversationId);
      if (progressEntry && !suppressProgressError) {
        upsertChatTimeline(progressEntry, false);
      }
      if (event.type === 'codex.control.request.accepted' && data.operation === 'codex.local.turn') {
        setConversationThinking(targetConversationId, true);
      }
      const maybeModelListRequestId = data.requestId ?? data.request_id;
      const pendingModelList = pendingModelListRef.current;
      if (
        pendingModelList &&
        typeof maybeModelListRequestId === 'string' &&
        maybeModelListRequestId === pendingModelList.requestId
      ) {
        if (event.type === 'codex.control.response') {
          const models = parseCodexModelListResponse(data.result ?? data);
          if (models.length) {
            setRemoteModelCatalog(models);
            setModelCatalogStatus('ready');
            setModelCatalogError('');
          } else {
            setModelCatalogStatus('error');
            setModelCatalogError('model/list 没有返回可用模型');
          }
          clearTimeout(pendingModelList.timeoutId);
          pendingModelListRef.current = null;
        } else if (protocolError || event.type === 'codex.control.error') {
          setModelCatalogStatus('error');
          setModelCatalogError(localTurnErrorMessage(protocolError || 'model/list 请求失败'));
          clearTimeout(pendingModelList.timeoutId);
          pendingModelListRef.current = null;
        }
      }
      const maybeThreadRequestId = typeof maybeModelListRequestId === 'string' ? maybeModelListRequestId : '';
      const pendingGitDiff = maybeThreadRequestId ? pendingGitDiffsRef.current.get(maybeThreadRequestId) ?? null : null;
      if (pendingGitDiff) {
        if (event.type === 'codex.control.response') {
          const responseValue = data.result ?? data;
          const responseRecord = responseValue && typeof responseValue === 'object' && !Array.isArray(responseValue)
            ? responseValue as Record<string, unknown>
            : {};
          const diff = typeof responseRecord.diff === 'string' ? responseRecord.diff : '';
          const sha = typeof responseRecord.sha === 'string' ? responseRecord.sha : shortJson(responseRecord.sha ?? '');
          setGitDiffByConversation((current) => ({
            ...current,
            [pendingGitDiff.conversationId]: {
              status: 'ready',
              diff,
              sha,
              error: '',
              updatedAt: Date.now(),
            },
          }));
          appendTimeline(makeSystemEntry('Git diff loaded', diff ? `${diff.length} characters` : 'No diff', pendingGitDiff.workspaceId, pendingGitDiff.conversationId));
          finishPendingGitDiff(pendingGitDiff);
        } else if (protocolError || event.type === 'codex.control.error') {
          finishPendingGitDiff(pendingGitDiff, localTurnErrorMessage(protocolError || 'gitDiffToRemote 请求失败'));
        }
      }
      const pendingSkillList = maybeThreadRequestId ? pendingSkillListsRef.current.get(maybeThreadRequestId) ?? null : null;
      if (pendingSkillList) {
        if (event.type === 'codex.control.response') {
          const items = parseSkillListItems(data.result ?? data);
          setSkillListItems(items);
          setSkillListStatus('ready');
          setSkillListError('');
          appendTimeline(makeSystemEntry(
            'Skills loaded',
            items.length ? `${items.length} skills available` : 'No skills returned for this workspace',
            pendingSkillList.workspaceId,
            pendingSkillList.conversationId,
          ));
          finishPendingSkillList(pendingSkillList);
        } else if (protocolError || event.type === 'codex.control.error') {
          finishPendingSkillList(pendingSkillList, localTurnErrorMessage(protocolError || 'skills/list 请求失败'));
        }
      }
      const pendingThreadList = maybeThreadRequestId
        ? [...pendingThreadListsRef.current.values()].find((item) => item.requestId === maybeThreadRequestId)
        : null;
      if (pendingThreadList) {
        if (event.type === 'codex.control.response') {
          const threads = parseCodexNativeThreadListResponse(data.result ?? data);
          upsertNativeThreads(pendingThreadList.workspaceId, pendingThreadList.sessionId, threads);
          finishPendingThreadList(pendingThreadList);
        } else if (protocolError || event.type === 'codex.control.error') {
          finishPendingThreadList(pendingThreadList, localTurnErrorMessage(protocolError || 'thread/list 请求失败'));
        }
      }
      const pendingThreadAction = maybeThreadRequestId
        ? pendingThreadActionsRef.current.get(maybeThreadRequestId) ?? null
        : null;
      if (pendingThreadAction) {
        if (event.type === 'codex.control.response') {
          const responseValue = data.result ?? data;
          const nativeThread = parseCodexNativeThread(responseValue);
          const nativeThreadRead = pendingThreadAction.restoreHistory
            ? parseCodexNativeThreadReadResponse(responseValue)
            : null;
          const responseThread = resultThreadFromValue(responseValue);
          const displayThread = nativeThread || responseThread;
          if (nativeThread) {
            if (pendingThreadAction.action === 'fork') {
              const source = conversationsRef.current.find((item) => item.id === pendingThreadAction.sourceConversationId);
              setConversations((current) =>
                [
                  {
                    ...(source ?? {
                      id: pendingThreadAction.conversationId,
                      workspaceId: pendingThreadAction.workspaceId,
                      title: conversationTitleFromNativeThread(nativeThread),
                      sessionId: sessionIdFromEvent(event, data),
                      threadId: nativeThread.id,
                      localAdapterState: 'idle' as LocalAdapterState,
                      mode: 'implement' as ConversationRecord['mode'],
                      goalStatus: '',
                      goalObjective: '',
                      createdAt: nativeThread.createdAt || Date.now(),
                      updatedAt: nativeThread.updatedAt || Date.now(),
                    }),
                    id: pendingThreadAction.conversationId,
                    workspaceId: pendingThreadAction.workspaceId,
                    sessionId: source?.sessionId || sessionIdFromEvent(event, data),
                    localAdapterState: 'idle' as LocalAdapterState,
                    mode: source?.mode ?? 'implement',
                    goalStatus: '',
                    goalObjective: '',
                    ...conversationPatchFromNativeThread(nativeThread),
                  },
                  ...current.filter((conversation) => conversation.id !== pendingThreadAction.conversationId),
                ].sort((a, b) => b.updatedAt - a.updatedAt),
              );
              setActiveWorkspaceId(pendingThreadAction.workspaceId);
              setActiveConversationId(pendingThreadAction.conversationId);
            } else {
              upsertNativeThreads(
                pendingThreadAction.workspaceId,
                sessionIdFromEvent(event, data) || conversationsRef.current.find((item) => item.id === pendingThreadAction.conversationId)?.sessionId || '',
                [nativeThread],
              );
            }
          }
          if (nativeThreadRead) {
            if (nativeThreadRead.history.length > 0) {
              unmaterializedNativeThreadIdsRef.current.delete(nativeThreadRead.thread.id);
            }
            const restored = nativeThreadRead.history
              .map((entry) =>
                timelineEntryFromNativeHistoryEntry(
                  entry,
                  pendingThreadAction.workspaceId,
                  pendingThreadAction.conversationId,
                ),
              )
              .reverse();
            setTimeline((current) => {
              const remaining = current.filter((entry) => entry.conversationId !== pendingThreadAction.conversationId);
              return [...restored, ...remaining].slice(0, MAX_TIMELINE_ITEMS);
            });
            loadedNativeThreadHistoryRef.current.set(
              nativeThreadRead.thread.id,
              nativeThreadRead.thread.updatedAt,
            );
          }
          if (pendingThreadAction.action === 'archive') {
            updateConversation(pendingThreadAction.conversationId, { archived: true, nativeStatus: 'archived' });
          } else if (pendingThreadAction.action === 'unarchive') {
            updateConversation(pendingThreadAction.conversationId, { archived: false });
          } else if (pendingThreadAction.action === 'rename' && pendingThreadAction.title) {
            updateConversation(pendingThreadAction.conversationId, { title: pendingThreadAction.title });
          } else if (pendingThreadAction.action === 'unsubscribe') {
            updateConversation(pendingThreadAction.conversationId, { nativeStatus: 'unsubscribed' });
          } else if (pendingThreadAction.action === 'memory') {
            updateConversation(pendingThreadAction.conversationId, { nativeStatus: pendingThreadAction.resultDetail || 'memory updated' });
          }
          if (displayThread && displayThread !== nativeThread) {
            upsertNativeThreads(
              pendingThreadAction.workspaceId,
              sessionIdFromEvent(event, data) || conversationsRef.current.find((item) => item.id === pendingThreadAction.conversationId)?.sessionId || '',
              [displayThread],
            );
          }
          if (pendingThreadAction.showResult) {
            const title = pendingThreadAction.resultTitle || `${pendingThreadAction.action} result`;
            const detail = pendingThreadAction.resultDetail || formatThreadActionResult(pendingThreadAction, responseValue);
            setThreadInfoModal({
              title,
              detail,
              raw: responseValue,
            });
            appendTimeline(makeSystemEntry(title, detail.slice(0, 500), pendingThreadAction.workspaceId, pendingThreadAction.conversationId));
          }
          finishPendingThreadAction(pendingThreadAction);
        } else if (protocolError || event.type === 'codex.control.error') {
          if (pendingThreadAction.restoreHistory && protocolError && isThreadNotMaterializedHistoryError(protocolError)) {
            finishPendingThreadAction(pendingThreadAction);
          } else {
            finishPendingThreadAction(pendingThreadAction, localTurnErrorMessage(protocolError || `${pendingThreadAction.action} 请求失败`));
          }
        }
      }
      const turnId = turnIdFromEventData(data);
      const turnStatus = turnStatusFromEventData(data);
      const turnIsStarting = event.type === 'codex.turn.started' || /^inprogress$/i.test(turnStatus.replace(/[^a-z]/gi, ''));
      const turnIsTerminal = isTurnTerminalEvent(event) || /^(completed|interrupted|failed)$/i.test(turnStatus);
      if (turnIsTerminal) {
        setConversationTurnId(targetConversationId, '');
      } else if (turnId) {
        setConversationTurnId(targetConversationId, turnId);
      }
      if (turnIsStarting) {
        setConversationThinking(targetConversationId, true);
      }
      if (turnIsTerminal) {
        setConversationThinking(targetConversationId, false);
        const queuedDrafts = queuedChatDraftsRef.current[targetConversationId] ?? [];
        const nextQueuedDraft = queuedDrafts[0] ?? null;
        if (
          nextQueuedDraft &&
          (nextQueuedDraft.text.trim() || nextQueuedDraft.attachments.length > 0 || nextQueuedDraft.skills.length > 0) &&
          !queuedChatDispatchingRef.current.has(targetConversationId)
        ) {
          queuedChatDispatchingRef.current.add(targetConversationId);
          void (async () => {
            try {
              const sent = await sendQueuedChatDraftRef.current(nextQueuedDraft, targetConversationId);
              if (sent) {
                setQueuedChatDrafts((current) => {
                  const queue = current[targetConversationId] ?? [];
                  if (queue.length === 0 || queue[0]?.id !== nextQueuedDraft.id) {
                    return current;
                  }
                  const nextQueue = queue.slice(1);
                  if (nextQueue.length === 0) {
                    const { [targetConversationId]: _removed, ...rest } = current;
                    return rest;
                  }
                  return { ...current, [targetConversationId]: nextQueue };
                });
              }
            } finally {
              queuedChatDispatchingRef.current.delete(targetConversationId);
            }
          })();
        }
      }
      if (event.type === 'codex.control.stopped') {
        const sessionId = target.sessionId || sessionIdFromEvent(event, data);
        if (typeof sessionId === 'string') {
          const conversation = conversationsRef.current.find((item) => item.sessionId === sessionId);
          if (conversation) {
            updateConversation(conversation.id, { localAdapterState: 'stopped' });
          }
        }
      }
      if (event.type === 'codex.control.ready') {
        const pending = findPendingLocalStart(event, data);
        if (pending) {
          settlePendingLocalStart(pending);
        }
      } else if (event.type === 'codex.control.error') {
        const pending = pendingLocalStartForError ?? findPendingLocalStart(event, data);
        if (pending) {
          settlePendingLocalStart(pending, protocolError || '本地会话启动失败');
        }
      } else if (event.type === 'codex.serverRequest.resolved' && protocolError) {
        const pending = findPendingLocalStart(event, data);
        if (pending) {
          settlePendingLocalStart(pending, protocolError);
        }
      }
      const threadStartRequestId = data.requestId ?? data.request_id;
      if (typeof threadStartRequestId === 'string' && threadStartRequestId) {
        const pendingThread = [...pendingThreadStartsRef.current.values()].find((item) => item.requestId === threadStartRequestId);
        if (pendingThread) {
          const threadId = extractThreadIdFromEvent(event);
          if (protocolError || event.type === 'codex.control.request.rejected') {
            settlePendingThreadStart(pendingThread, '', localTurnErrorMessage(protocolError || '创建 thread 失败'));
          } else if (threadId) {
            settlePendingThreadStart(pendingThread, threadId);
          }
        }
      } else {
        const threadId = extractThreadIdFromEvent(event);
        if (threadId && pendingThreadStartsRef.current.size === 1) {
          const pendingThread = [...pendingThreadStartsRef.current.values()][0];
          settlePendingThreadStart(pendingThread, threadId);
        }
      }
      if (protocolError && isLocalAdapterFailed(protocolError)) {
        const sessionId = target.sessionId || sessionIdFromEvent(event, data);
        if (typeof sessionId === 'string') {
          const workspace = workspacesRef.current.find((item) => item.sessionId === sessionId);
          const conversation = conversationsRef.current.find((item) => item.sessionId === sessionId);
          if (conversation) {
            updateConversation(conversation.id, {
              sessionId: createSessionId(conversation.title),
              threadId: '',
              localAdapterState: 'idle',
            });
          } else if (workspace) {
            resetWorkspaceSession(workspace);
          }
        }
      }
      if (protocolError && isThreadNotFound(protocolError)) {
        const sessionId = target.sessionId || sessionIdFromEvent(event, data);
        const requestId = data.requestId ?? data.request_id;
        const conversation =
          typeof sessionId === 'string'
            ? conversationsRef.current.find((item) => item.sessionId === sessionId)
            : activeConversationRef.current
              ? conversationsRef.current.find((item) => item.id === activeConversationRef.current)
              : null;
        if (conversation) {
          updateConversation(conversation.id, { threadId: '' });
          appendTimeline(makeSystemEntry(
            '已重置失效 Thread',
            localTurnErrorMessage(protocolError),
            conversation.workspaceId,
            conversation.id,
          ));
        }
        if (typeof requestId === 'string') {
          const pendingThread = [...pendingThreadStartsRef.current.values()].find((item) => item.requestId === requestId);
          if (pendingThread) {
            settlePendingThreadStart(pendingThread, '', localTurnErrorMessage(protocolError));
          }
        }
        setConversationThinking(conversation?.id ?? targetConversationId, false);
      }
      if (protocolError && !isLocalAdapterAlreadyRunning(protocolError) && !isThreadNotMaterializedHistoryError(protocolError)) {
        setLastError(localTurnErrorMessage(protocolError));
      }
    },
    [appendTimeline, findPendingLocalStart, finishPendingGitDiff, finishPendingSkillList, finishPendingThreadAction, finishPendingThreadList, persistSessionCursors, resetWorkspaceSession, resolveTimelineTarget, settlePendingLocalStart, settlePendingThreadStart, setConversationThinking, setConversationTurnId, updateConversation, upsertChatTimeline, upsertNativeThreads],
  );

  const scheduleServerEventDrain = useCallback(() => {
    if (pendingServerEventFrameRef.current !== null) {
      return;
    }

    pendingServerEventFrameRef.current = requestAnimationFrame(() => {
      pendingServerEventFrameRef.current = null;
      const batch = pendingServerEventsRef.current.splice(0, SOCKET_EVENT_BATCH_SIZE);
      batch.forEach(appendEvent);

      if (pendingServerEventsRef.current.length > 0) {
        scheduleServerEventDrain();
      }
    });
  }, [appendEvent]);

  const enqueueServerEvent = useCallback((event: ServerEvent) => {
    pendingServerEventsRef.current.push(event);
    scheduleServerEventDrain();
  }, [scheduleServerEventDrain]);

  const pushSystem = useCallback(
    (title: string, subtitle = '') => {
      appendTimeline(makeSystemEntry(title, subtitle, activeWorkspaceRef.current, activeConversationRef.current));
    },
    [appendTimeline],
  );

  const refreshServerVersion = useCallback(async () => {
    try {
      const response = await fetch(buildHttpUrl(settings.serverUrl, '/v1/version'));
      if (!response.ok) {
        throw new Error(`version endpoint returned ${response.status}`);
      }
      const json = (await response.json()) as ServerVersion;
      setServerVersion(json);
    } catch (error) {
      setServerVersion(null);
      setLastError(error instanceof Error ? error.message : 'failed to fetch /v1/version');
    }
  }, [settings.serverUrl]);

  const checkConnectionHealth = useCallback(async () => {
    const probeId = healthProbeSeqRef.current + 1;
    healthProbeSeqRef.current = probeId;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONNECTION_HEALTH_TIMEOUT_MS);

    setConnectionHealth((current) => ({
      ...current,
      status: current.status === 'online' ? 'online' : 'checking',
      error: '',
    }));

    try {
      const response = await fetch(buildHttpUrl(settings.serverUrl, '/health'), {
        cache: 'no-store',
        signal: controller.signal,
      });
      const latencyMs = Date.now() - startedAt;
      if (healthProbeSeqRef.current !== probeId) {
        return;
      }
      if (!response.ok) {
        throw new Error(`health endpoint returned ${response.status}`);
      }
      setConnectionHealth({
        status: 'online',
        latencyMs,
        lastCheckedAt: Date.now(),
        error: '',
      });
    } catch (error) {
      if (healthProbeSeqRef.current !== probeId) {
        return;
      }
      const isAbort = error instanceof Error && error.name === 'AbortError';
      setConnectionHealth({
        status: 'offline',
        latencyMs: null,
        lastCheckedAt: Date.now(),
        error: isAbort ? '健康检查超时' : error instanceof Error ? error.message : '健康检查失败',
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }, [settings.serverUrl]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    setConnectionHealth(defaultConnectionHealth);
    void checkConnectionHealth();

    const intervalId = setInterval(() => {
      void checkConnectionHealth();
    }, CONNECTION_HEALTH_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [checkConnectionHealth, hydrated]);

  const connect = useCallback(() => {
    manualDisconnectRef.current = false;
    autoConnectAttemptedRef.current = true;
    setAutoConnectEnabled(true);
    closeSocket(false);
    setLastError('');
    setConnectionState('connecting');

    let crypto: TransportCryptoSession | null = null;
    try {
      crypto = createTransportCryptoSession(settings);
    } catch (error) {
      setConnectionState('error');
      setLastError(error instanceof Error ? error.message : '无法初始化加密连接');
      return;
    }

    const wsUrl = buildWebSocketUrl(settings.serverUrl, crypto?.queryString);
    const options = settings.authToken
      ? { headers: { Authorization: `Bearer ${settings.authToken}` } }
      : undefined;

    try {
      const socket = new (WebSocket as typeof WebSocket & {
        new (uri: string, protocols?: string | string[] | null, options?: { headers?: Record<string, string> }): WebSocket;
      })(wsUrl, undefined, options);
      socketRef.current = socket;
      socketCryptoRef.current = crypto;

      socket.onopen = () => {
        const transport = new TodeXTransportClient({
          loadSessionCursors: getSessionCursorSnapshot,
          onStatus: setTransportStatus,
        });
        transportClientRef.current = transport;
        transport.attach(socket, (text) => socketCryptoRef.current?.encryptClientText(text) ?? text);
        setConnectionState('open');
        void checkConnectionHealth();
        void refreshServerVersion();
      };

      socket.onmessage = (event) => {
        try {
          const text = socketCryptoRef.current?.decryptServerText(String(event.data)) ?? String(event.data);
          const transport = transportClientRef.current;
          const events = transport ? transport.decode(text) : [JSON.parse(text) as ServerEvent];
          events.forEach(enqueueServerEvent);
        } catch (error) {
          setLastError(error instanceof Error ? error.message : 'failed to parse websocket message');
        }
      };

      socket.onerror = () => {
        setConnectionState('error');
        setLastError('websocket error');
      };

      socket.onclose = () => {
        setConnectionState((current) => (current === 'open' || current === 'connecting' ? 'closed' : current));
        if (socketRef.current === socket) {
          socketCryptoRef.current = null;
          transportClientRef.current?.detach();
        }
      };
    } catch (error) {
      setConnectionState('error');
      socketCryptoRef.current = null;
      setLastError(error instanceof Error ? error.message : 'failed to connect');
    }
  }, [checkConnectionHealth, closeSocket, enqueueServerEvent, getSessionCursorSnapshot, pushSystem, refreshServerVersion, settings]);

  useEffect(() => {
    if (!hydrated || !autoConnectEnabled || manualDisconnectRef.current) {
      return;
    }
    if (connectionState !== 'closed' && connectionState !== 'error') {
      return;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (!manualDisconnectRef.current) {
        connect();
      }
    }, RECONNECT_DELAY_MS);
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [autoConnectEnabled, connect, connectionState, hydrated]);

  useEffect(() => {
    if (!hydrated || !autoConnectEnabled || autoConnectAttemptedRef.current) {
      return;
    }

    autoConnectAttemptedRef.current = true;
    connect();
  }, [autoConnectEnabled, connect, hydrated]);

  const sendProtocolMessage = useCallback(
    (
      type: string,
      payload: Record<string, unknown>,
      requestId = createRequestId('msg'),
      target?: TimelineTarget,
    ) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        setLastError('请先在设置里连接后端。');
        return false;
      }

      const message = transportClientRef.current?.send(type, payload, requestId);
      if (!message) {
        setLastError('请先在设置里连接后端。');
        return false;
      }
      if (type === 'codex.local.turn') {
        appendTimeline(makeOutgoingEntry(
          message,
          target?.workspaceId ?? activeWorkspaceRef.current,
          target?.conversationId ?? activeConversationRef.current,
        ));
      }
      return true;
    },
    [appendTimeline],
  );

  const requestModelCatalog = useCallback(() => {
    const sessionId =
      activeWorkspaceRef.current
        ? workspacesRef.current.find((workspace) => workspace.id === activeWorkspaceRef.current)?.sessionId
        : workspacesRef.current[0]?.sessionId;
    if (!sessionId) {
      setModelCatalogStatus('ready');
      return false;
    }
    const requestId = createRequestId('model-list');
    if (pendingModelListRef.current) {
      clearTimeout(pendingModelListRef.current.timeoutId);
    }
    const timeoutId = setTimeout(() => {
      if (pendingModelListRef.current?.requestId !== requestId) {
        return;
      }
      pendingModelListRef.current = null;
      setModelCatalogStatus('error');
      setModelCatalogError('model/list 请求超时，已保留内置模型列表');
    }, 8000);
    pendingModelListRef.current = { requestId, timeoutId };
    setModelCatalogStatus('loading');
    setModelCatalogError('');
    const sent = sendProtocolMessage('codex.local.request', {
      codexSessionId: sessionId,
      tenantId: settings.tenantId,
      method: 'model/list',
      params: {
        limit: 50,
        includeHidden: false,
      },
    }, requestId);
    if (!sent) {
      clearTimeout(timeoutId);
      pendingModelListRef.current = null;
      setModelCatalogStatus('error');
      setModelCatalogError('请先连接后端后再刷新模型列表');
      return false;
    }
    return true;
  }, [sendProtocolMessage, settings.tenantId]);

  const createWorkspace = useCallback(
    (nameDraft: string, pathDraft: string) => {
      const path = pathDraft.trim();
      if (!path) {
        Alert.alert('缺少目录', '请输入要管理的目录路径。');
        return null;
      }

      const name = nameDraft.trim() || displayNameFromPath(path);
      const id = createRequestId('workspace');
      const sessionId = createSessionId(name);
      const threadId = '';
      const nextWorkspace: WorkspaceRecord = {
        id,
        name,
        path,
        sessionId,
        tenantId: settings.tenantId,
        threadId,
        model: settings.defaultModel,
        reasoningEffort: null,
        approvalPolicy: settings.approvalPolicy,
        sandboxMode: settings.sandboxMode,
        serviceTier: null,
        localAdapterState: 'idle',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const nextConversation = createDefaultConversation(nextWorkspace);
      const normalizedConversation = {
        ...nextConversation,
        sessionId,
      };

      setWorkspaces((current) => [nextWorkspace, ...current]);
      setConversations((current) => [normalizedConversation, ...current]);
      setActiveWorkspaceId(id);
      setActiveConversationId(normalizedConversation.id);
      pushSystem('已添加目录', nextWorkspace.path);
      return { workspace: nextWorkspace, conversation: normalizedConversation };
    },
    [
      pushSystem,
      settings.approvalPolicy,
      settings.defaultModel,
      settings.defaultReasoningEffort,
      settings.sandboxMode,
      settings.tenantId,
    ],
  );

  const selectWorkspace = useCallback((workspaceId: string) => {
    setActiveWorkspaceId(workspaceId);
    const conversation = conversations.find((item) => item.workspaceId === workspaceId);
    setActiveConversationId(conversation?.id ?? '');
    setLastError('');
  }, [conversations]);

  const selectConversation = useCallback((workspaceId: string, conversationId: string) => {
    setActiveWorkspaceId(workspaceId);
    setActiveConversationId(conversationId);
    setLastError('');
  }, []);

  const removeWorkspace = useCallback(
    (workspaceId: string) => {
      const removedConversationIds = conversations
        .filter((conversation) => conversation.workspaceId === workspaceId)
        .map((conversation) => conversation.id);
      setWorkspaces((current) => current.filter((workspace) => workspace.id !== workspaceId));
      setConversations((current) => current.filter((conversation) => conversation.workspaceId !== workspaceId));
      setTimeline((current) => current.filter((entry) => entry.workspaceId !== workspaceId && !removedConversationIds.includes(entry.conversationId ?? '')));
      const pruneConversationState = <T,>(current: Record<string, T>) => {
        const next = { ...current };
        removedConversationIds.forEach((id) => {
          delete next[id];
        });
        return next;
      };
      setChatDrafts(pruneConversationState);
      setQueuedChatDrafts(pruneConversationState);
      setComposerSelections(pruneConversationState);
      setComposerAttachments(pruneConversationState);
      setSelectedSkills(pruneConversationState);
      setTurnIds(pruneConversationState);
      setThinkingConversations(pruneConversationState);
      if (activeWorkspaceId === workspaceId) {
        const next = workspaces.find((workspace) => workspace.id !== workspaceId);
        setActiveWorkspaceId(next?.id ?? '');
        setActiveConversationId(conversations.find((conversation) => conversation.workspaceId === next?.id)?.id ?? '');
      }
    },
    [activeWorkspaceId, conversations, workspaces],
  );

  const renameWorkspace = useCallback((workspaceId: string, name: string) => {
    const nextName = name.trim();
    if (!nextName) {
      Alert.alert('名称不能为空', '请输入新的工作区名称。');
      return;
    }
    updateWorkspace(workspaceId, { name: nextName });
  }, [updateWorkspace]);

  const forkWorkspace = useCallback((workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      Alert.alert('未找到工作区', '请返回后重新选择工作区。');
      return null;
    }

    const now = Date.now();
    const nextWorkspace: WorkspaceRecord = {
      ...workspace,
      id: createRequestId('workspace'),
      name: `${workspace.name} fork`,
      sessionId: createSessionId(`${workspace.name}_fork`),
      threadId: '',
      localAdapterState: 'idle',
      createdAt: now,
      updatedAt: now,
    };
    const sourceConversations = conversations.filter((conversation) => conversation.workspaceId === workspaceId);
    const nextConversations = sourceConversations.length > 0
      ? sourceConversations.map((conversation) => ({
          ...forkConversationRecord(conversation),
          workspaceId: nextWorkspace.id,
        }))
      : [createDefaultConversation(nextWorkspace)];

    setWorkspaces((current) => [nextWorkspace, ...current]);
    setConversations((current) => [...nextConversations, ...current]);
    setActiveWorkspaceId(nextWorkspace.id);
    setActiveConversationId(nextConversations[0]?.id ?? '');
    return { workspace: nextWorkspace, conversation: nextConversations[0] ?? null };
  }, [conversations, workspaces]);

  const sendWorkspaceCommand = useCallback(
    (workspace: WorkspaceRecord, type: string, extra: Record<string, unknown> = {}, conversation?: ConversationRecord | null) => {
      const sessionId = conversation ? sessionIdForConversation(workspace, conversation) : workspace.sessionId;
      const payload = {
        codexSessionId: sessionId,
        tenantId: workspace.tenantId,
        ...extra,
      };
      return sendProtocolMessage(type, payload);
    },
    [sendProtocolMessage],
  );

  const attachWorkspaceConversation = useCallback((workspace: WorkspaceRecord, conversation: ConversationRecord) => {
    const sessionId = sessionIdForConversation(workspace, conversation);
    const afterCursor = sessionCursorsRef.current.get(sessionId) ?? null;
    return sendWorkspaceCommand(workspace, 'codex.local.attach', {
      afterCursor,
      replayLimit: CHAT_ATTACH_REPLAY_LIMIT,
    }, conversation);
  }, [sendWorkspaceCommand]);

  const sendLocalMethodRequest = useCallback((
    workspace: WorkspaceRecord,
    conversation: ConversationRecord,
    method: string,
    params: Record<string, unknown> | null,
    requestId = createRequestId('local-method'),
  ) => {
    return sendProtocolMessage('codex.local.request', {
      codexSessionId: sessionIdForConversation(workspace, conversation),
      tenantId: workspace.tenantId,
      method,
      params,
    }, requestId, {
      workspaceId: workspace.id,
      conversationId: conversation.id,
    });
  }, [sendProtocolMessage]);

  const startLocalAdapter = useCallback(
    (workspace: WorkspaceRecord, conversation: ConversationRecord) => {
      const sessionId = sessionIdForConversation(workspace, conversation);
      const currentState = localConversationStateOf(conversation);
      const existingPending = pendingLocalStartsRef.current.get(conversation.id);

      if (currentState === 'running' && !existingPending) {
        return Promise.resolve(true);
      }

      if (existingPending) {
        return existingPending.promise.then(() => true);
      }

      return new Promise<boolean>((resolve, reject) => {
        const requestId = createRequestId('local-start');
        let settleResolve: () => void = () => {};
        let settleReject: (reason: Error) => void = () => {};
        const promise = new Promise<void>((innerResolve, innerReject) => {
          settleResolve = innerResolve;
          settleReject = innerReject;
        });
        const timeoutId = setTimeout(() => {
          pendingLocalStartsRef.current.delete(conversation.id);
          updateConversation(conversation.id, { localAdapterState: 'error' });
          const error = new Error('本地会话启动超时，请先确认 Codex 本地 adapter 可用。');
          setLastError(error.message);
          pushSystem('本地会话启动超时', error.message);
          settleReject(error);
          reject(error);
        }, 15000);

        pendingLocalStartsRef.current.set(conversation.id, {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          sessionId,
          requestId,
          promise,
          resolve: () => {
            settleResolve();
            resolve(true);
          },
          reject: (reason) => {
            settleReject(reason);
            reject(reason);
          },
          timeoutId,
        });

        updateConversation(conversation.id, { sessionId, localAdapterState: 'starting' });

        const sent = sendProtocolMessage('codex.local.start', {
          codexSessionId: sessionId,
          tenantId: workspace.tenantId,
          cwd: workspace.path,
          model: workspace.model || settings.defaultModel || undefined,
          approvalPolicy: workspace.approvalPolicy,
          sandboxMode: workspace.sandboxMode,
          configOverrides: {
            reasoningEffort: workspace.reasoningEffort || settings.defaultReasoningEffort || undefined,
          },
        }, requestId);

        if (!sent) {
          clearTimeout(timeoutId);
          pendingLocalStartsRef.current.delete(conversation.id);
          updateConversation(conversation.id, { localAdapterState: 'error' });
          const error = new Error('请先在设置里连接后端。');
          reject(error);
        }
      });
    },
    [pushSystem, sendProtocolMessage, settings.defaultModel, settings.defaultReasoningEffort, updateConversation],
  );

  const ensureThreadId = useCallback(
    (workspace: WorkspaceRecord, conversation: ConversationRecord, forceNewThread = false) => {
      const sessionId = sessionIdForConversation(workspace, conversation);
      const currentThreadId = normalizeThreadId(conversation.threadId);
      if (!forceNewThread && currentThreadId) {
        return Promise.resolve(currentThreadId);
      }
      if (forceNewThread) {
        setConversations((current) =>
          current.map((item) =>
            item.id === conversation.id ? { ...item, threadId: '', updatedAt: Date.now() } : item,
          ),
        );
      }

      const existingPending = pendingThreadStartsRef.current.get(conversation.id);
      if (existingPending) {
        return existingPending.promise;
      }

      return new Promise<string>((resolve, reject) => {
        const requestId = createRequestId('thread-start');
        let settleResolve: (threadId: string) => void = () => {};
        let settleReject: (reason: Error) => void = () => {};
        const promise = new Promise<string>((innerResolve, innerReject) => {
          settleResolve = innerResolve;
          settleReject = innerReject;
        });
        const timeoutId = setTimeout(() => {
          pendingThreadStartsRef.current.delete(conversation.id);
          const error = new Error('创建 thread 超时，请稍后重试。');
          setLastError(error.message);
          settleReject(error);
          reject(error);
        }, 15000);

        pendingThreadStartsRef.current.set(conversation.id, {
          conversationId: conversation.id,
          requestId,
          promise,
          resolve: (threadId) => {
            settleResolve(threadId);
            resolve(threadId);
          },
          reject: (reason) => {
            settleReject(reason);
            reject(reason);
          },
          timeoutId,
        });

        const sent = sendProtocolMessage('codex.local.request', {
          codexSessionId: sessionId,
          tenantId: workspace.tenantId,
          method: 'thread/start',
          params: {
            cwd: workspace.path,
            model: workspace.model || settings.defaultModel || undefined,
            reasoningEffort: workspace.reasoningEffort || settings.defaultReasoningEffort || undefined,
            approvalPolicy: workspace.approvalPolicy || settings.approvalPolicy || undefined,
            sandbox: workspace.sandboxMode || settings.sandboxMode || undefined,
            serviceTier: workspace.serviceTier || undefined,
          },
        }, requestId);

        if (!sent) {
          clearTimeout(timeoutId);
          pendingThreadStartsRef.current.delete(conversation.id);
          const error = new Error('请先在设置里连接后端。');
          settleReject(error);
          reject(error);
        }
      });
    },
    [sendProtocolMessage, settings.approvalPolicy, settings.defaultModel, settings.defaultReasoningEffort, settings.sandboxMode],
  );

  const requestNativeThreadList = useCallback(async (workspaceId: string, includeArchived = false) => {
    const workspace = workspacesRef.current.find((item) => item.id === workspaceId);
    const conversation =
      conversationsRef.current.find((item) => item.workspaceId === workspaceId) ??
      (workspace ? createDefaultConversation(workspace) : null);
    if (!workspace || !conversation) {
      setLastError('未找到工作区，无法刷新 Codex threads。');
      return false;
    }
    try {
      await startLocalAdapter(workspace, conversation);
    } catch (error) {
      setLastError(error instanceof Error ? localTurnErrorMessage(error.message) : '本地会话未启动');
      return false;
    }
    const existing = pendingThreadListsRef.current.get(workspaceId);
    if (existing) {
      clearTimeout(existing.timeoutId);
    }
    const requestId = createRequestId('thread-list');
    const sessionId = sessionIdForConversation(workspace, conversation);
    const timeoutId = setTimeout(() => {
      const pending = pendingThreadListsRef.current.get(workspaceId);
      if (pending?.requestId !== requestId) {
        return;
      }
      finishPendingThreadList(pending, 'thread/list 请求超时');
    }, 10000);
    pendingThreadListsRef.current.set(workspaceId, {
      workspaceId,
      sessionId,
      requestId,
      timeoutId,
    });
    setThreadListStatusByWorkspace((current) => ({ ...current, [workspaceId]: 'loading' }));
    setThreadListErrorByWorkspace((current) => ({ ...current, [workspaceId]: '' }));
    const sent = sendLocalMethodRequest(workspace, conversation, 'thread/list', {
      cwd: workspace.path,
      archived: includeArchived ? true : false,
      limit: 100,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      sourceKinds: ['cli', 'vscode', 'appServer'],
    }, requestId);
    if (!sent) {
      finishPendingThreadList(pendingThreadListsRef.current.get(workspaceId)!, '请先在设置里连接后端。');
      return false;
    }
    return true;
  }, [finishPendingThreadList, sendLocalMethodRequest, startLocalAdapter]);

  const sendNativeThreadAction = useCallback(async (
    conversationId: string,
    action: PendingThreadAction['action'],
    method: string,
    paramsBuilder: (threadId: string, workspace: WorkspaceRecord, conversation: ConversationRecord) => Record<string, unknown>,
    options: {
      title?: string;
      selectResult?: boolean;
      resultConversationId?: string;
      restoreHistory?: boolean;
      showResult?: boolean;
      resultTitle?: string;
      resultDetail?: string;
    } = {},
  ) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      Alert.alert('未选择对话', '请先选择一个 Codex thread。');
      return false;
    }
    const { workspace, conversation } = context;
    try {
      await startLocalAdapter(workspace, conversation);
    } catch (error) {
      setLastError(error instanceof Error ? localTurnErrorMessage(error.message) : '本地会话未启动');
      return false;
    }
    const threadId = normalizeThreadId(conversation.threadId);
    if (!threadId) {
      setLastError('当前记录还没有原生 thread id。');
      return false;
    }
    const requestId = createRequestId(`thread-${action}`);
    const timeoutId = setTimeout(() => {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (!pending) {
        return;
      }
      finishPendingThreadAction(pending, `${method} 请求超时`);
    }, 10000);
    pendingThreadActionsRef.current.set(requestId, {
      workspaceId: workspace.id,
      conversationId: options.resultConversationId ?? (options.selectResult && action === 'fork' ? createRequestId('thread') : conversation.id),
      requestId,
      action,
      timeoutId,
      sourceConversationId: conversation.id,
      title: options.title,
      restoreHistory: options.restoreHistory,
      showResult: options.showResult,
      resultTitle: options.resultTitle,
      resultDetail: options.resultDetail,
    });
    const sent = sendLocalMethodRequest(workspace, conversation, method, paramsBuilder(threadId, workspace, conversation), requestId);
    if (!sent) {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (pending) {
        finishPendingThreadAction(pending, '请先在设置里连接后端。');
      }
      return false;
    }
    return true;
  }, [finishPendingThreadAction, getConversationContext, sendLocalMethodRequest, startLocalAdapter]);

  const sendTrackedLocalMethod = useCallback(async (
    conversationId: string,
    action: PendingThreadAction['action'],
    method: string,
    params: Record<string, unknown> | null | undefined,
    title: string,
    detail = '',
  ) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      Alert.alert('未选择对话', '请先选择一个 Codex thread。');
      return false;
    }
    const { workspace, conversation } = context;
    try {
      await startLocalAdapter(workspace, conversation);
    } catch (error) {
      setLastError(error instanceof Error ? localTurnErrorMessage(error.message) : '本地会话未启动');
      return false;
    }
    const requestId = createRequestId(`thread-${action}`);
    const timeoutId = setTimeout(() => {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (!pending) {
        return;
      }
      finishPendingThreadAction(pending, `${method} 请求超时`);
    }, 10000);
    pendingThreadActionsRef.current.set(requestId, {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      requestId,
      action,
      timeoutId,
      sourceConversationId: conversation.id,
      showResult: true,
      resultTitle: title,
      resultDetail: detail,
    });
    const sent = sendLocalMethodRequest(workspace, conversation, method, params === undefined ? {} : params, requestId);
    if (!sent) {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (pending) {
        finishPendingThreadAction(pending, '请先在设置里连接后端。');
      }
      return false;
    }
    return true;
  }, [finishPendingThreadAction, getConversationContext, sendLocalMethodRequest, startLocalAdapter]);

  const requestGitDiff = useCallback(async (conversationId = activeConversationRef.current) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      Alert.alert('未选择对话', '请先选择一个 Codex 对话。');
      return false;
    }
    const { workspace, conversation } = context;
    setGitDiffByConversation((current) => ({
      ...current,
      [conversation.id]: {
        ...(current[conversation.id] ?? {
          status: 'idle',
          diff: '',
          sha: '',
          error: '',
          updatedAt: 0,
        }),
        status: 'loading',
        error: '',
      },
    }));
    try {
      await startLocalAdapter(workspace, conversation);
    } catch (error) {
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : '本地会话未启动';
      setGitDiffByConversation((current) => ({
        ...current,
        [conversation.id]: {
          ...(current[conversation.id] ?? {
            status: 'idle',
            diff: '',
            sha: '',
            error: '',
            updatedAt: 0,
          }),
          status: 'error',
          error: message,
          updatedAt: Date.now(),
        },
      }));
      setLastError(message);
      return false;
    }
    const requestId = createRequestId('git-diff');
    const timeoutId = setTimeout(() => {
      const pending = pendingGitDiffsRef.current.get(requestId);
      if (pending) {
        finishPendingGitDiff(pending, 'gitDiffToRemote 请求超时');
      }
    }, 15000);
    pendingGitDiffsRef.current.set(requestId, {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      requestId,
      timeoutId,
    });
    const sent = sendLocalMethodRequest(workspace, conversation, 'gitDiffToRemote', { cwd: workspace.path }, requestId);
    if (!sent) {
      const pending = pendingGitDiffsRef.current.get(requestId);
      if (pending) {
        finishPendingGitDiff(pending, '请先在设置里连接后端。');
      }
      return false;
    }
    return true;
  }, [finishPendingGitDiff, getConversationContext, sendLocalMethodRequest, startLocalAdapter]);

  const openGitDiff = useCallback((conversationId = activeConversationRef.current) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      Alert.alert('未选择对话', '请先选择一个 Codex 对话。');
      return;
    }
    navigationRef.current?.navigate('GitDiff', {
      workspaceId: context.workspace.id,
      conversationId: context.conversation.id,
    });
    void requestGitDiff(context.conversation.id);
  }, [getConversationContext, requestGitDiff]);

  const requestSkillList = useCallback(async (conversationId = activeConversationRef.current, forceReload = false) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      Alert.alert('未选择对话', '请先选择一个 Codex 对话。');
      return false;
    }
    const { workspace, conversation } = context;
    setSkillListConversationId(conversation.id);
    setSkillListVisible(true);
    setSkillListStatus('loading');
    setSkillListError('');
    try {
      await startLocalAdapter(workspace, conversation);
    } catch (error) {
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : '本地会话未启动';
      setSkillListStatus('error');
      setSkillListError(message);
      setLastError(message);
      return false;
    }
    const requestId = createRequestId('skills');
    const timeoutId = setTimeout(() => {
      const pending = pendingSkillListsRef.current.get(requestId);
      if (pending) {
        finishPendingSkillList(pending, 'skills/list 请求超时');
      }
    }, 15000);
    pendingSkillListsRef.current.set(requestId, {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      requestId,
      timeoutId,
    });
    const sent = sendLocalMethodRequest(workspace, conversation, 'skills/list', {
      cwds: [workspace.path],
      forceReload,
    }, requestId);
    if (!sent) {
      const pending = pendingSkillListsRef.current.get(requestId);
      if (pending) {
        finishPendingSkillList(pending, '请先在设置里连接后端。');
      }
      return false;
    }
    return true;
  }, [finishPendingSkillList, getConversationContext, sendLocalMethodRequest, startLocalAdapter]);

  const openExperimentalFeatures = useCallback((conversationId = activeConversationRef.current) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      Alert.alert('未选择对话', '请先选择一个 Codex 对话。');
      return;
    }
    navigationRef.current?.navigate('Experimental', {
      workspaceId: context.workspace.id,
      conversationId: context.conversation.id,
    });
  }, [getConversationContext]);

  const loadNativeThreadHistory = useCallback((conversationId: string, force = false) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      return false;
    }
    const threadId = normalizeThreadId(context.conversation.threadId);
    if (!threadId) {
      return false;
    }
    const loadedAt = loadedNativeThreadHistoryRef.current.get(threadId) ?? 0;
    if (!force && loadedAt >= context.conversation.updatedAt) {
      return true;
    }
    if (!force && unmaterializedNativeThreadIdsRef.current.has(threadId)) {
      return true;
    }
    void sendNativeThreadAction(
      conversationId,
      'read',
      'thread/read',
      (currentThreadId) => ({ threadId: currentThreadId, includeTurns: true }),
      { restoreHistory: true },
    );
    return true;
  }, [getConversationContext, sendNativeThreadAction]);

  const createConversation = useCallback((workspaceId: string) => {
    const workspace = workspacesRef.current.find((item) => item.id === workspaceId);
    if (!workspace) {
      Alert.alert('未找到工作区', '请返回后重新选择工作区。');
      return null;
    }

    const nextConversation = createDefaultConversation(workspace);
    setConversations((current) => [nextConversation, ...current]);
    setActiveWorkspaceId(workspace.id);
    setActiveConversationId(nextConversation.id);
    appendTimeline(makeSystemEntry('New native thread', '正在通过 Codex 原生 thread/start 创建新对话。', workspace.id, nextConversation.id));

    void (async () => {
      try {
        await startLocalAdapter(workspace, nextConversation);
        const threadId = await ensureThreadId(workspace, nextConversation, true);
        unmaterializedNativeThreadIdsRef.current.add(threadId);
        void requestNativeThreadList(workspace.id).catch(() => undefined);
      } catch (error) {
        const message = error instanceof Error ? localTurnErrorMessage(error.message) : '创建原生 thread 失败';
        setLastError(message);
      }
    })();

    return nextConversation;
  }, [appendTimeline, ensureThreadId, requestNativeThreadList, startLocalAdapter]);

  const renameConversation = useCallback((conversationId: string, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      Alert.alert('名称不能为空', '请输入新的对话标题。');
      return;
    }
    const context = getConversationContext(conversationId);
    if (!context) {
      Alert.alert('未选择对话', '请先选择一个 Codex thread。');
      return;
    }
    updateConversation(conversationId, { title: nextTitle });
    void sendNativeThreadAction(
      conversationId,
      'rename',
      'thread/name/set',
      (threadId) => ({ threadId, name: nextTitle }),
      { title: nextTitle },
    );
  }, [getConversationContext, sendNativeThreadAction, updateConversation]);

  const forkConversation = useCallback((conversationId: string) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      Alert.alert('未选择对话', '请先选择一个 Codex thread。');
      return null;
    }
    const { workspace, conversation } = context;
    const threadId = normalizeThreadId(conversation.threadId);
    if (!threadId) {
      setLastError('当前记录还没有可 fork 的原生 thread。');
      return null;
    }

    const nextConversation = {
      ...forkConversationRecord(conversation),
      workspaceId: workspace.id,
      sessionId: sessionIdForConversation(workspace, conversation),
      title: `${conversation.title || 'Thread'} fork`,
    };
    setConversations((current) => [nextConversation, ...current]);
    setActiveWorkspaceId(workspace.id);
    setActiveConversationId(nextConversation.id);
    void sendNativeThreadAction(
      conversation.id,
      'fork',
      'thread/fork',
      (sourceThreadId) => ({
        threadId: sourceThreadId,
        cwd: workspace.path,
        model: workspace.model || settings.defaultModel || undefined,
        approvalPolicy: workspace.approvalPolicy || settings.approvalPolicy || undefined,
        sandbox: workspace.sandboxMode || settings.sandboxMode || undefined,
      }),
      { selectResult: true, resultConversationId: nextConversation.id },
    );
    return nextConversation;
  }, [getConversationContext, sendNativeThreadAction, settings.approvalPolicy, settings.defaultModel, settings.sandboxMode]);

  const removeConversation = useCallback((conversationId: string) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      return;
    }
    const { workspace, conversation } = context;
    const nextActive = conversationsRef.current.find(
      (item) => item.workspaceId === workspace.id && item.id !== conversationId && item.archived !== true,
    );
    updateConversation(conversationId, { archived: true, nativeStatus: 'archived' });
    setChatDrafts((current) => {
      const { [conversationId]: _removed, ...rest } = current;
      return rest;
    });
    setQueuedChatDrafts((current) => {
      const { [conversationId]: _removed, ...rest } = current;
      return rest;
    });
    setComposerSelections((current) => {
      const { [conversationId]: _removed, ...rest } = current;
      return rest;
    });
    setComposerAttachments((current) => {
      const { [conversationId]: _removed, ...rest } = current;
      return rest;
    });
    setSelectedSkills((current) => {
      const { [conversationId]: _removed, ...rest } = current;
      return rest;
    });
    setTurnIds((current) => {
      const { [conversationId]: _removed, ...rest } = current;
      return rest;
    });
    setThinkingConversations((current) => {
      const { [conversationId]: _removed, ...rest } = current;
      return rest;
    });
    if (activeConversationRef.current === conversationId) {
      setActiveConversationId(nextActive?.id ?? '');
    }
    if (normalizeThreadId(conversation.threadId)) {
      void sendNativeThreadAction(conversationId, 'archive', 'thread/archive', (threadId) => ({ threadId }));
    }
  }, [getConversationContext, sendNativeThreadAction, updateConversation]);

  const sendLocalTurn = useCallback(
    async (
      text: string,
      mode: ConversationRecord['mode'] = 'implement',
      conversationId = activeConversationRef.current,
      attachments: ComposerAttachmentDraft[] = [],
      skills: SelectedSkillAttachment[] = [],
    ) => {
      const context = getConversationContext(conversationId);
      if (!context) {
        Alert.alert('未选择对话', '请先选择工作区和对话。');
        return false;
      }

      const { workspace, conversation } = context;
      const sessionId = sessionIdForConversation(workspace, conversation);
      const commandWorkspace = commandWorkspaceForConversation(workspace, conversation);
      const conversationThreadId = normalizeThreadId(conversation.threadId);
      try {
        await startLocalAdapter(workspace, conversation);
      } catch (error) {
        const message = error instanceof Error ? error.message : '本地会话未启动';
        setLastError(localTurnErrorMessage(message));
        return false;
      }

      let threadId = '';
      try {
        threadId = await ensureThreadId(workspace, conversation, !conversationThreadId);
      } catch (error) {
        const message = error instanceof Error ? error.message : '创建 thread 失败';
        setLastError(message);
        return false;
      }

      setConversationThinking(conversation.id, true);
      appendTimeline(makeSystemEntry('正在思考', '请求已发出，等待 Codex 返回中间步骤...', workspace.id, conversation.id));

      const payload = {
        codexSessionId: sessionId,
        tenantId: workspace.tenantId,
        threadId,
        input: codexInputFromComposer(text, attachments, skills),
        approvalPolicy: workspace.approvalPolicy || settings.approvalPolicy || undefined,
        sandboxPolicy: sandboxPolicyForMode(workspace.sandboxMode || settings.sandboxMode),
        serviceTier: workspace.serviceTier || undefined,
        collaborationMode: {
          mode: 'default',
          settings: {
            model: workspace.model || settings.defaultModel,
            reasoningEffort: workspace.reasoningEffort || settings.defaultReasoningEffort || undefined,
            developerInstructions: null,
          },
        },
      };

      if (sendProtocolMessage('codex.local.turn', payload, createRequestId('msg'), {
        workspaceId: workspace.id,
        conversationId: conversation.id,
      })) {
        unmaterializedNativeThreadIdsRef.current.delete(threadId);
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === context.conversation.id
              ? {
                  ...conversation,
                  sessionId: commandWorkspace.sessionId,
                  threadId,
                  mode,
                  title: conversation.title === '默认对话' ? text.slice(0, 18) || attachmentPrompt(attachments).slice(0, 18) || selectedSkillSummary(skills).slice(0, 18) || conversation.title : conversation.title,
                  updatedAt: Date.now(),
                }
              : conversation,
          ),
        );
        return true;
      }

      setConversationThinking(conversation.id, false);
      return false;
    },
    [appendTimeline, ensureThreadId, getConversationContext, sendProtocolMessage, setConversationThinking, settings.approvalPolicy, settings.defaultModel, settings.defaultReasoningEffort, settings.sandboxMode, startLocalAdapter],
  );

  useEffect(() => {
    sendQueuedChatDraftRef.current = (submission, conversationId) =>
      sendLocalTurn(submission.text, 'implement', conversationId, submission.attachments, submission.skills);
  }, [sendLocalTurn]);

  const toggleSelectedSkill = useCallback((conversationId: string, skill: SkillListItem) => {
    if (!skill.enabled) {
      Alert.alert('Skill 已禁用', '该 Skill 当前未启用，不能添加到下一条消息。');
      return;
    }
    const nextSkill: SelectedSkillAttachment = {
      name: skill.name,
      path: skill.path,
      displayName: skill.displayName,
    };
    setConversationSelectedSkills(conversationId, (current) => {
      const exists = current.some((item) => item.name === skill.name && item.path === skill.path);
      if (exists) {
        return current.filter((item) => item.name !== skill.name || item.path !== skill.path);
      }
      return [...current, nextSkill];
    });
  }, [setConversationSelectedSkills]);

  const sendApprovalResponse = useCallback(
    (accepted: boolean, request: PendingRequest) => {
      const data = eventPayloadData(request.event);
      const requestSessionId = sessionIdFromEvent(request.event, data);
      const conversation = requestSessionId
        ? conversationsRef.current.find((item) => item.sessionId === requestSessionId) ?? null
        : null;
      const workspace = conversation
        ? workspacesRef.current.find((item) => item.id === conversation.workspaceId) ?? null
        : null;

      if (!requestSessionId || !workspace || !conversation) {
        Alert.alert('未选择工作区', '请先选择一个工作区。');
        return false;
      }
      return sendProtocolMessage('codex.local.approval.respond', {
        codexSessionId: requestSessionId,
        tenantId: workspace.tenantId,
        requestId: request.requestId,
        responseType: inferApprovalResponseType(request.requestType),
        response: approvalResponsePayload(request, accepted),
      }, createRequestId('msg'), {
        workspaceId: workspace.id,
        conversationId: conversation.id,
      });
    },
    [sendProtocolMessage],
  );

  const applyPermissionPreset = useCallback(
    (preset: PermissionPreset) => {
      if (!activeWorkspace || !activeConversation) {
        Alert.alert('未选择工作区', '请先选择一个工作区。');
        return;
      }
      updateWorkspace(activeWorkspace.id, {
        approvalPolicy: preset.approvalPolicy,
        sandboxMode: preset.sandboxMode,
      });
      appendTimeline(makeSystemEntry(
        `Permissions updated to ${preset.title}`,
        preset.description,
        activeWorkspace.id,
        activeConversation.id,
      ));
    },
    [activeConversation, activeWorkspace, appendTimeline, updateWorkspace],
  );

  const openPermissionsMenu = useCallback(() => {
    Alert.alert(
      'Update Model Permissions',
      '选择 Codex 可以执行的操作范围。',
      PERMISSION_PRESETS.map((preset) => ({
        text: preset.title,
        onPress: () => applyPermissionPreset(preset),
      })),
    );
  }, [applyPermissionPreset]);

  const openModelPicker = useCallback((conversationId = activeConversationRef.current) => {
    setModelPickerPrompt({
      target: 'workspace',
      conversationId,
    });
    if (connectionState === 'open' && modelCatalogStatus !== 'loading') {
      requestModelCatalog();
    }
  }, [connectionState, modelCatalogStatus, requestModelCatalog]);

  const applyModelCommand = useCallback(
    (conversationId: string, args: string[], promptWhenEmpty = true) => {
      const context = getConversationContext(conversationId);
      if (!context) {
        Alert.alert('未选择工作区', '请先选择一个工作区。');
        return;
      }

      const { workspace, conversation } = context;
      const { model, reasoningEffort, invalidReasoningEffort } = parseModelCommandArgs(args);
      if (invalidReasoningEffort) {
        Alert.alert(
          '无效思考强度',
          '支持 none、minimal、low、medium、high、xhigh，也支持 max 作为 xhigh 的别名。',
        );
        return;
      }

      if (!model && !reasoningEffort) {
        if (promptWhenEmpty) {
          setModelCommandPrompt({
            conversationId: conversation.id,
            initialValue: modelCommandInitialValue(workspace, settings),
          });
        } else {
          Alert.alert('Model', '请输入模型名或思考强度，例如 gpt-5.5 high。');
        }
        return;
      }

      const nextModel = model || workspace.model || settings.defaultModel;
      const nextReasoningEffort = reasoningEffort ?? normalizeReasoningEffort(workspace.reasoningEffort ?? settings.defaultReasoningEffort);
      updateWorkspace(workspace.id, {
        ...(model ? { model: nextModel } : {}),
        ...(reasoningEffort ? { reasoningEffort: nextReasoningEffort } : {}),
      });

      const detail = [
        `Model: ${nextModel || '未设置'}`,
        `Reasoning: ${nextReasoningEffort || '默认'}`,
      ].join('\n');
      appendTimeline(makeSystemEntry(
        'Model settings updated',
        `${detail}\n后续新 thread 和 turn 会把这些参数发送给 Codex app-server。`,
        workspace.id,
        conversation.id,
      ));
    },
    [appendTimeline, getConversationContext, settings, updateWorkspace],
  );

  const applyWorkspaceModelSelection = useCallback(
    (conversationId: string, model: string, reasoningEffort: string | null) => {
      const context = getConversationContext(conversationId);
      if (!context) {
        Alert.alert('未选择工作区', '请先选择一个工作区。');
        return;
      }
      const nextModel = model.trim();
      if (!nextModel) {
        Alert.alert('缺少模型', '请选择或输入模型名。');
        return;
      }
      const nextReasoningEffort = normalizeReasoningEffort(reasoningEffort) ?? defaultReasoningForModel(nextModel, modelCatalog);
      updateWorkspace(context.workspace.id, {
        model: nextModel,
        reasoningEffort: nextReasoningEffort,
      });
      appendTimeline(makeSystemEntry(
        'Model settings updated',
        [
          `Model: ${nextModel}`,
          `Reasoning: ${reasoningEffortLabel(nextReasoningEffort)}`,
          '后续新 thread 和 turn 会把这些参数发送给 Codex app-server。',
        ].join('\n'),
        context.workspace.id,
        context.conversation.id,
      ));
    },
    [appendTimeline, getConversationContext, modelCatalog, updateWorkspace],
  );

  const applyDefaultModelSelection = useCallback(
    (model: string, reasoningEffort: string | null) => {
      const nextModel = model.trim();
      if (!nextModel) {
        return;
      }
      const nextReasoningEffort = normalizeReasoningEffort(reasoningEffort) ?? defaultReasoningForModel(nextModel, modelCatalog);
      setSettings((current) => ({
        ...current,
        defaultModel: nextModel,
        defaultReasoningEffort: nextReasoningEffort,
      }));
    },
    [modelCatalog],
  );

  const openThreadCommandPrompt = useCallback((conversationId: string, command: ThreadCommandPromptState['command']) => {
    if (command === 'metadata') {
      setThreadCommandPrompt({
        conversationId,
        command,
        title: 'Thread metadata',
        placeholder: 'branch main sha abc123 origin https://...',
        initialValue: '',
      });
      return;
    }
    if (command === 'memory') {
      setThreadCommandPrompt({
        conversationId,
        command,
        title: 'Thread memory',
        placeholder: 'on / off / reset',
        initialValue: '',
        warning: 'reset 会清空 Codex 本地 memory，作用域不是单个 thread。',
      });
      return;
    }
    if (command === 'shell') {
      setThreadCommandPrompt({
        conversationId,
        command,
        title: 'Thread shell command',
        placeholder: 'pwd && git status --short',
        initialValue: '',
        warning: '该命令会按 Codex app-server 语义以 unsandboxed full access 运行。',
        multiline: true,
      });
      return;
    }
    if (command === 'items') {
      setThreadCommandPrompt({
        conversationId,
        command,
        title: 'Turn items',
        placeholder: 'turn_id',
        initialValue: turnIds[conversationId] || '',
      });
      return;
    }
    if (command === 'inject') {
      setThreadCommandPrompt({
        conversationId,
        command,
        title: 'Inject raw items',
        placeholder: '[{"type":"message","role":"user","content":[{"type":"input_text","text":"note"}]}]',
        initialValue: '[]',
        warning: '会直接追加 Responses API items 到 thread 历史。请只粘贴可信 JSON 数组。',
        multiline: true,
      });
      return;
    }
    setThreadCommandPrompt({
      conversationId,
      command,
      title: 'Approve denied action',
      placeholder: '{"event":{...}}',
      initialValue: '',
      warning: '需要粘贴 guardian denied action 的原始事件 JSON。',
      multiline: true,
    });
  }, [turnIds]);

  const sendSlashCommand = useCallback(
    (input: string, conversationId = activeConversationRef.current) => {
      const trimmed = input.trim();
      if (!trimmed.startsWith('/')) {
        sendLocalTurn(trimmed, 'implement', conversationId);
        return;
      }

      const [command, ...rest] = trimmed.slice(1).trim().split(/\s+/);
      const lower = command.toLowerCase();
      const context = getConversationContext(conversationId);

      if (!context) {
        Alert.alert('未选择工作区', '请先选择一个工作区。');
        return;
      }

      const { workspace, conversation } = context;
      const addCommandNotice = (title: string, detail: string) => {
        appendTimeline(makeSystemEntry(title, detail, workspace.id, conversation.id));
      };

      const sendLocalMethod = (method: string, params: Record<string, unknown>, title: string, detail: string) => {
        if (sendWorkspaceCommand(workspace, 'codex.local.request', { method, params }, conversation)) {
          addCommandNotice(title, detail);
        }
      };

      const sendThreadMethod = (method: string, makeParams: (threadId: string) => Record<string, unknown>, title: string, detail: string) => {
        void (async () => {
          try {
            await startLocalAdapter(workspace, conversation);
            const threadId = await ensureThreadId(workspace, conversation, !normalizeThreadId(conversation.threadId));
            sendLocalMethod(method, makeParams(threadId), title, detail);
          } catch (error) {
            const message = error instanceof Error ? error.message : `${title} 失败`;
            setLastError(message);
          }
        })();
      };

      if (lower === 'permissions') {
        const presetName = rest[0]?.toLowerCase() ?? '';
        const preset = PERMISSION_PRESETS.find((candidate) => candidate.id === presetName || candidate.title.toLowerCase() === presetName);
        if (preset) {
          updateWorkspace(workspace.id, {
            approvalPolicy: preset.approvalPolicy,
            sandboxMode: preset.sandboxMode,
          });
          addCommandNotice(`Permissions updated to ${preset.title}`, preset.description);
          return;
        }
        openPermissionsMenu();
        return;
      }

      if (lower === 'model') {
        if (rest.length) {
          applyModelCommand(conversation.id, rest);
        } else {
          openModelPicker(conversation.id);
        }
        return;
      }

      if (lower === 'approve' || lower === 'approval') {
        if (/^(guardian|denied|override)$/i.test(rest[0] ?? '')) {
          openThreadCommandPrompt(conversation.id, 'guardian');
          return;
        }
        const deny = /^(deny|decline|reject|no)$/i.test(rest[0] ?? '');
        const requestId = rest[1] || selectedRequest?.requestId || '';
        const target = pendingRequests.find((request) => request.requestId === requestId) ?? selectedRequest;
        if (!target) {
          Alert.alert('没有待处理请求', '当前没有可回复的审批或问题。');
          return;
        }
        sendApprovalResponse(!deny, target);
        return;
      }

      if (lower === 'skills') {
        void requestSkillList(conversation.id, /reload|refresh|true|1/i.test(rest[0] ?? ''));
        return;
      }

      if (lower === 'hooks') {
        sendLocalMethod('hooks/list', { cwds: [workspace.path] }, 'Hooks requested', '已请求 Codex app-server 列出当前工作区 hooks。');
        return;
      }

      if (lower === 'plugins') {
        sendLocalMethod('plugin/list', { cwds: [workspace.path], extraUserRoots: [] }, 'Plugins requested', '已请求 Codex app-server 列出插件。');
        return;
      }

      if (lower === 'apps') {
        sendLocalMethod('app/list', { limit: 50, forceRefetch: /reload|refresh|true|1/i.test(rest[0] ?? '') }, 'Apps requested', '已请求 Codex app-server 列出 apps。');
        return;
      }

      if (lower === 'mcp') {
        sendWorkspaceCommand(workspace, 'codex.mcp.server.listStatus', {}, conversation);
        addCommandNotice('MCP status requested', rest[0] === 'verbose' ? '已请求 MCP server 状态；详细事件会在时间线中返回。' : '已请求 MCP server 状态。');
        return;
      }

      if (lower === 'compact') {
        sendThreadMethod('thread/compact/start', (threadId) => ({ threadId }), 'Compact started', '已请求 Codex app-server 压缩当前 thread 上下文。');
        return;
      }

      if (lower === 'goal') {
        const subcommand = rest[0]?.toLowerCase() ?? '';
        if (subcommand === 'pause' || subcommand === 'resume') {
          const status = subcommand === 'pause' ? 'paused' : 'active';
          updateConversation(conversation.id, {
            goalStatus: status,
          });
          sendThreadMethod(
            'thread/goal/set',
            (threadId) => ({ threadId, status }),
            'Goal command sent',
            `已发送 thread/goal/set status=${status}。`,
          );
          return;
        }
        const objective = subcommand === 'set' ? rest.slice(1).join(' ').trim() : rest.join(' ').trim();
        const method = subcommand === 'clear' ? 'thread/goal/clear' : objective ? 'thread/goal/set' : 'thread/goal/get';
        if (method === 'thread/goal/set') {
          updateConversation(conversation.id, {
            goalStatus: 'active',
            goalObjective: objective,
          });
        } else if (method === 'thread/goal/clear') {
          updateConversation(conversation.id, {
            goalStatus: '',
            goalObjective: '',
          });
        }
        sendThreadMethod(
          method,
          (threadId) => (method === 'thread/goal/set' ? { threadId, objective } : { threadId }),
          'Goal command sent',
          `已发送 ${method}。`,
        );
        return;
      }

      if (lower === 'rename') {
        const nextTitle = rest.join(' ').trim();
        if (!nextTitle) {
          Alert.alert('Rename', '请输入新的对话标题。');
          return;
        }
        updateConversation(conversation.id, { title: nextTitle });
        if (conversation.threadId) {
          sendLocalMethod('thread/name/set', { threadId: conversation.threadId, name: nextTitle }, 'Thread rename sent', nextTitle);
        } else {
          addCommandNotice('Conversation renamed', nextTitle);
        }
        return;
      }

      if (lower === 'logout') {
        sendLocalMethod('account/logout', {}, 'Logout requested', '已请求 Codex app-server 登出当前账号。');
        return;
      }

      if (lower === 'start') {
        void startLocalAdapter(workspace, conversation).catch(() => undefined);
        return;
      }

      if (lower === 'status') {
        const statusScope = rest[0]?.toLowerCase() ?? '';
        if (/^(thread|detail)$/i.test(statusScope)) {
          void sendNativeThreadAction(conversation.id, 'detail', 'thread/read', (threadId) => ({ threadId, includeTurns: false }), {
            showResult: true,
            resultTitle: 'Thread details',
          });
          return;
        }
        if (/^(history|read)$/i.test(statusScope)) {
          void sendNativeThreadAction(conversation.id, 'read', 'thread/read', (threadId) => ({ threadId, includeTurns: true }), {
            restoreHistory: true,
            showResult: true,
            resultTitle: 'Thread history',
          });
          return;
        }
        if (/^(turns|turn)$/i.test(statusScope)) {
          void sendNativeThreadAction(conversation.id, 'turns', 'thread/turns/list', (threadId) => ({
            threadId,
            limit: parsePositiveLimit(rest[1], 20),
            sortDirection: 'desc',
            itemsView: 'summary',
          }), {
            showResult: true,
            resultTitle: 'Thread turns',
          });
          return;
        }
        if (/^(items|item)$/i.test(statusScope)) {
          if (rest[1]) {
            void sendNativeThreadAction(conversation.id, 'items', 'thread/turns/items/list', (threadId) => ({
              threadId,
              turnId: rest[1],
              limit: parsePositiveLimit(rest[2], 50),
              sortDirection: 'asc',
            }), {
              showResult: true,
              resultTitle: 'Turn items',
            });
          } else {
            openThreadCommandPrompt(conversation.id, 'items');
          }
          return;
        }
        if (/^(loaded|loaded-threads)$/i.test(statusScope)) {
          void sendTrackedLocalMethod(conversation.id, 'loaded', 'thread/loaded/list', { limit: parsePositiveLimit(rest[1], 100) }, 'Loaded threads');
          return;
        }
        sendWorkspaceCommand(workspace, 'codex.local.status', {}, conversation);
        return;
      }

      if (lower === 'stop') {
        if (conversation.threadId) {
          sendLocalMethod('thread/backgroundTerminals/clean', { threadId: conversation.threadId }, 'Background terminals clean requested', '已请求 Codex 清理后台终端。');
        }
        if (sendWorkspaceCommand(workspace, 'codex.local.stop', { force: false }, conversation)) {
          const pending = pendingLocalStartsRef.current.get(conversation.id);
          if (pending) {
            clearTimeout(pending.timeoutId);
            pendingLocalStartsRef.current.delete(conversation.id);
            pending.reject(new Error('本地会话已停止'));
          }
          updateConversation(conversation.id, { localAdapterState: 'stopped' });
        }
        return;
      }

      if (lower === 'clean') {
        void sendNativeThreadAction(conversation.id, 'clean', 'thread/backgroundTerminals/clean', (threadId) => ({ threadId }), {
          showResult: true,
          resultTitle: 'Background terminals clean',
        });
        if (sendWorkspaceCommand(workspace, 'codex.local.stop', { force: false }, conversation)) {
          updateConversation(conversation.id, { localAdapterState: 'stopped' });
        }
        return;
      }

      if (lower === 'clear' || lower === 'new') {
        const nextConversation = createConversation(workspace.id);
        if (nextConversation) {
          selectConversation(workspace.id, nextConversation.id);
        }
        return;
      }

      if (lower === 'resume') {
        if (!normalizeThreadId(conversation.threadId)) {
          setLastError('当前记录还没有可 resume 的原生 thread。');
          return;
        }
        void sendNativeThreadAction(
          conversation.id,
          'resume',
          'thread/resume',
          (threadId) => ({ threadId }),
          { restoreHistory: true },
        );
        return;
      }

      if (lower === 'fork' || lower === 'side') {
        void sendNativeThreadAction(
          conversation.id,
          'fork',
          'thread/fork',
          (threadId) => ({
            threadId,
            cwd: workspace.path,
            model: workspace.model || settings.defaultModel || undefined,
            approvalPolicy: workspace.approvalPolicy || settings.approvalPolicy || undefined,
            sandbox: workspace.sandboxMode || settings.sandboxMode || undefined,
            ephemeral: lower === 'side',
          }),
          { selectResult: true },
        );
        addCommandNotice('Thread fork sent', lower === 'side' ? '已请求创建临时 side thread。' : '已请求 fork 当前原生 thread。');
        return;
      }

      if (lower === 'mention') {
        setConversationChatDraft(conversation.id, '@');
        setConversationComposerSelection(conversation.id, { start: 1, end: 1 });
        return;
      }

      if (lower === 'attach') {
        attachWorkspaceConversation(workspace, conversation);
        return;
      }

      if (lower === 'replay') {
        sendWorkspaceCommand(workspace, 'codex.local.replay', {
          afterCursor: null,
          limit: 200,
        }, conversation);
        return;
      }

      if (lower === 'interrupt') {
        const threadId = normalizeThreadId(conversation.threadId);
        if (!threadId) {
          setLastError('当前对话还没有可中断的 thread。');
          return;
        }
        sendWorkspaceCommand(workspace, 'codex.local.interrupt', {
          threadId,
          turnId: turnIds[conversation.id] || '',
        }, conversation);
        return;
      }

      if (lower === 'review') {
        const instructions = rest.join(' ').trim();
        sendThreadMethod(
          'review/start',
          (threadId) => ({
            threadId,
            target: instructions ? { type: 'custom', instructions } : { type: 'uncommittedChanges' },
            delivery: 'inline',
          }),
          'Review started',
          instructions || 'Review uncommitted changes.',
        );
        return;
      }

      if (lower === 'init') {
        sendLocalTurn('create or update an AGENTS.md file with concise project instructions for Codex', 'implement', conversation.id);
        return;
      }

      if (lower === 'plan') {
        sendLocalTurn(rest.length > 0 ? `make a plan for: ${rest.join(' ')}` : 'switch into planning mode and create a concise implementation plan', 'plan', conversation.id);
        return;
      }

      if (lower === 'diff') {
        openGitDiff(conversation.id);
        return;
      }

      if (lower === 'experimental') {
        openExperimentalFeatures(conversation.id);
        return;
      }

      if (lower === 'ps') {
        if (/^(clean|clear|stop)$/i.test(rest[0] ?? '')) {
          void sendNativeThreadAction(conversation.id, 'clean', 'thread/backgroundTerminals/clean', (threadId) => ({ threadId }), {
            showResult: true,
            resultTitle: 'Background terminals clean',
          });
          return;
        }
        void sendTrackedLocalMethod(conversation.id, 'loaded', 'thread/loaded/list', { limit: 100 }, 'Loaded threads');
        return;
      }

      if (lower === 'rollout') {
        addCommandNotice('Rollout', '移动端不会直接读取 Codex 本地 rollout 路径；后端事件会在时间线中显示。');
        return;
      }

      if (lower === 'agent' || lower === 'subagents') {
        addCommandNotice(`/${lower} recognized`, '移动端以工作区和对话列表管理会话；该命令已识别，等价操作请使用当前导航中的对话入口。');
        return;
      }

      if (lower === 'copy' || lower === 'raw') {
        addCommandNotice(`/${lower} recognized`, '移动端使用系统选择和复制；该命令已识别但不需要发送到后端。');
        return;
      }

      if (lower === 'ide' || lower === 'keymap' || lower === 'vim' || lower === 'theme' || lower === 'title' || lower === 'statusline' || lower === 'pets' || lower === 'pet') {
        addCommandNotice(`/${lower} recognized`, '这是 TUI/IDE 展示配置命令；移动端已识别，但当前没有等价 app-server 执行动作。');
        return;
      }

      if (
        lower === 'setup-default-sandbox' ||
        lower === 'sandbox-add-read-dir' ||
        lower === 'personality' ||
        lower === 'realtime' ||
        lower === 'settings' ||
        lower === 'debug-config' ||
        lower === 'feedback' ||
        lower === 'debug-m-drop' ||
        lower === 'debug-m-update'
      ) {
        addCommandNotice(`/${lower} recognized`, '该命令已加入移动端命令集；当前移动端没有安全的直接执行协议，未作为普通 prompt 发送。');
        return;
      }

      if (lower === 'memories') {
        if (rest.length) {
          const mode = parseThreadMemoryMode(rest.join(' '));
          if (mode === 'reset') {
            void sendTrackedLocalMethod(conversation.id, 'memoryReset', 'memory/reset', null, 'Memory reset');
            return;
          }
          if (mode) {
            void sendNativeThreadAction(conversation.id, 'memory', 'thread/memoryMode/set', (threadId) => ({ threadId, mode }), {
              showResult: true,
              resultTitle: 'Thread memory',
              resultDetail: `memory mode: ${mode}`,
            });
            return;
          }
        }
        openThreadCommandPrompt(conversation.id, 'memory');
        return;
      }

      if (lower === 'test-approval') {
        sendLocalTurn('trigger a harmless approval test if the current Codex environment supports it', 'implement', conversation.id);
        return;
      }

      if (lower === 'quit' || lower === 'exit') {
        if (sendWorkspaceCommand(workspace, 'codex.local.stop', { force: false }, conversation)) {
          updateConversation(conversation.id, { localAdapterState: 'stopped' });
          addCommandNotice(`/${lower} recognized`, '已停止当前本地 Codex 会话；移动端应用不会退出。');
        }
        return;
      }

      addCommandNotice(`/${lower} recognized`, '该命令不在当前内置命令清单中，已阻止作为普通 prompt 发送。');
    },
    [
      applyModelCommand,
      appendTimeline,
      createConversation,
      ensureThreadId,
      getConversationContext,
      openModelPicker,
      openExperimentalFeatures,
      openPermissionsMenu,
      openThreadCommandPrompt,
      pendingRequests,
      requestSkillList,
      selectConversation,
      selectedRequest,
      sendApprovalResponse,
      sendLocalTurn,
      sendNativeThreadAction,
      requestGitDiff,
      openGitDiff,
      sendTrackedLocalMethod,
      startLocalAdapter,
      sendWorkspaceCommand,
      attachWorkspaceConversation,
      settings,
      setConversationChatDraft,
      setConversationComposerSelection,
      setLastError,
      turnIds,
      updateConversation,
      updateWorkspace,
    ],
  );

  const stopThinking = useCallback((conversationId: string) => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId) ?? null;
    const workspace = conversation
      ? workspacesRef.current.find((item) => item.id === conversation.workspaceId) ?? null
      : null;
    if (!workspace || !conversation) {
      Alert.alert('未选择工作区', '请先选择一个工作区。');
      return;
    }
    const threadId = normalizeThreadId(conversation.threadId);
    if (!threadId) {
      setLastError('当前还没有可中断的 thread。');
      return;
    }
    if (sendWorkspaceCommand(workspace, 'codex.local.interrupt', { threadId, turnId: turnIds[conversationId] || '' }, conversation)) {
      appendTimeline(makeSystemEntry('已发送停止', '正在请求 Codex 中断当前思考。', workspace.id, conversation.id));
    }
  }, [appendTimeline, sendWorkspaceCommand, turnIds]);

  const submitChat = useCallback((conversationId: string) => {
    const text = (chatDrafts[conversationId] ?? '').trim();
    const attachments = composerAttachments[conversationId] ?? [];
    const skills = selectedSkills[conversationId] ?? [];
    if (!text && attachments.length === 0 && skills.length === 0) {
      return;
    }
    const context = getConversationContext(conversationId);
    if (!context) {
      Alert.alert('未选择工作区', '请先选择一个工作区。');
      return;
    }
    const { workspace } = context;
    const isThinking = thinkingConversations[conversationId] === true;
    const mentionReferences = parseMentionReferences(text);
    if (mentionReferences.length > 0) {
      rememberMentionReferences(workspace.id, mentionReferences);
      const mentionSummary = summarizeMentionReferences(mentionReferences);
      if (mentionSummary) {
        appendTimeline(makeSystemEntry('已引用文件', mentionSummary, workspace.id, conversationId));
      }
    }
    if (attachments.length > 0) {
      appendTimeline(makeSystemEntry('已附加附件', attachmentSummary(attachments), workspace.id, conversationId));
    }
    if (skills.length > 0) {
      appendTimeline(makeSystemEntry('已选择 Skill', selectedSkillSummary(skills), workspace.id, conversationId));
    }
    setConversationChatDraft(conversationId, '');
    setConversationComposerSelection(conversationId, DEFAULT_COMPOSER_SELECTION);
    setConversationAttachments(conversationId, []);
    setConversationSelectedSkills(conversationId, []);
    if (isThinking) {
      setQueuedChatDrafts((current) => ({
        ...current,
        [conversationId]: [
          ...(current[conversationId] ?? []),
          {
            id: createRequestId('queued'),
            text,
            attachments,
            skills,
          },
        ],
      }));
      appendTimeline(makeSystemEntry('消息已加入候选', '当前任务完成后会自动继续发送。', workspace.id, conversationId));
      return;
    }
    if (attachments.length > 0 || skills.length > 0) {
      void sendLocalTurn(text, 'implement', conversationId, attachments, skills);
      return;
    }
    sendSlashCommand(text, conversationId);
  }, [appendTimeline, chatDrafts, composerAttachments, getConversationContext, rememberMentionReferences, selectedSkills, sendLocalTurn, sendSlashCommand, setConversationAttachments, setConversationChatDraft, setConversationComposerSelection, setConversationSelectedSkills, thinkingConversations]);

  const runWorkspaceCommand = useCallback((workspace: WorkspaceRecord, conversation: ConversationRecord, command: 'start' | 'status' | 'attach' | 'stop' | 'interrupt') => {
    if (command === 'start') {
      void startLocalAdapter(workspace, conversation).catch(() => undefined);
      return;
    }
    if (command === 'status') {
      sendWorkspaceCommand(workspace, 'codex.local.status', {}, conversation);
      return;
    }
    if (command === 'attach') {
      attachWorkspaceConversation(workspace, conversation);
      return;
    }
    if (command === 'interrupt') {
      const threadId = normalizeThreadId(conversation.threadId);
      if (!threadId) {
        setLastError('当前对话还没有可中断的 thread。');
        return;
      }
      sendWorkspaceCommand(workspace, 'codex.local.interrupt', {
        threadId,
        turnId: turnIds[conversation.id] || '',
      }, conversation);
      return;
    }
    if (sendWorkspaceCommand(workspace, 'codex.local.stop', { force: false }, conversation)) {
      const pending = pendingLocalStartsRef.current.get(conversation.id);
      if (pending) {
        clearTimeout(pending.timeoutId);
        pendingLocalStartsRef.current.delete(conversation.id);
        pending.reject(new Error('本地会话已停止'));
      }
      updateConversation(conversation.id, { localAdapterState: 'stopped' });
    }
  }, [attachWorkspaceConversation, sendWorkspaceCommand, turnIds, updateConversation, startLocalAdapter]);

  const runThreadMenuAction = useCallback((conversationId: string, action: ThreadMenuAction) => {
    if (action === 'fork') {
      forkConversation(conversationId);
      return;
    }
    if (action === 'archive') {
      removeConversation(conversationId);
      return;
    }
    if (action === 'resume') {
      void sendNativeThreadAction(conversationId, 'resume', 'thread/resume', (threadId) => ({ threadId }), { restoreHistory: true });
      return;
    }
    if (action === 'rollback') {
      void sendNativeThreadAction(conversationId, 'rollback', 'thread/rollback', (threadId) => ({ threadId, numTurns: 1 }));
      return;
    }
    if (action === 'compact') {
      void sendNativeThreadAction(conversationId, 'read', 'thread/compact/start', (threadId) => ({ threadId }), {
        showResult: true,
        resultTitle: 'Compact started',
      });
      return;
    }
    if (action === 'detail') {
      void sendNativeThreadAction(conversationId, 'detail', 'thread/read', (threadId) => ({ threadId, includeTurns: false }), {
        showResult: true,
        resultTitle: 'Thread details',
      });
      return;
    }
    if (action === 'history') {
      void sendNativeThreadAction(conversationId, 'read', 'thread/read', (threadId) => ({ threadId, includeTurns: true }), {
        restoreHistory: true,
        showResult: true,
        resultTitle: 'Thread history',
      });
      return;
    }
    if (action === 'turns') {
      void sendNativeThreadAction(conversationId, 'turns', 'thread/turns/list', (threadId) => ({
        threadId,
        limit: 20,
        sortDirection: 'desc',
        itemsView: 'summary',
      }), {
        showResult: true,
        resultTitle: 'Thread turns',
      });
      return;
    }
    if (action === 'unarchive') {
      void sendNativeThreadAction(conversationId, 'unarchive', 'thread/unarchive', (threadId) => ({ threadId }), {
        showResult: true,
        resultTitle: 'Thread unarchived',
      });
      return;
    }
    if (action === 'unsubscribe') {
      void sendNativeThreadAction(conversationId, 'unsubscribe', 'thread/unsubscribe', (threadId) => ({ threadId }), {
        showResult: true,
        resultTitle: 'Thread unsubscribe',
      });
      return;
    }
    if (action === 'loaded') {
      void sendTrackedLocalMethod(conversationId, 'loaded', 'thread/loaded/list', { limit: 100 }, 'Loaded threads');
      return;
    }
    if (action === 'clean') {
      void sendNativeThreadAction(conversationId, 'clean', 'thread/backgroundTerminals/clean', (threadId) => ({ threadId }), {
        showResult: true,
        resultTitle: 'Background terminals clean',
      });
      return;
    }
    openThreadCommandPrompt(conversationId, action);
  }, [forkConversation, openThreadCommandPrompt, removeConversation, sendNativeThreadAction, sendTrackedLocalMethod]);

  const submitThreadCommandPrompt = useCallback((prompt: ThreadCommandPromptState, value: string) => {
    const trimmed = value.trim();
    if (prompt.command === 'metadata') {
      const parsed = parseThreadMetadataPrompt(trimmed);
      if (parsed.error) {
        Alert.alert('Metadata', parsed.error);
        return;
      }
      void sendNativeThreadAction(prompt.conversationId, 'metadata', 'thread/metadata/update', (threadId) => ({
        threadId,
        gitInfo: parsed.gitInfo,
      }), {
        showResult: true,
        resultTitle: 'Thread metadata updated',
      });
      setThreadCommandPrompt(null);
      return;
    }
    if (prompt.command === 'memory') {
      const mode = parseThreadMemoryMode(trimmed);
      if (!mode) {
        Alert.alert('Memory', '请输入 on、off 或 reset。');
        return;
      }
      if (mode === 'reset') {
        void sendTrackedLocalMethod(prompt.conversationId, 'memoryReset', 'memory/reset', null, 'Memory reset');
      } else {
        void sendNativeThreadAction(prompt.conversationId, 'memory', 'thread/memoryMode/set', (threadId) => ({
          threadId,
          mode,
        }), {
          showResult: true,
          resultTitle: 'Thread memory',
          resultDetail: `memory mode: ${mode}`,
        });
      }
      setThreadCommandPrompt(null);
      return;
    }
    if (prompt.command === 'shell') {
      if (!trimmed) {
        Alert.alert('Shell command', '请输入要执行的 shell command。');
        return;
      }
      void sendNativeThreadAction(prompt.conversationId, 'shell', 'thread/shellCommand', (threadId) => ({
        threadId,
        command: trimmed,
      }), {
        showResult: true,
        resultTitle: 'Shell command sent',
        resultDetail: trimmed,
      });
      setThreadCommandPrompt(null);
      return;
    }
    if (prompt.command === 'items') {
      if (!trimmed) {
        Alert.alert('Turn items', '请输入 turn id。');
        return;
      }
      void sendNativeThreadAction(prompt.conversationId, 'items', 'thread/turns/items/list', (threadId) => ({
        threadId,
        turnId: trimmed,
        limit: 50,
        sortDirection: 'asc',
      }), {
        showResult: true,
        resultTitle: 'Turn items',
      });
      setThreadCommandPrompt(null);
      return;
    }
    if (prompt.command === 'inject') {
      const items = parseJsonArrayPrompt(trimmed);
      if (!items) {
        Alert.alert('Inject items', '请输入 JSON 数组。');
        return;
      }
      void sendNativeThreadAction(prompt.conversationId, 'inject', 'thread/inject_items', (threadId) => ({
        threadId,
        items,
      }), {
        showResult: true,
        resultTitle: 'Items injected',
      });
      setThreadCommandPrompt(null);
      return;
    }
    if (prompt.command === 'guardian') {
      try {
        const event = JSON.parse(trimmed);
        void sendNativeThreadAction(prompt.conversationId, 'guardian', 'thread/approveGuardianDeniedAction', (threadId) => ({
          threadId,
          event,
        }), {
          showResult: true,
          resultTitle: 'Guardian action approved',
        });
        setThreadCommandPrompt(null);
      } catch {
        Alert.alert('Guardian', '请输入有效 JSON。');
      }
    }
  }, [sendNativeThreadAction, sendTrackedLocalMethod]);

  if (!hydrated) {
    return (
      <GestureHandlerRootView style={styles.appRoot}>
        <HeroUINativeProvider>
          <Surface className="flex-1 items-center justify-center bg-background px-8">
            <StatusBar style="dark" />
            <View className="h-14 w-14 items-center justify-center rounded-lg bg-accent">
              <HeroText className="text-2xl font-semibold text-accent-foreground">T</HeroText>
            </View>
            <HeroText className="mt-4 text-3xl font-semibold text-foreground">TodeX</HeroText>
            <HeroText className="mt-2 text-center text-sm text-muted">正在加载设置和工作区...</HeroText>
          </Surface>
        </HeroUINativeProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.appRoot}>
      <HeroUINativeProvider>
        <SafeAreaProvider>
          <NavigationContainer ref={navigationRef}>
            <StatusBar style="dark" />
            <Stack.Navigator
              initialRouteName="Workspaces"
              screenOptions={{
                headerStyle: { backgroundColor: '#f7f9fa' },
                headerShadowVisible: false,
                headerTitleStyle: styles.headerTitle,
                headerTintColor: '#17202a',
                contentStyle: styles.screenBackground,
              }}
            >
            <Stack.Screen name="Workspaces" options={{ title: '工作区' }}>
              {(props) => (
                <WorkspaceListScreen
                  {...props}
                  workspaces={workspaces}
                  conversations={conversations}
                  settings={settings}
                  connectionState={connectionState}
                  createWorkspace={createWorkspace}
                  selectWorkspace={selectWorkspace}
                  renameWorkspace={renameWorkspace}
                  forkWorkspace={forkWorkspace}
                  removeWorkspace={removeWorkspace}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Conversations">
              {(props) => (
                <ConversationListScreen
                  {...props}
                  workspaces={workspaces}
                  conversations={conversations}
                  activeConversationId={activeConversationId}
                  activeTurns={turnIds}
                  connectionState={connectionState}
                  threadListStatus={threadListStatusByWorkspace[props.route.params.workspaceId] ?? 'idle'}
                  threadListError={threadListErrorByWorkspace[props.route.params.workspaceId] ?? ''}
                  createConversation={createConversation}
                  refreshNativeThreads={requestNativeThreadList}
                  selectWorkspace={selectWorkspace}
                  selectConversation={selectConversation}
                  renameConversation={renameConversation}
                  forkConversation={forkConversation}
                  removeConversation={removeConversation}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Chat">
              {(props) => (
                <ChatScreen
                  {...props}
                  settings={settings}
                  workspaces={workspaces}
                  conversations={conversations}
                  timeline={timeline}
                  pendingRequests={pendingRequests}
                  selectedRequest={selectedRequest}
                  chatDraft={chatDrafts[props.route.params.conversationId] ?? ''}
                  composerAttachments={composerAttachments[props.route.params.conversationId] ?? []}
                  selectedSkills={selectedSkills[props.route.params.conversationId] ?? []}
                  composerSelection={composerSelections[props.route.params.conversationId] ?? DEFAULT_COMPOSER_SELECTION}
                  isThinking={thinkingConversations[props.route.params.conversationId] === true}
                  turnId={turnIds[props.route.params.conversationId] ?? ''}
                  lastError={lastError}
                  connectionState={connectionState}
                  setChatDraft={(value) => setConversationChatDraft(props.route.params.conversationId, value)}
                  setComposerAttachments={(value) => setConversationAttachments(props.route.params.conversationId, value)}
                  setSelectedSkills={(value) => setConversationSelectedSkills(props.route.params.conversationId, value)}
                  setComposerSelection={(value) => setConversationComposerSelection(props.route.params.conversationId, value)}
                  submitChat={submitChat}
                  stopThinking={stopThinking}
                  sendApprovalResponse={sendApprovalResponse}
                  selectConversation={selectConversation}
                  attachWorkspaceConversation={attachWorkspaceConversation}
                  loadNativeThreadHistory={loadNativeThreadHistory}
                  runWorkspaceCommand={runWorkspaceCommand}
                  runThreadMenuAction={runThreadMenuAction}
                  sendSlashCommand={sendSlashCommand}
                  openGitDiff={openGitDiff}
                  removeWorkspace={removeWorkspace}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="SlashCommands" options={{ title: 'Slash Commands' }}>
              {(props) => {
                const conversation = conversations.find((item) => item.id === props.route.params.conversationId) ?? null;
                const workspace = workspaces.find((item) => item.id === props.route.params.workspaceId) ?? null;
                return (
                  <SlashCommandsScreen
                    {...props}
                    workspace={workspace}
                    conversation={conversation}
                    runThreadMenuAction={runThreadMenuAction}
                    sendSlashCommand={sendSlashCommand}
                    openGitDiff={openGitDiff}
                  />
                );
              }}
            </Stack.Screen>
            <Stack.Screen name="SlashCommandAction" options={{ title: 'Command' }}>
              {(props) => {
                const conversation = conversations.find((item) => item.id === props.route.params.conversationId) ?? null;
                const workspace = workspaces.find((item) => item.id === props.route.params.workspaceId) ?? null;
                return (
                  <SlashCommandActionScreen
                    {...props}
                    workspace={workspace}
                    conversation={conversation}
                    settings={settings}
                    modelCatalog={modelCatalog}
                    modelCatalogStatus={modelCatalogStatus}
                    modelCatalogError={modelCatalogError}
                    refreshModelCatalog={requestModelCatalog}
                    applyWorkspaceModelSelection={applyWorkspaceModelSelection}
                    sendSlashCommand={sendSlashCommand}
                    openGitDiff={openGitDiff}
                  />
                );
              }}
            </Stack.Screen>
            <Stack.Screen name="GitDiff" options={{ title: 'Git Diff' }}>
              {(props) => {
                const conversation = conversations.find((item) => item.id === props.route.params.conversationId) ?? null;
                const workspace = workspaces.find((item) => item.id === props.route.params.workspaceId) ?? null;
                return (
                  <GitDiffScreen
                    {...props}
                    workspace={workspace}
                    conversation={conversation}
                    diffState={gitDiffByConversation[props.route.params.conversationId] ?? null}
                    requestGitDiff={requestGitDiff}
                  />
                );
              }}
            </Stack.Screen>
            <Stack.Screen name="Experimental" options={{ title: 'Experimental' }}>
              {(props) => {
                const conversation = conversations.find((item) => item.id === props.route.params.conversationId) ?? null;
                const workspace = workspaces.find((item) => item.id === props.route.params.workspaceId) ?? null;
                return (
                  <ExperimentalScreen
                    {...props}
                    workspace={workspace}
                    conversation={conversation}
                    features={experimentalFeatures}
                    setFeatures={setExperimentalFeatures}
                  />
                );
              }}
            </Stack.Screen>
            <Stack.Screen name="Settings" options={{ title: '设置' }}>
              {(props) => (
                <SettingsScreen
                  {...props}
                  settings={settings}
                  setSettings={setSettings}
                  modelCatalog={modelCatalog}
                  modelCatalogStatus={modelCatalogStatus}
                  modelCatalogError={modelCatalogError}
                  refreshModelCatalog={requestModelCatalog}
                  openDefaultModelPicker={() => {
                    setModelPickerPrompt({ target: 'settings' });
                    if (connectionState === 'open' && modelCatalogStatus !== 'loading') {
                      requestModelCatalog();
                    }
                  }}
                  serverVersion={serverVersion}
                  activeWorkspace={activeWorkspace}
                  pendingRequestCount={pendingRequests.length}
                  turnId={activeTurnId}
                  runtimeStatus={runtimeStatus}
                  connectionState={connectionState}
                  connectionHealth={connectionHealth}
                  lastError={lastError}
                  connect={connect}
                  closeSocket={closeSocket}
                  refreshServerVersion={refreshServerVersion}
                />
              )}
            </Stack.Screen>
            </Stack.Navigator>
          </NavigationContainer>
          <PromptModal
          visible={Boolean(modelCommandPrompt)}
          title="切换模型"
          initialValue={modelCommandPrompt?.initialValue ?? ''}
          placeholder="gpt-5.5 high"
          onCancel={() => setModelCommandPrompt(null)}
          onSubmit={(value) => {
            const targetConversationId = modelCommandPrompt?.conversationId ?? '';
            if (modelCommandPrompt?.target === 'settings') {
              const { model, reasoningEffort, invalidReasoningEffort } = parseModelCommandArgs(value.trim().split(/\s+/));
              if (invalidReasoningEffort) {
                Alert.alert('无效思考强度', '支持 none、minimal、low、medium、high、xhigh，也支持 max 作为 xhigh 的别名。');
                return;
              }
              applyDefaultModelSelection(model || settings.defaultModel, reasoningEffort ?? settings.defaultReasoningEffort ?? null);
              setModelCommandPrompt(null);
              return;
            }
            setModelCommandPrompt(null);
            applyModelCommand(targetConversationId, value.trim().split(/\s+/), false);
          }}
        />
          <PromptModal
          visible={Boolean(threadCommandPrompt)}
          title={threadCommandPrompt?.title ?? 'Thread'}
          initialValue={threadCommandPrompt?.initialValue ?? ''}
          placeholder={threadCommandPrompt?.placeholder ?? ''}
          warning={threadCommandPrompt?.warning}
          multiline={threadCommandPrompt?.multiline}
          submitTitle="发送"
          onCancel={() => setThreadCommandPrompt(null)}
          onSubmit={(value) => {
            if (threadCommandPrompt) {
              submitThreadCommandPrompt(threadCommandPrompt, value);
            }
          }}
        />
          <ThreadInfoModal
          visible={Boolean(threadInfoModal)}
          title={threadInfoModal?.title ?? ''}
          detail={threadInfoModal?.detail ?? ''}
          raw={threadInfoModal?.raw}
          onClose={() => setThreadInfoModal(null)}
        />
          <SkillPickerModal
            visible={skillListVisible}
            workspace={getConversationContext(skillListConversationId)?.workspace ?? activeWorkspace}
            conversationId={skillListConversationId}
            status={skillListStatus}
            error={skillListError}
            skills={skillListItems}
            selectedSkills={selectedSkills[skillListConversationId] ?? []}
            onRefresh={() => void requestSkillList(skillListConversationId || activeConversationRef.current, true)}
            onToggleSkill={(skill) => toggleSelectedSkill(skillListConversationId || activeConversationRef.current, skill)}
            onClose={() => setSkillListVisible(false)}
          />
          <ModelPickerModal
          visible={Boolean(modelPickerPrompt)}
          title={modelPickerPrompt?.target === 'settings' ? '默认模型' : '当前对话模型'}
          catalog={modelCatalog}
          selectedModel={
            modelPickerPrompt?.target === 'settings'
              ? settings.defaultModel
              : (() => {
                  const context = modelPickerPrompt?.conversationId
                    ? getConversationContext(modelPickerPrompt.conversationId)
                    : null;
                  return context?.workspace.model || settings.defaultModel;
                })()
          }
          selectedReasoningEffort={
            modelPickerPrompt?.target === 'settings'
              ? normalizeReasoningEffort(settings.defaultReasoningEffort)
              : (() => {
                  const context = modelPickerPrompt?.conversationId
                    ? getConversationContext(modelPickerPrompt.conversationId)
                    : null;
                  return normalizeReasoningEffort(context?.workspace.reasoningEffort ?? settings.defaultReasoningEffort);
                })()
          }
          loading={modelCatalogStatus === 'loading'}
          error={modelCatalogError}
          onRefresh={requestModelCatalog}
          onCancel={() => setModelPickerPrompt(null)}
          onSubmit={(model, reasoningEffort) => {
            const prompt = modelPickerPrompt;
            setModelPickerPrompt(null);
            if (prompt?.target === 'settings') {
              applyDefaultModelSelection(model, reasoningEffort);
              return;
            }
            if (prompt?.conversationId) {
              applyWorkspaceModelSelection(prompt.conversationId, model, reasoningEffort);
            }
          }}
          onManual={() => {
            const prompt = modelPickerPrompt;
            setModelPickerPrompt(null);
            if (prompt?.target === 'settings') {
              setModelCommandPrompt({
                conversationId: activeConversationRef.current,
                initialValue: [settings.defaultModel, normalizeReasoningEffort(settings.defaultReasoningEffort)].filter(Boolean).join(' '),
                target: 'settings',
              });
              return;
            }
            if (prompt?.conversationId) {
              const context = getConversationContext(prompt.conversationId);
              if (context) {
                setModelCommandPrompt({
                  conversationId: context.conversation.id,
                  initialValue: modelCommandInitialValue(context.workspace, settings),
                });
              }
            }
          }}
          />
        </SafeAreaProvider>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}

function WorkspaceListScreen({
  navigation,
  workspaces,
  conversations,
  settings,
  connectionState,
  createWorkspace,
  selectWorkspace,
  renameWorkspace,
  forkWorkspace,
  removeWorkspace,
}: NativeStackScreenProps<RootStackParamList, 'Workspaces'> & {
  workspaces: WorkspaceRecord[];
  conversations: ConversationRecord[];
  settings: ConnectionSettings;
  connectionState: string;
  createWorkspace: (name: string, path: string) => { workspace: WorkspaceRecord; conversation: ConversationRecord } | null;
  selectWorkspace: (workspaceId: string) => void;
  renameWorkspace: (workspaceId: string, name: string) => void;
  forkWorkspace: (workspaceId: string) => { workspace: WorkspaceRecord; conversation: ConversationRecord | null } | null;
  removeWorkspace: (workspaceId: string) => void;
}) {
  const [modalVisible, setModalVisible] = useState(false);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('');
  const [workspacePathDraft, setWorkspacePathDraft] = useState('');
  const [renamingWorkspace, setRenamingWorkspace] = useState<WorkspaceRecord | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <HeaderIconButton label="设置" onPress={() => navigation.navigate('Settings')} />
          <HeaderIconButton label="+" onPress={() => setModalVisible(true)} />
        </View>
      ),
    });
  }, [navigation]);

  const submit = () => {
    const created = createWorkspace(workspaceNameDraft, workspacePathDraft);
    if (!created) {
      return;
    }
    setWorkspaceNameDraft('');
    setWorkspacePathDraft('');
    setModalVisible(false);
    navigation.navigate('Conversations', { workspaceId: created.workspace.id });
  };

  const openWorkspaceActions = (workspace: WorkspaceRecord) => {
    Alert.alert('工作区操作', workspace.name, [
      { text: '改名', onPress: () => setRenamingWorkspace(workspace) },
      {
        text: 'Fork',
        onPress: () => {
          const forked = forkWorkspace(workspace.id);
          if (forked) {
            navigation.navigate('Conversations', { workspaceId: forked.workspace.id });
          }
        },
      },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          Alert.alert('删除工作区', `确定删除「${workspace.name}」及其所有本地对话记录？`, [
            { text: '取消', style: 'cancel' },
            { text: '删除', style: 'destructive', onPress: () => removeWorkspace(workspace.id) },
          ]);
        },
      },
      { text: '取消', style: 'cancel' },
    ]);
  };

  return (
    <Surface className="flex-1 bg-background">
      <ScrollView contentContainerStyle={styles.listContent}>
        <View className="mx-4 mb-2 mt-1 flex-row items-center justify-between">
          <View>
            <HeroText className="text-2xl font-semibold text-foreground">TodeX</HeroText>
            <HeroText className="mt-1 text-xs text-muted">移动端工作区</HeroText>
          </View>
          <Chip
            color={connectionState === 'open' ? 'success' : 'default'}
            variant={connectionState === 'open' ? 'primary' : 'secondary'}
            size="sm"
          >
            {connectionState}
          </Chip>
        </View>

        {workspaces.length === 0 ? (
          <EmptyState text="还没有工作区。点右上角 + 添加一个目录。" />
        ) : (
          workspaces.map((workspace) => {
            const count = conversations.filter((conversation) => conversation.workspaceId === workspace.id).length;
            return (
              <Button
                key={workspace.id}
                variant="ghost"
                onPress={() => {
                  selectWorkspace(workspace.id);
                  navigation.navigate('Conversations', { workspaceId: workspace.id });
                }}
                onLongPress={() => openWorkspaceActions(workspace)}
                className="mx-3 mb-2 min-h-[76px] justify-start rounded-lg bg-surface px-3 py-3"
              >
                <View className="h-12 w-12 items-center justify-center rounded-lg bg-foreground">
                  <HeroText className="text-base font-semibold text-background">{workspace.name.slice(0, 1).toUpperCase()}</HeroText>
                </View>
                <View className="min-w-0 flex-1">
                  <View className="flex-row items-center justify-between gap-2">
                    <HeroText className="min-w-0 flex-1 text-base font-semibold text-foreground" numberOfLines={1}>
                      {workspace.name}
                    </HeroText>
                    <Chip size="sm" variant="secondary">{count} 个对话</Chip>
                  </View>
                  <HeroText className="mt-1 text-xs text-muted" numberOfLines={1}>
                    {workspace.path}
                  </HeroText>
                </View>
                <StyledIonicons name="chevron-forward" size={17} className="text-muted" />
              </Button>
            );
          })
        )}
      </ScrollView>

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <Card className="rounded-b-none">
            <View style={styles.modalHeader}>
              <Card.Title>新建工作区</Card.Title>
              <Button variant="ghost" size="sm" onPress={() => setModalVisible(false)}>
                <Button.Label>关闭</Button.Label>
              </Button>
            </View>
            <Field label="工作区名称" value={workspaceNameDraft} onChangeText={setWorkspaceNameDraft} placeholder="可选" />
            <Field
              label="目录路径"
              value={workspacePathDraft}
              onChangeText={setWorkspacePathDraft}
              placeholder={settings.defaultWorkspacePath}
            />
            <Row>
              <ActionButton title="创建" onPress={submit} />
              <ActionButton title="填入默认路径" onPress={() => setWorkspacePathDraft(settings.defaultWorkspacePath)} tone="ghost" />
            </Row>
          </Card>
        </View>
      </Modal>

      <PromptModal
        visible={Boolean(renamingWorkspace)}
        title="重命名工作区"
        initialValue={renamingWorkspace?.name ?? ''}
        placeholder="新的工作区名称"
        onCancel={() => setRenamingWorkspace(null)}
        onSubmit={(value) => {
          if (renamingWorkspace) {
            renameWorkspace(renamingWorkspace.id, value);
          }
          setRenamingWorkspace(null);
        }}
      />
    </Surface>
  );
}

function ConversationListScreen({
  navigation,
  route,
  workspaces,
  conversations,
  activeConversationId,
  activeTurns,
  connectionState,
  threadListStatus,
  threadListError,
  createConversation,
  refreshNativeThreads,
  selectWorkspace,
  selectConversation,
  renameConversation,
  forkConversation,
  removeConversation,
}: NativeStackScreenProps<RootStackParamList, 'Conversations'> & {
  workspaces: WorkspaceRecord[];
  conversations: ConversationRecord[];
  activeConversationId: string;
  activeTurns: Record<string, string>;
  connectionState: ConnectionState;
  threadListStatus: 'idle' | 'loading' | 'ready' | 'error';
  threadListError: string;
  createConversation: (workspaceId: string) => ConversationRecord | null;
  refreshNativeThreads: (workspaceId: string, includeArchived?: boolean) => Promise<boolean>;
  selectWorkspace: (workspaceId: string) => void;
  selectConversation: (workspaceId: string, conversationId: string) => void;
  renameConversation: (conversationId: string, title: string) => void;
  forkConversation: (conversationId: string) => ConversationRecord | null;
  removeConversation: (conversationId: string) => void;
}) {
  const [renamingConversation, setRenamingConversation] = useState<ConversationRecord | null>(null);
  const workspace = workspaces.find((item) => item.id === route.params.workspaceId) ?? null;
  const workspaceConversations = conversations.filter((conversation) => conversation.workspaceId === route.params.workspaceId && conversation.archived !== true);

  useEffect(() => {
    selectWorkspace(route.params.workspaceId);
  }, [route.params.workspaceId, selectWorkspace]);

  useEffect(() => {
    if (!workspace || connectionState !== 'open') {
      return;
    }
    let cancelled = false;
    const sync = () => {
      if (!cancelled) {
        void refreshNativeThreads(workspace.id);
      }
    };
    sync();
    const timer = setInterval(sync, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connectionState, refreshNativeThreads, workspace?.id, workspace?.path]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: workspace?.name ?? '对话',
      headerRight: () => (
        <View style={styles.headerActions}>
          <HeaderIconButton
            label="+"
            onPress={() => {
              const next = createConversation(route.params.workspaceId);
              if (next) {
                navigation.navigate('Chat', { workspaceId: route.params.workspaceId, conversationId: next.id });
              }
            }}
          />
        </View>
      ),
    });
  }, [createConversation, navigation, route.params.workspaceId, workspace?.name]);

  const conversationTitle = (conversation: ConversationRecord) => {
    return conversation.title || conversation.preview || 'Untitled thread';
  };

  const openConversationActions = (conversation: ConversationRecord) => {
    const title = conversationTitle(conversation);
    Alert.alert('对话操作', title, [
      { text: '改名', onPress: () => setRenamingConversation({ ...conversation, title }) },
      {
        text: 'Fork',
        onPress: () => {
          const forked = forkConversation(conversation.id);
          if (forked && workspace) {
            navigation.navigate('Chat', { workspaceId: workspace.id, conversationId: forked.id });
          }
        },
      },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          Alert.alert('删除对话', `确定删除「${title}」的本地记录？`, [
            { text: '取消', style: 'cancel' },
            { text: '归档', style: 'destructive', onPress: () => removeConversation(conversation.id) },
          ]);
        },
      },
      { text: '取消', style: 'cancel' },
    ]);
  };

  if (!workspace) {
    return (
      <Surface className="flex-1 items-center justify-center bg-background p-5">
        <EmptyState text="工作区不存在。请返回工作区列表重新选择。" />
      </Surface>
    );
  }

  return (
    <Surface className="flex-1 bg-background">
      <ScrollView contentContainerStyle={styles.listContent}>
        <Card variant="transparent" className="mx-4 mb-2 border border-separator bg-surface-secondary">
          <Card.Body className="gap-1">
            <Card.Title numberOfLines={1}>{workspace.name}</Card.Title>
            <Card.Description numberOfLines={2}>{workspace.path}</Card.Description>
            <HeroText className="text-xs text-muted" numberOfLines={1}>
            {threadListStatus === 'loading'
              ? '正在同步 Codex 原生 threads'
              : threadListError
                ? threadListError
                : `${workspaceConversations.length} 个原生 thread`}
            </HeroText>
          </Card.Body>
        </Card>

      {workspaceConversations.length === 0 ? (
        <EmptyState text="还没有对话。点右上角 + 创建一个纯粹的新对话。" />
      ) : (
        workspaceConversations.map((conversation) => {
          const preview = conversation.title || conversation.preview || 'Untitled thread';
          const running = Boolean(activeTurns[conversation.id]);
          const highlighted = isConversationHighlighted(conversation, activeConversationId, activeTurns);
          const statusLabel = running ? '运行中' : conversation.nativeStatus || nowLabel(conversation.updatedAt);
          return (
            <Button
              key={conversation.id}
              variant="ghost"
              onPress={() => {
                selectConversation(workspace.id, conversation.id);
                navigation.navigate('Chat', { workspaceId: workspace.id, conversationId: conversation.id });
              }}
              onLongPress={() => openConversationActions(conversation)}
              className={`mx-3 mb-2 min-h-[76px] justify-start rounded-lg px-3 py-3 ${running ? 'bg-success-soft' : highlighted ? 'bg-accent-soft' : 'bg-surface'}`}
            >
              <View className={`h-12 w-12 items-center justify-center rounded-lg ${running ? 'bg-success' : 'bg-surface-tertiary'}`}>
                <HeroText className={`text-base font-semibold ${running ? 'text-success-foreground' : 'text-surface-tertiary-foreground'}`}>
                  {preview.slice(0, 1).toUpperCase()}
                </HeroText>
              </View>
              <View className="min-w-0 flex-1">
                <View className="flex-row items-center justify-between gap-2">
                  <HeroText className={`min-w-0 flex-1 text-base font-semibold ${running ? 'text-success-soft-foreground' : 'text-foreground'}`} numberOfLines={1}>
                    {preview}
                  </HeroText>
                  <Chip color={running ? 'success' : 'default'} size="sm" variant={running ? 'primary' : 'secondary'}>
                    {statusLabel}
                  </Chip>
                </View>
                <HeroText className="mt-1 text-xs text-muted" numberOfLines={1}>
                  {running ? '正在处理当前对话' : nowLabel(conversation.updatedAt)}
                </HeroText>
              </View>
            </Button>
          );
        })
      )}
      <PromptModal
        visible={Boolean(renamingConversation)}
        title="重命名对话"
        initialValue={renamingConversation?.title ?? ''}
        placeholder="新的对话标题"
        onCancel={() => setRenamingConversation(null)}
        onSubmit={(value) => {
          if (renamingConversation) {
            renameConversation(renamingConversation.id, value);
          }
          setRenamingConversation(null);
        }}
      />
      </ScrollView>
    </Surface>
  );
}

function ChatScreen({
  navigation,
  route,
  settings,
  workspaces,
  conversations,
  timeline,
  pendingRequests,
  selectedRequest,
  chatDraft,
  composerAttachments,
  selectedSkills,
  composerSelection,
  isThinking,
  turnId,
  lastError,
  connectionState,
  setChatDraft,
  setComposerAttachments,
  setSelectedSkills,
  setComposerSelection,
  submitChat,
  stopThinking,
  sendApprovalResponse,
  selectConversation,
  attachWorkspaceConversation,
  loadNativeThreadHistory,
  runWorkspaceCommand,
  runThreadMenuAction,
  sendSlashCommand,
  openGitDiff,
  removeWorkspace,
}: NativeStackScreenProps<RootStackParamList, 'Chat'> & {
  settings: ConnectionSettings;
  workspaces: WorkspaceRecord[];
  conversations: ConversationRecord[];
  timeline: TimelineEntry[];
  pendingRequests: PendingRequest[];
  selectedRequest: PendingRequest | null;
  chatDraft: string;
  composerAttachments: ComposerAttachmentDraft[];
  selectedSkills: SelectedSkillAttachment[];
  composerSelection: TextInputSelectionChangeEventData['selection'];
  isThinking: boolean;
  turnId: string;
  lastError: string;
  connectionState: ConnectionState;
  setChatDraft: Dispatch<SetStateAction<string>>;
  setComposerAttachments: Dispatch<SetStateAction<ComposerAttachmentDraft[]>>;
  setSelectedSkills: Dispatch<SetStateAction<SelectedSkillAttachment[]>>;
  setComposerSelection: Dispatch<SetStateAction<TextInputSelectionChangeEventData['selection']>>;
  submitChat: (conversationId: string) => void;
  stopThinking: (conversationId: string) => void;
  sendApprovalResponse: (accepted: boolean, request: PendingRequest) => boolean;
  selectConversation: (workspaceId: string, conversationId: string) => void;
  attachWorkspaceConversation: (workspace: WorkspaceRecord, conversation: ConversationRecord) => boolean;
  loadNativeThreadHistory: (conversationId: string, force?: boolean) => boolean;
  runWorkspaceCommand: (workspace: WorkspaceRecord, conversation: ConversationRecord, command: 'start' | 'status' | 'attach' | 'stop' | 'interrupt') => void;
  runThreadMenuAction: (conversationId: string, action: ThreadMenuAction) => void;
  sendSlashCommand: (input: string, conversationId?: string) => void;
  openGitDiff: (conversationId: string) => void;
  removeWorkspace: (workspaceId: string) => void;
}) {
  const [menuVisible, setMenuVisible] = useState(false);
  const [mentionEntries, setMentionEntries] = useState<WorkspaceEntry[]>([]);
  const [expandedProgressIds, setExpandedProgressIds] = useState<Set<string>>(() => new Set());
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [attachmentMenuVisible, setAttachmentMenuVisible] = useState(false);
  const messageScrollRef = useRef<ScrollView | null>(null);
  const shouldFollowLatestRef = useRef(true);
  const initialLatestScrollRef = useRef(true);
  const attachedSessionKeyRef = useRef('');
  const composerInputRef = useRef<TextInput | null>(null);
  const autoExpandedProgressIdsRef = useRef<Set<string>>(new Set());
  const autoExpandedRequestIdsRef = useRef<Map<string, string[]>>(new Map());
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();
  const composerPaddingBottom = 12 + (keyboardInset > 0 ? 0 : insets.bottom);
  const workspace = workspaces.find((item) => item.id === route.params.workspaceId) ?? null;
  const conversation = conversations.find((item) => item.id === route.params.conversationId) ?? null;
  const conversationMessages = useMemo(
    () => timeline
      .filter((entry) => entry.conversationId === route.params.conversationId && isVisibleConversationEntry(entry))
      .slice()
      .reverse(),
    [route.params.conversationId, timeline],
  );
  const chatHeaderTitle = conversation?.title || conversationPreviewText(conversationMessages[conversationMessages.length - 1]);
  const conversationRenderItems = useMemo(
    () => buildConversationRenderItems(conversationMessages),
    [conversationMessages],
  );
  const pendingRequestById = useMemo(() => {
    const result = new Map<string, PendingRequest>();
    pendingRequests.forEach((request) => result.set(request.requestId, request));
    return result;
  }, [pendingRequests]);
  const pendingRequestExpansionTargets = useMemo(() => {
    const result = new Map<string, string[]>();

    for (const item of conversationRenderItems) {
      if (item.type === 'executionGroup') {
        for (const entry of item.entries) {
          if (entry.requestId) {
            result.set(entry.requestId, [item.id, entry.id]);
          }
        }
        continue;
      }

      if (item.entry.requestId) {
        result.set(item.entry.requestId, [item.entry.id]);
      }
    }

    return result;
  }, [conversationRenderItems]);
  const slashQuery = chatDraft.startsWith('/') ? chatDraft.slice(1).trim().toLowerCase() : '';
  const slashSuggestions = chatDraft.startsWith('/')
    ? SLASH_COMMANDS.filter((item, index, list) => {
        const unique = list.findIndex((candidate) => candidate.command === item.command) === index;
        if (!unique) {
          return false;
        }
        if (!slashQuery) {
          return true;
        }
        return (
          item.command.toLowerCase().includes(slashQuery) ||
          item.title.toLowerCase().includes(slashQuery) ||
          item.description.toLowerCase().includes(slashQuery)
        );
      })
    : [];
  const mentionTrigger = slashSuggestions.length === 0 ? findMentionTrigger(chatDraft, composerSelection.start) : null;
  const mentionSuggestions = buildMentionSuggestions(mentionTrigger, mentionEntries);

  useEffect(() => {
    if (connectionState !== 'open' || !workspace || !conversation?.sessionId) {
      if (connectionState !== 'open') {
        attachedSessionKeyRef.current = '';
      }
      return;
    }
    const sessionId = sessionIdForConversation(workspace, conversation);
    const attachKey = `${workspace.id}:${sessionId}`;
    if (attachedSessionKeyRef.current === attachKey) {
      return;
    }
    attachedSessionKeyRef.current = attachKey;
    attachWorkspaceConversation(workspace, conversation);
  }, [attachWorkspaceConversation, connectionState, conversation?.id, conversation?.sessionId, workspace?.id]);

  useEffect(() => {
    if (connectionState !== 'open' || !conversation?.threadId) {
      return;
    }
    loadNativeThreadHistory(conversation.id);
  }, [connectionState, conversation?.id, conversation?.threadId, conversation?.updatedAt, loadNativeThreadHistory]);

  const scrollToLatest = useCallback((animated = false) => {
    requestAnimationFrame(() => {
      messageScrollRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const handleMessageScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const isAtBottom = distanceFromBottom <= CHAT_BOTTOM_FOLLOW_THRESHOLD;
    shouldFollowLatestRef.current = isAtBottom;
    setShowJumpToLatest(!isAtBottom && conversationMessages.length > 0);
  }, [conversationMessages.length]);

  const handleMessageContentSizeChange = useCallback(() => {
    if (!shouldFollowLatestRef.current) {
      return;
    }
    const animated = !initialLatestScrollRef.current;
    initialLatestScrollRef.current = false;
    scrollToLatest(animated);
  }, [scrollToLatest]);

  const jumpToLatest = useCallback(() => {
    shouldFollowLatestRef.current = true;
    initialLatestScrollRef.current = false;
    setShowJumpToLatest(false);
    scrollToLatest(true);
  }, [scrollToLatest]);

  useEffect(() => {
    if (!mentionTrigger || !workspace) {
      setMentionEntries([]);
      return;
    }

    const controller = new AbortController();
    const url = new URL(buildHttpUrl(settings.serverUrl, '/v1/workspace/entries'));
    url.searchParams.set('cwd', workspace.path);
    url.searchParams.set('query', mentionTrigger.query);
    url.searchParams.set('limit', '40');

    const headers = settings.authToken
      ? { Authorization: `Bearer ${settings.authToken}` }
      : undefined;

    fetch(url.toString(), { headers, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`workspace entries returned ${response.status}`);
        }
        return response.json() as Promise<{ entries?: WorkspaceEntry[] }>;
      })
      .then((json) => {
        if (!controller.signal.aborted) {
          setMentionEntries(Array.isArray(json.entries) ? json.entries : []);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setMentionEntries([]);
          console.warn(error);
        }
      });

    return () => controller.abort();
  }, [mentionTrigger?.query, mentionTrigger?.start, settings.authToken, settings.serverUrl, workspace]);

  const selectMention = useCallback((item: MentionSuggestion) => {
    if (!mentionTrigger) {
      return;
    }
    setChatDraft((current) => insertMention(current, mentionTrigger, item.insertText));
    const nextCursor = mentionTrigger.start + item.insertText.length;
    setComposerSelection({ start: nextCursor, end: nextCursor });
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }, [mentionTrigger, setChatDraft]);

  const appendComposerAttachments = useCallback((items: ComposerAttachmentDraft[]) => {
    if (items.length === 0) {
      return;
    }

    let rejected = 0;
    setComposerAttachments((current) => {
      const next = [...current];
      let fileBytes = next.reduce((total, attachment) => total + (attachment.kind === 'file' ? (attachment.sizeBytes ?? 0) : 0), 0);

      for (const item of items) {
        if (next.length >= MAX_COMPOSER_ATTACHMENTS) {
          rejected += 1;
          continue;
        }
        const sizeBytes = item.sizeBytes ?? 0;
        if (item.kind === 'image' && sizeBytes > MAX_IMAGE_ATTACHMENT_BYTES) {
          rejected += 1;
          continue;
        }
        if (item.kind === 'file' && sizeBytes > 0 && fileBytes + sizeBytes > MAX_FILE_ATTACHMENT_BYTES) {
          rejected += 1;
          continue;
        }
        next.push(item);
        if (item.kind === 'file') {
          fileBytes += sizeBytes;
        }
      }

      return next;
    });

    if (rejected > 0) {
      Alert.alert(
        '附件已部分忽略',
        `最多 ${MAX_COMPOSER_ATTACHMENTS} 个附件，图片单个不超过 ${formatBytes(MAX_IMAGE_ATTACHMENT_BYTES)}，非图片文件总大小不超过 ${formatBytes(MAX_FILE_ATTACHMENT_BYTES)}。`,
      );
    }
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }, [setComposerAttachments]);

  const removeComposerAttachment = useCallback((attachmentIdValue: string) => {
    setComposerAttachments((current) => current.filter((item) => item.id !== attachmentIdValue));
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }, [setComposerAttachments]);

  const removeSelectedSkill = useCallback((skill: SelectedSkillAttachment) => {
    setSelectedSkills((current) => current.filter((item) => item.name !== skill.name || item.path !== skill.path));
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }, [setSelectedSkills]);

  const addClipboardAttachment = useCallback(async () => {
    try {
      if (await Clipboard.hasImageAsync()) {
        const image = await Clipboard.getImageAsync({ format: 'png' });
        if (!image?.data) {
          Alert.alert('读取剪贴板失败', '没有拿到图片数据。');
          return;
        }

        appendComposerAttachments([
          {
            id: attachmentId(),
            kind: 'image',
            name: `clipboard-${Date.now()}.png`,
            mimeType: 'image/png',
            sizeBytes: null,
            dataUrl: image.data,
            source: 'clipboard',
          },
        ]);
        setAttachmentMenuVisible(false);
        return;
      }

      const raw = (await Clipboard.getStringAsync()).trim();
      if (raw.startsWith('data:image/')) {
        const mimeType = mimeTypeFromDataUrl(raw) || 'image/png';
        appendComposerAttachments([
          {
            id: attachmentId(),
            kind: 'image',
            name: `clipboard-${Date.now()}.${mimeType.split('/').pop() || 'png'}`,
            mimeType,
            sizeBytes: estimatedBytesFromBase64(base64FromDataUrl(raw)),
            dataUrl: raw,
            source: 'clipboard',
          },
        ]);
        setAttachmentMenuVisible(false);
        return;
      }

      Alert.alert('剪贴板里没有可用图片', '请先复制一张图片后再粘贴。');
      setAttachmentMenuVisible(false);
    } catch (error) {
      Alert.alert('粘贴失败', error instanceof Error ? error.message : '无法从剪贴板读取图片。');
    }
  }, [appendComposerAttachments]);

  const pickLibraryAttachments = useCallback(async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('需要相册权限', '允许相册权限后才能从相册选择图片。');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        base64: true,
        quality: 1,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const drafts: ComposerAttachmentDraft[] = [];
      for (const asset of result.assets) {
        const name = asset.fileName || `photo-${Date.now()}.jpg`;
        const mimeType = asset.mimeType || inferMimeType(name, 'image/jpeg');
        const sizeBytes = await resolveFileSizeBytes(asset.uri, asset.fileSize);
        if ((sizeBytes ?? 0) > MAX_IMAGE_ATTACHMENT_BYTES) {
          continue;
        }
        const { dataUrl } = await readBase64DataUrl(asset.uri, mimeType, asset.base64 ?? null);
        drafts.push({
          id: attachmentId(),
          kind: 'image',
          name,
          mimeType,
          sizeBytes,
          dataUrl,
          source: 'library',
        });
      }

      appendComposerAttachments(drafts);
      setAttachmentMenuVisible(false);
    } catch (error) {
      Alert.alert('选择图片失败', error instanceof Error ? error.message : '无法从相册导入图片。');
    }
  }, [appendComposerAttachments]);

  const pickFileAttachments = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const drafts: ComposerAttachmentDraft[] = [];
      for (const asset of result.assets) {
        const name = asset.name || fileNameFromUri(asset.uri, 'attachment');
        const mimeType = asset.mimeType || inferMimeType(name);
        const sizeBytes = await resolveFileSizeBytes(asset.uri, asset.size);
        const attachmentKind = isImageMimeType(mimeType) ? 'image' : 'file';
        const sizeLimit = attachmentKind === 'image' ? MAX_IMAGE_ATTACHMENT_BYTES : MAX_FILE_ATTACHMENT_BYTES;
        if ((sizeBytes ?? 0) > sizeLimit) {
          continue;
        }
        const textContent = await readTextAttachmentContent(asset.uri, name, mimeType, sizeBytes);
        const { dataUrl, sizeBytes: dataSizeBytes } = await readBase64DataUrl(asset.uri, mimeType, asset.base64 ?? null);
        drafts.push({
          id: attachmentId(),
          kind: attachmentKind,
          name,
          mimeType,
          sizeBytes: sizeBytes ?? dataSizeBytes,
          dataUrl,
          textContent,
          source: 'file',
        });
      }

      appendComposerAttachments(drafts);
      setAttachmentMenuVisible(false);
    } catch (error) {
      Alert.alert('选择文件失败', error instanceof Error ? error.message : '无法打开文件选择器。');
    }
  }, [appendComposerAttachments]);

  const toggleProgressId = useCallback((id: string, collapsed: boolean) => {
    setExpandedProgressIds((current) => {
      const next = new Set(current);
      if (collapsed) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);
  const toggleProgressEntry = useCallback((entry: TimelineEntry, collapsed: boolean) => {
    toggleProgressId(entry.id, collapsed);
  }, [toggleProgressId]);

  useEffect(() => {
    const activeTargets = new Map<string, string[]>();
    for (const request of pendingRequests) {
      const targetIds = pendingRequestExpansionTargets.get(request.requestId);
      if (targetIds?.length) {
        activeTargets.set(request.requestId, targetIds);
      }
    }

    setExpandedProgressIds((current) => {
      let next = current;
      const ensureNext = () => {
        if (next === current) {
          next = new Set(current);
        }
      };

      for (const [requestId, expandedIds] of Array.from(autoExpandedRequestIdsRef.current.entries())) {
        const targetIds = activeTargets.get(requestId) ?? [];
        const targetIdSet = new Set(targetIds);
        const keptIds: string[] = [];

        for (const id of expandedIds) {
          if (targetIdSet.has(id)) {
            keptIds.push(id);
            continue;
          }

          if (autoExpandedProgressIdsRef.current.has(id)) {
            ensureNext();
            next.delete(id);
            autoExpandedProgressIdsRef.current.delete(id);
          }
        }

        if (targetIds.length) {
          autoExpandedRequestIdsRef.current.set(requestId, keptIds);
        } else {
          autoExpandedRequestIdsRef.current.delete(requestId);
        }
      }

      for (const [requestId, targetIds] of activeTargets) {
        const trackedIds = new Set(autoExpandedRequestIdsRef.current.get(requestId) ?? []);

        for (const id of targetIds) {
          if (!next.has(id)) {
            ensureNext();
            next.add(id);
            autoExpandedProgressIdsRef.current.add(id);
            trackedIds.add(id);
          } else if (autoExpandedProgressIdsRef.current.has(id)) {
            trackedIds.add(id);
          }
        }

        if (trackedIds.size) {
          autoExpandedRequestIdsRef.current.set(requestId, [...trackedIds]);
        }
      }

      return next === current ? current : next;
    });
  }, [pendingRequestExpansionTargets, pendingRequests]);

  const collapseAutoExpandedRequest = useCallback((requestId: string) => {
    const expandedIds = autoExpandedRequestIdsRef.current.get(requestId) ?? [];
    autoExpandedRequestIdsRef.current.delete(requestId);

    if (!expandedIds.length) {
      return;
    }

    setExpandedProgressIds((current) => {
      const next = new Set(current);
      let changed = false;

      for (const id of expandedIds) {
        if (!autoExpandedProgressIdsRef.current.has(id)) {
          continue;
        }
        autoExpandedProgressIdsRef.current.delete(id);
        changed = next.delete(id) || changed;
      }

      return changed ? next : current;
    });
  }, []);

  const handleApprovalResponse = useCallback(
    (accepted: boolean, request: PendingRequest) => {
      const sent = sendApprovalResponse(accepted, request);
      if (sent) {
        collapseAutoExpandedRequest(request.requestId);
      }
    },
    [collapseAutoExpandedRequest, sendApprovalResponse],
  );

  useEffect(() => {
    selectConversation(route.params.workspaceId, route.params.conversationId);
  }, [route.params.conversationId, route.params.workspaceId, selectConversation]);

  useEffect(() => {
    shouldFollowLatestRef.current = true;
    initialLatestScrollRef.current = true;
    setShowJumpToLatest(false);
    scrollToLatest(false);
  }, [route.params.conversationId, scrollToLatest]);

  useEffect(() => {
    if (shouldFollowLatestRef.current) {
      scrollToLatest(false);
    }
  }, [keyboardInset, scrollToLatest]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <ConversationHeaderTitle
          title={chatHeaderTitle}
          mode={conversation?.mode ?? 'implement'}
          goalLabel={conversation ? compactGoalLabel(conversation) : 'No goal'}
          localState={conversation?.localAdapterState ?? 'idle'}
        />
      ),
      headerRight: () => <HeaderIconButton label="..." onPress={() => setMenuVisible(true)} />,
    });
  }, [
    conversation?.goalObjective,
    conversation?.goalStatus,
    conversation?.localAdapterState,
    conversation?.mode,
    chatHeaderTitle,
    navigation,
  ]);

  if (!workspace || !conversation) {
    return (
      <Surface className="flex-1 items-center justify-center bg-background p-5">
        <EmptyState text="对话不存在。请返回后重新选择。" />
      </Surface>
    );
  }

  return (
    <Surface className="flex-1 bg-background" style={{ paddingBottom: keyboardInset }}>
      {lastError ? (
        <Surface variant="secondary" className="mx-3 mt-2 rounded-lg px-3 py-2">
          <HeroText className="text-sm text-danger">{lastError}</HeroText>
        </Surface>
      ) : null}

      <View style={styles.messageArea}>
        <ScrollView
          ref={messageScrollRef}
          style={styles.messageScroller}
          contentContainerStyle={styles.messageList}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={handleMessageContentSizeChange}
          onScroll={handleMessageScroll}
          scrollEventThrottle={80}
        >
          {conversationMessages.length === 0 ? (
            <EmptyState text="这是一段新的对话。" />
          ) : (
            conversationRenderItems.map((item) => {
              if (item.type === 'executionGroup') {
                const manuallyExpanded = expandedProgressIds.has(item.id);
                const collapsed = !manuallyExpanded;
                return (
                  <ExecutionGroupBubble
                    key={item.id}
                    id={item.id}
                    entries={item.entries}
                    collapsed={collapsed}
                    compactItems
                    expandedProgressIds={expandedProgressIds}
                    pendingRequestById={pendingRequestById}
                    onToggleGroup={toggleProgressId}
                    onToggleProgress={toggleProgressEntry}
                    onApprovalResponse={handleApprovalResponse}
                  />
                );
              }

              const entry = item.entry;
              const collapsible = isCollapsibleProgressEntry(entry);
              const manuallyExpanded = expandedProgressIds.has(entry.id);
              const collapsed = collapsible ? !manuallyExpanded : false;
              return (
                <MessageBubble
                  key={entry.id}
                  entry={entry}
                  collapsed={collapsed}
                  collapsible={collapsible}
                  pendingRequest={entry.requestId ? pendingRequestById.get(entry.requestId) : undefined}
                  onToggleProgress={toggleProgressEntry}
                  onApprovalResponse={handleApprovalResponse}
                />
              );
            })
          )}
        </ScrollView>

        {showJumpToLatest ? (
          <Button
            isIconOnly
            size="sm"
            variant="secondary"
            accessibilityLabel="跳到最新消息"
            onPress={jumpToLatest}
            className="absolute bottom-3 self-center rounded-lg"
          >
            <StyledIonicons name="arrow-down" size={17} className="text-foreground" />
          </Button>
        ) : null}
      </View>

      <View style={[styles.composer, { paddingBottom: composerPaddingBottom }]}>
        {slashSuggestions.length > 0 ? (
          <Surface variant="secondary" className="mb-2 overflow-hidden rounded-lg">
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.slashSuggestionScroll}
              contentContainerStyle={styles.slashSuggestionContent}
            >
              {slashSuggestions.map((item) => (
                <Button
                  key={item.command}
                  variant="ghost"
                  className="min-h-12 justify-start rounded-none px-3"
                  onPress={() => {
                    if (item.command === '/skills') {
                      sendSlashCommand('/skills', route.params.conversationId);
                      setChatDraft('');
                      setComposerSelection(DEFAULT_COMPOSER_SELECTION);
                      return;
                    }
                    const nextText = `${item.command} `;
                    setChatDraft(nextText);
                    setComposerSelection({ start: nextText.length, end: nextText.length });
                  }}
                >
                  <View className="min-w-0 flex-1">
                    <HeroText className="font-semibold text-foreground" numberOfLines={1}>{item.command}</HeroText>
                    <HeroText className="text-xs text-muted" numberOfLines={1}>{item.description || item.title}</HeroText>
                  </View>
                </Button>
              ))}
            </ScrollView>
          </Surface>
        ) : null}
        {mentionSuggestions.length > 0 ? (
          <Surface variant="secondary" className="mb-2 overflow-hidden rounded-lg">
            {mentionSuggestions.map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                className="min-h-12 justify-start rounded-none px-3"
                onPress={() => selectMention(item)}
              >
                <View className="h-8 w-8 items-center justify-center rounded-md bg-accent-soft">
                  <HeroText className="text-sm font-semibold text-accent-soft-foreground">@</HeroText>
                </View>
                <View className="min-w-0 flex-1">
                  <HeroText className="font-semibold text-foreground" numberOfLines={1}>{item.title}</HeroText>
                  <HeroText className="text-xs text-muted" numberOfLines={1}>{item.description}</HeroText>
                </View>
              </Button>
            ))}
          </Surface>
        ) : null}
        {composerAttachments.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachmentRail}>
            {composerAttachments.map((attachment) => (
              <View key={attachment.id} style={styles.attachmentChip}>
                <View style={styles.attachmentPreview}>
                  {attachment.kind === 'image' ? (
                    <Image source={{ uri: attachment.dataUrl }} style={styles.attachmentPreviewImage} />
                  ) : (
                    <Text style={styles.attachmentPreviewText}>FILE</Text>
                  )}
                </View>
                <View style={styles.attachmentChipMain}>
                  <Text style={styles.attachmentChipName} numberOfLines={1}>
                    {attachment.name}
                  </Text>
                  <Text style={styles.attachmentChipMeta} numberOfLines={1}>
                    {attachment.kind === 'image' ? '图片' : '文件'} · {formatBytes(attachment.sizeBytes)}
                  </Text>
                </View>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  accessibilityLabel={`移除附件 ${attachment.name}`}
                  onPress={() => removeComposerAttachment(attachment.id)}
                  className="rounded-md"
                >
                  <StyledIonicons name="close" size={14} className="text-muted" />
                </Button>
              </View>
            ))}
          </ScrollView>
        ) : null}
        {selectedSkills.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachmentRail}>
            {selectedSkills.map((skill) => (
              <View key={skillIdFromPath(skill.name, skill.path)} style={styles.skillComposerChip}>
                <View style={styles.skillComposerIcon}>
                  <StyledIonicons name="flash" size={16} className="text-accent-soft-foreground" />
                </View>
                <View style={styles.attachmentChipMain}>
                  <Text style={styles.attachmentChipName} numberOfLines={1}>{skill.displayName || skill.name}</Text>
                  <Text style={styles.attachmentChipMeta} numberOfLines={1}>{skill.name}</Text>
                </View>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  accessibilityLabel={`移除 Skill ${skill.displayName || skill.name}`}
                  onPress={() => removeSelectedSkill(skill)}
                  className="rounded-md"
                >
                  <StyledIonicons name="close" size={14} className="text-muted" />
                </Button>
              </View>
            ))}
          </ScrollView>
        ) : null}
        <View style={styles.composerInputRow}>
          <Button
            isIconOnly
            size="md"
            variant="secondary"
            accessibilityLabel="添加附件"
            onPress={() => setAttachmentMenuVisible(true)}
            className="rounded-lg"
          >
            <StyledIonicons name="attach" size={19} className="text-foreground" />
          </Button>
          <TextInput
            ref={composerInputRef}
            value={chatDraft}
            onChangeText={setChatDraft}
            onSelectionChange={(event) => setComposerSelection(event.nativeEvent.selection)}
            onKeyPress={(event) => {
              if (event.nativeEvent.key === 'Escape' && isThinking) {
                stopThinking(route.params.conversationId);
              }
            }}
            selection={composerSelection}
            placeholder="输入消息，@ 引用文件，/ 输入命令"
            placeholderTextColor="#7a8391"
            style={styles.composerInput}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.composerActions}>
            {turnId ? (
              <Button
                isIconOnly
                size="md"
                variant="danger-soft"
                accessibilityLabel="中断当前任务"
                onPress={() => stopThinking(route.params.conversationId)}
                className="rounded-lg"
              >
                <StyledIonicons name="stop" size={17} className="text-danger-soft-foreground" />
              </Button>
            ) : null}
            <Button
              isIconOnly
              size="md"
              variant="primary"
              accessibilityLabel="发送消息"
              onPress={() => submitChat(route.params.conversationId)}
              className="rounded-lg"
            >
              <StyledIonicons name="arrow-up" size={18} className="text-accent-foreground" />
            </Button>
          </View>
        </View>
      </View>

      <Modal visible={menuVisible} animationType="fade" transparent onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuVisible(false)}>
          <Card className="max-h-[82%] w-[260px] rounded-lg">
            <Card.Title numberOfLines={1}>{workspace.name}</Card.Title>
            <ScrollView style={styles.menuScroll} contentContainerStyle={styles.menuScrollContent}>
              <MenuItem title="Thread Details" onPress={() => runThreadMenuAction(conversation.id, 'detail')} close={() => setMenuVisible(false)} />
              <MenuItem title="Thread History" onPress={() => runThreadMenuAction(conversation.id, 'history')} close={() => setMenuVisible(false)} />
              <MenuItem title="Thread Turns" onPress={() => runThreadMenuAction(conversation.id, 'turns')} close={() => setMenuVisible(false)} />
              <MenuItem title="Turn Items" onPress={() => runThreadMenuAction(conversation.id, 'items')} close={() => setMenuVisible(false)} />
              <MenuItem title="Loaded Threads" onPress={() => runThreadMenuAction(conversation.id, 'loaded')} close={() => setMenuVisible(false)} />
              <MenuItem title="Resume Thread" onPress={() => runThreadMenuAction(conversation.id, 'resume')} close={() => setMenuVisible(false)} />
              <MenuItem title="Fork Thread" onPress={() => runThreadMenuAction(conversation.id, 'fork')} close={() => setMenuVisible(false)} />
              <MenuItem title="Compact Thread" onPress={() => runThreadMenuAction(conversation.id, 'compact')} close={() => setMenuVisible(false)} />
              <MenuItem title="Rollback 1 Turn" onPress={() => runThreadMenuAction(conversation.id, 'rollback')} close={() => setMenuVisible(false)} />
              <MenuItem title="Thread Metadata" onPress={() => runThreadMenuAction(conversation.id, 'metadata')} close={() => setMenuVisible(false)} />
              <MenuItem title="Thread Memory" onPress={() => runThreadMenuAction(conversation.id, 'memory')} close={() => setMenuVisible(false)} />
              <MenuItem title="Shell Command" onPress={() => runThreadMenuAction(conversation.id, 'shell')} close={() => setMenuVisible(false)} />
              <MenuItem title="Inject Items" onPress={() => runThreadMenuAction(conversation.id, 'inject')} close={() => setMenuVisible(false)} />
              <MenuItem title="Clean Terminals" onPress={() => runThreadMenuAction(conversation.id, 'clean')} close={() => setMenuVisible(false)} />
              <MenuItem title="Unarchive Thread" onPress={() => runThreadMenuAction(conversation.id, 'unarchive')} close={() => setMenuVisible(false)} />
              <MenuItem title="Git Diff" onPress={() => openGitDiff(conversation.id)} close={() => setMenuVisible(false)} />
              <MenuItem
                title="Slash Commands"
                onPress={() => navigation.navigate('SlashCommands', { workspaceId: workspace.id, conversationId: conversation.id })}
                close={() => setMenuVisible(false)}
              />
              <MenuItem title="启动" onPress={() => runWorkspaceCommand(workspace, conversation, 'start')} close={() => setMenuVisible(false)} />
              <MenuItem title="状态" onPress={() => runWorkspaceCommand(workspace, conversation, 'status')} close={() => setMenuVisible(false)} />
              <MenuItem title="附加" onPress={() => runWorkspaceCommand(workspace, conversation, 'attach')} close={() => setMenuVisible(false)} />
              <MenuItem title="中断" onPress={() => runWorkspaceCommand(workspace, conversation, 'interrupt')} close={() => setMenuVisible(false)} />
              <MenuItem title="停止" onPress={() => runWorkspaceCommand(workspace, conversation, 'stop')} close={() => setMenuVisible(false)} />
              <MenuItem
                title="设置"
                onPress={() => navigation.navigate('Settings')}
                close={() => setMenuVisible(false)}
              />
              <MenuItem
                title="归档 Thread"
                danger
                onPress={() => runThreadMenuAction(conversation.id, 'archive')}
                close={() => setMenuVisible(false)}
              />
              <MenuItem
                title="取消订阅 Thread"
                danger
                onPress={() => runThreadMenuAction(conversation.id, 'unsubscribe')}
                close={() => setMenuVisible(false)}
              />
              <MenuItem
                title="移除工作区"
                danger
                onPress={() => {
                  removeWorkspace(workspace.id);
                  navigation.popToTop();
                }}
                close={() => setMenuVisible(false)}
              />
            </ScrollView>
          </Card>
        </Pressable>
      </Modal>

      <Modal
        visible={attachmentMenuVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setAttachmentMenuVisible(false)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setAttachmentMenuVisible(false)}>
          <Card className="w-[260px] gap-1 rounded-lg">
            <Card.Title>添加附件</Card.Title>
            <MenuItem
              title="从剪贴板粘贴"
              onPress={() => void addClipboardAttachment()}
              close={() => setAttachmentMenuVisible(false)}
            />
            <MenuItem
              title="从相册选择"
              onPress={() => void pickLibraryAttachments()}
              close={() => setAttachmentMenuVisible(false)}
            />
            <MenuItem
              title="选择文件"
              onPress={() => void pickFileAttachments()}
              close={() => setAttachmentMenuVisible(false)}
            />
          </Card>
        </Pressable>
      </Modal>
    </Surface>
  );
}

function SlashCommandsScreen({
  navigation,
  route,
  workspace,
  conversation,
  runThreadMenuAction,
  sendSlashCommand,
  openGitDiff,
}: NativeStackScreenProps<RootStackParamList, 'SlashCommands'> & {
  workspace: WorkspaceRecord | null;
  conversation: ConversationRecord | null;
  runThreadMenuAction: (conversationId: string, action: ThreadMenuAction) => void;
  sendSlashCommand: (input: string, conversationId?: string) => void;
  openGitDiff: (conversationId: string) => void;
}) {
  const runSlash = useCallback((command: string) => {
    if (!conversation) {
      Alert.alert('未选择对话', '请先回到一个 Codex 对话。');
      return;
    }
    sendSlashCommand(command, conversation.id);
  }, [conversation, sendSlashCommand]);

  const runThreadAction = useCallback((action: ThreadMenuAction) => {
    if (!conversation) {
      Alert.alert('未选择对话', '请先回到一个 Codex 对话。');
      return;
    }
    runThreadMenuAction(conversation.id, action);
  }, [conversation, runThreadMenuAction]);

  const openDiff = useCallback(() => {
    if (!conversation) {
      Alert.alert('未选择对话', '请先回到一个 Codex 对话。');
      return;
    }
    openGitDiff(conversation.id);
  }, [conversation, openGitDiff]);

  const openExperimental = useCallback(() => {
    navigation.navigate('Experimental', {
      workspaceId: workspace?.id ?? route.params.workspaceId,
      conversationId: conversation?.id ?? route.params.conversationId,
    });
  }, [conversation?.id, navigation, route.params.conversationId, route.params.workspaceId, workspace?.id]);

  const openCommandAction = useCallback((command: string) => {
    if (!conversation) {
      Alert.alert('未选择对话', '请先回到一个 Codex 对话。');
      return;
    }
    if (!slashCommandNeedsActionPage(command)) {
      runSlash(command);
      return;
    }
    navigation.navigate('SlashCommandAction', {
      workspaceId: workspace?.id ?? route.params.workspaceId,
      conversationId: conversation.id,
      command,
    });
  }, [conversation, navigation, route.params.workspaceId, runSlash, workspace?.id]);

  const slashGroups = SLASH_COMMAND_CATEGORY_ORDER
    .map((category) => ({
      category,
      commands: SLASH_COMMANDS.filter((item) => item.category === category),
    }))
    .filter((group) => group.commands.length > 0);

  return (
    <Surface className="flex-1 bg-background">
      <ScrollView contentContainerStyle={styles.pageContent}>
        <View style={styles.commandPageHeader}>
          <Text style={styles.commandPageTitle}>Slash Commands</Text>
          <Text style={styles.commandPageSubtitle} numberOfLines={2}>
            {workspace?.name || '当前工作区'} · {SLASH_COMMANDS.length} commands
          </Text>
        </View>

        <View style={styles.commandQuickPanel}>
          <Text style={styles.commandSectionTitle}>二级操作</Text>
          <View style={styles.commandActionGrid}>
            <ActionButton title="Thread 详情" onPress={() => runSlash('/status thread')} tone="ghost" />
            <ActionButton title="历史" onPress={() => runSlash('/status history')} tone="ghost" />
            <ActionButton title="Turns" onPress={() => runSlash('/status turns')} tone="ghost" />
            <ActionButton title="Items" onPress={() => runThreadAction('items')} tone="ghost" />
            <ActionButton title="Loaded" onPress={() => runSlash('/status loaded')} tone="ghost" />
            <ActionButton title="Memory" onPress={() => runSlash('/memories')} tone="ghost" />
            <ActionButton title="Metadata" onPress={() => runThreadAction('metadata')} tone="ghost" />
            <ActionButton title="Shell" onPress={() => runThreadAction('shell')} tone="ghost" />
            <ActionButton title="Inject" onPress={() => runThreadAction('inject')} tone="ghost" />
            <ActionButton title="Rollback" onPress={() => runThreadAction('rollback')} tone="ghost" />
            <ActionButton title="Compact" onPress={() => runSlash('/compact')} tone="ghost" />
            <ActionButton title="Clean" onPress={() => runSlash('/ps clean')} tone="ghost" />
            <ActionButton title="Diff" onPress={openDiff} tone="ghost" />
          </View>
        </View>

        {slashGroups.map((group) => (
          <View key={group.category} style={styles.commandSection}>
            <Text style={styles.commandSectionTitle}>{SLASH_COMMAND_CATEGORY_LABELS[group.category]}</Text>
            <View style={styles.commandList}>
              {group.commands.map((item) => (
                <Pressable
                  key={item.command}
                  style={styles.commandListItem}
                  onPress={() => {
                    if (item.command === '/diff') {
                      openDiff();
                      return;
                    }
                    if (item.command === '/experimental') {
                      openExperimental();
                      return;
                    }
                    if (item.command === '/settings') {
                      navigation.navigate('Settings');
                      return;
                    }
                    openCommandAction(item.command);
                  }}
                >
                  <View style={styles.commandListText}>
                    <Text style={styles.commandName} numberOfLines={1}>{item.command}</Text>
                    <Text style={styles.commandDescription} numberOfLines={2}>{item.description}</Text>
                  </View>
                  <StyledIonicons name="chevron-forward" size={16} className="text-muted" />
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </Surface>
  );
}

function SlashCommandActionScreen({
  navigation,
  route,
  workspace,
  conversation,
  settings,
  modelCatalog,
  modelCatalogStatus,
  modelCatalogError,
  refreshModelCatalog,
  applyWorkspaceModelSelection,
  sendSlashCommand,
  openGitDiff,
}: NativeStackScreenProps<RootStackParamList, 'SlashCommandAction'> & {
  workspace: WorkspaceRecord | null;
  conversation: ConversationRecord | null;
  settings: ConnectionSettings;
  modelCatalog: CodexModelCatalogItem[];
  modelCatalogStatus: 'idle' | 'loading' | 'ready' | 'error';
  modelCatalogError: string;
  refreshModelCatalog: () => boolean;
  applyWorkspaceModelSelection: (conversationId: string, model: string, reasoningEffort: string | null) => void;
  sendSlashCommand: (input: string, conversationId?: string) => void;
  openGitDiff: (conversationId: string) => void;
}) {
  const command = canonicalSlashCommand(route.params.command);
  const definition = slashCommandDefinition(command);
  const title = definition?.title ?? command.replace(/^\//, '');
  const description = definition?.description ?? '该命令不在当前 Codex 命令表中。';
  const [textValue, setTextValue] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState<string | null>(
    normalizeReasoningEffort(workspace?.reasoningEffort ?? settings.defaultReasoningEffort),
  );
  const safeCatalog = modelCatalog.length ? modelCatalog : FALLBACK_CODEX_MODELS;
  const currentModel = workspace?.model || settings.defaultModel;
  const activeConversationId = conversation?.id ?? route.params.conversationId;

  useEffect(() => {
    setTextValue('');
    setReasoningEffort(normalizeReasoningEffort(workspace?.reasoningEffort ?? settings.defaultReasoningEffort));
  }, [command, settings.defaultReasoningEffort, workspace?.reasoningEffort]);

  const runSlash = useCallback((input: string) => {
    if (!conversation) {
      Alert.alert('未选择对话', '请先回到一个 Codex 对话。');
      return;
    }
    sendSlashCommand(input, conversation.id);
  }, [conversation, sendSlashCommand]);

  const commandWithText = useCallback((base: string) => {
    const trimmed = textValue.trim();
    runSlash(trimmed ? `${base} ${trimmed}` : base);
  }, [runSlash, textValue]);

  const openSettings = useCallback(() => {
    navigation.navigate('Settings');
  }, [navigation]);

  const openDiff = useCallback(() => {
    if (!conversation) {
      Alert.alert('未选择对话', '请先回到一个 Codex 对话。');
      return;
    }
    openGitDiff(conversation.id);
  }, [conversation, openGitDiff]);

  const renderModelControls = () => (
    <>
      <View style={styles.commandDetailCard}>
        <Text style={styles.commandDetailLabel}>当前模型</Text>
        <Text style={styles.commandDetailValue}>{modelDisplayLabel(currentModel, safeCatalog)}</Text>
        <Text style={styles.commandDetailHint}>Reasoning: {reasoningEffortLabel(workspace?.reasoningEffort ?? settings.defaultReasoningEffort)}</Text>
        <View style={styles.commandActionGrid}>
          <ActionButton title="刷新模型" onPress={refreshModelCatalog} tone="ghost" disabled={modelCatalogStatus === 'loading'} />
          <ActionButton title="手动应用" onPress={() => commandWithText('/model')} tone="ghost" />
        </View>
        {modelCatalogError ? <Text style={styles.warningText}>{modelCatalogError}</Text> : null}
        <TextInput
          style={styles.input}
          value={textValue}
          onChangeText={setTextValue}
          placeholder="gpt-5.5 high 或 --model gpt-5.5 --effort high"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <View style={styles.commandDetailCard}>
        <Text style={styles.commandSectionTitle}>模型列表</Text>
        <ScrollView style={styles.modelPickerList} contentContainerStyle={styles.modelPickerListContent}>
          {safeCatalog.map((model) => {
            const selected = model.model === currentModel;
            const defaultEffort = model.defaultReasoningEffort ?? defaultReasoningForModel(model.model, safeCatalog);
            return (
              <Pressable
                key={model.model}
                style={[styles.modelOption, selected ? styles.modelOptionActive : null]}
                onPress={() => {
                  if (!conversation) {
                    return;
                  }
                  applyWorkspaceModelSelection(conversation.id, model.model, defaultEffort);
                }}
              >
                <View style={styles.modelOptionHeader}>
                  <Text style={[styles.modelOptionTitle, selected ? styles.modelOptionTitleActive : null]} numberOfLines={1}>
                    {model.displayName || model.model}
                  </Text>
                  {model.isDefault ? <Text style={styles.modelDefaultBadge}>default</Text> : null}
                </View>
                {model.description ? <Text style={styles.modelOptionDescription} numberOfLines={2}>{model.description}</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
        <ReasoningEffortSelector
          label="思考强度"
          options={reasoningOptionsForModel(currentModel, safeCatalog)}
          value={reasoningEffort}
          defaultValue={defaultReasoningForModel(currentModel, safeCatalog)}
          onChange={(value) => {
            setReasoningEffort(value);
            if (conversation) {
              applyWorkspaceModelSelection(conversation.id, currentModel, value);
            }
          }}
        />
      </View>
    </>
  );

  const renderPermissionsControls = () => (
    <View style={styles.commandDetailCard}>
      <Text style={styles.commandDetailLabel}>当前权限</Text>
      <Text style={styles.commandDetailValue}>{workspace?.approvalPolicy || settings.approvalPolicy} · {workspace?.sandboxMode || settings.sandboxMode}</Text>
      {PERMISSION_PRESETS.map((preset) => (
        <Pressable key={preset.id} style={styles.commandChoiceItem} onPress={() => runSlash(`/permissions ${preset.id}`)}>
          <View style={styles.commandListText}>
            <Text style={styles.commandName}>{preset.title}</Text>
            <Text style={styles.commandDescription}>{preset.description}</Text>
          </View>
          <StyledIonicons name="checkmark-circle-outline" size={18} className="text-muted" />
        </Pressable>
      ))}
    </View>
  );

  const renderThreadControls = () => {
    if (command === '/rename') {
      return (
        <View style={styles.commandDetailCard}>
          <TextInput style={styles.input} value={textValue} onChangeText={setTextValue} placeholder={conversation?.title || 'New thread name'} />
          <ActionButton title="重命名" onPress={() => commandWithText('/rename')} />
        </View>
      );
    }
    if (command === '/goal') {
      return (
        <View style={styles.commandDetailCard}>
          <Text style={styles.commandDetailLabel}>当前目标</Text>
          <Text style={styles.commandDetailHint}>{conversation?.goalObjective || 'none'} · {conversation?.goalStatus || 'unknown'}</Text>
          <TextInput style={[styles.input, styles.inputMultiline]} value={textValue} onChangeText={setTextValue} placeholder="Objective" multiline />
          <View style={styles.commandActionGrid}>
            <ActionButton title="设置目标" onPress={() => commandWithText('/goal set')} />
            <ActionButton title="查看" onPress={() => runSlash('/goal')} tone="ghost" />
            <ActionButton title="暂停" onPress={() => runSlash('/goal pause')} tone="ghost" />
            <ActionButton title="继续" onPress={() => runSlash('/goal resume')} tone="ghost" />
            <ActionButton title="清除" onPress={() => runSlash('/goal clear')} tone="danger" />
          </View>
        </View>
      );
    }
    if (command === '/resume') {
      return (
        <View style={styles.commandDetailCard}>
          <Text style={styles.commandDetailHint}>Codex 支持按会话 id/name resume；当前移动端协议已实现当前 thread resume 和 loaded thread 查询。</Text>
          <View style={styles.commandActionGrid}>
            <ActionButton title="恢复当前 thread" onPress={() => runSlash('/resume')} />
            <ActionButton title="查看 loaded threads" onPress={() => runSlash('/status loaded')} tone="ghost" />
          </View>
        </View>
      );
    }
    if (command === '/fork' || command === '/side') {
      return (
        <View style={styles.commandDetailCard}>
          <Text style={styles.commandDetailHint}>{command === '/side' ? '创建临时 side conversation。' : 'Fork 当前 Codex thread。'}</Text>
          <ActionButton title={command === '/side' ? '创建 Side' : 'Fork Thread'} onPress={() => runSlash(command)} />
        </View>
      );
    }
    return null;
  };

  const renderCatalogControls = () => {
    if (command === '/skills') {
      return (
        <View style={styles.commandDetailCard}>
          <Text style={styles.commandDetailHint}>打开 Skill 选择器，选择后会作为下一条消息的上下文注入。</Text>
          <View style={styles.commandActionGrid}>
            <ActionButton title="打开 Skills" onPress={() => runSlash('/skills')} />
            <ActionButton title="刷新 Skills" onPress={() => runSlash('/skills reload')} tone="ghost" />
          </View>
        </View>
      );
    }
    if (command === '/mcp') {
      return (
        <View style={styles.commandDetailCard}>
          <View style={styles.commandActionGrid}>
            <ActionButton title="MCP 状态" onPress={() => runSlash('/mcp')} />
            <ActionButton title="Verbose" onPress={() => runSlash('/mcp verbose')} tone="ghost" />
          </View>
        </View>
      );
    }
    if (command === '/hooks' || command === '/apps' || command === '/plugins') {
      return (
        <View style={styles.commandDetailCard}>
          <View style={styles.commandActionGrid}>
            <ActionButton title="读取列表" onPress={() => runSlash(command)} />
            {command === '/apps' ? <ActionButton title="强制刷新" onPress={() => runSlash('/apps refresh')} tone="ghost" /> : null}
          </View>
        </View>
      );
    }
    return null;
  };

  const renderRuntimeControls = () => {
    if (command === '/status') {
      return (
        <View style={styles.commandDetailCard}>
          <View style={styles.commandActionGrid}>
            <ActionButton title="Session 状态" onPress={() => runSlash('/status')} />
            <ActionButton title="Thread 详情" onPress={() => runSlash('/status thread')} tone="ghost" />
            <ActionButton title="历史" onPress={() => runSlash('/status history')} tone="ghost" />
            <ActionButton title="Turns" onPress={() => runSlash('/status turns')} tone="ghost" />
            <ActionButton title="Loaded" onPress={() => runSlash('/status loaded')} tone="ghost" />
          </View>
          <TextInput style={styles.input} value={textValue} onChangeText={setTextValue} placeholder="turn_id for items" autoCapitalize="none" />
          <ActionButton title="读取 Turn Items" onPress={() => commandWithText('/status items')} tone="ghost" />
        </View>
      );
    }
    if (command === '/ps' || command === '/stop') {
      return (
        <View style={styles.commandDetailCard}>
          <View style={styles.commandActionGrid}>
            <ActionButton title="列出后台任务" onPress={() => runSlash('/ps')} />
            <ActionButton title="清理后台终端" onPress={() => runSlash('/ps clean')} tone="ghost" />
            <ActionButton title="停止本地会话" onPress={() => runSlash('/stop')} tone="danger" />
          </View>
        </View>
      );
    }
    if (command === '/approve') {
      return (
        <View style={styles.commandDetailCard}>
          <View style={styles.commandActionGrid}>
            <ActionButton title="批准当前请求" onPress={() => runSlash('/approve')} />
            <ActionButton title="拒绝当前请求" onPress={() => runSlash('/approve deny')} tone="danger" />
            <ActionButton title="Guardian override" onPress={() => runSlash('/approve guardian')} tone="ghost" />
          </View>
        </View>
      );
    }
    if (command === '/logout' || command === '/quit' || command === '/exit') {
      return (
        <View style={styles.commandDetailCard}>
          <ActionButton title={command === '/logout' ? '登出 Codex' : '停止本地会话'} onPress={() => runSlash(command)} tone="danger" />
        </View>
      );
    }
    return null;
  };

  const renderPromptControls = () => {
    if (command === '/review') {
      return (
        <View style={styles.commandDetailCard}>
          <TextInput style={[styles.input, styles.inputMultiline]} value={textValue} onChangeText={setTextValue} placeholder="自定义 review instructions，可留空检查未提交变更" multiline />
          <ActionButton title="开始 Review" onPress={() => commandWithText('/review')} />
        </View>
      );
    }
    if (command === '/plan') {
      return (
        <View style={styles.commandDetailCard}>
          <TextInput style={[styles.input, styles.inputMultiline]} value={textValue} onChangeText={setTextValue} placeholder="Plan topic" multiline />
          <ActionButton title="进入 Plan" onPress={() => commandWithText('/plan')} />
        </View>
      );
    }
    return null;
  };

  const renderSettingsControls = () => {
    if (command === '/memories') {
      return (
        <View style={styles.commandDetailCard}>
          <View style={styles.commandActionGrid}>
            <ActionButton title="开启" onPress={() => runSlash('/memories on')} />
            <ActionButton title="关闭" onPress={() => runSlash('/memories off')} tone="ghost" />
            <ActionButton title="重置" onPress={() => runSlash('/memories reset')} tone="danger" />
          </View>
        </View>
      );
    }
    if (command === '/experimental') {
      return (
        <View style={styles.commandDetailCard}>
          <ActionButton title="打开实验功能" onPress={() => navigation.navigate('Experimental', { workspaceId: workspace?.id ?? route.params.workspaceId, conversationId: activeConversationId })} />
        </View>
      );
    }
    if (command === '/settings') {
      return (
        <View style={styles.commandDetailCard}>
          <ActionButton title="打开设置" onPress={openSettings} />
        </View>
      );
    }
    if (command === '/diff') {
      return (
        <View style={styles.commandDetailCard}>
          <ActionButton title="打开 Git Diff" onPress={openDiff} />
        </View>
      );
    }
    if (command === '/sandbox-add-read-dir') {
      return (
        <View style={styles.commandDetailCard}>
          <TextInput style={styles.input} value={textValue} onChangeText={setTextValue} placeholder="/absolute/path" autoCapitalize="none" />
          <ActionButton title="添加只读目录" onPress={() => commandWithText('/sandbox-add-read-dir')} />
        </View>
      );
    }
    return null;
  };

  const body =
    command === '/model'
      ? renderModelControls()
      : command === '/permissions'
        ? renderPermissionsControls()
        : renderThreadControls() ??
          renderCatalogControls() ??
          renderRuntimeControls() ??
          renderPromptControls() ??
          renderSettingsControls() ?? (
            <View style={styles.commandDetailCard}>
              <Text style={styles.commandDetailHint}>该命令在 Codex TUI 中是本地 TUI/IDE 配置或实验命令；移动端没有等价安全协议时只记录识别结果，不会把它作为普通 prompt 发送。</Text>
              <ActionButton title="执行兼容动作" onPress={() => runSlash(command)} tone="ghost" />
            </View>
          );

  return (
    <Surface className="flex-1 bg-background">
      <ScrollView contentContainerStyle={styles.pageContent}>
        <View style={styles.commandPageHeader}>
          <Text style={styles.commandPageTitle}>{title}</Text>
          <Text style={styles.commandPageSubtitle} numberOfLines={3}>{description}</Text>
          <Text style={styles.commandDetailCommand}>{command}</Text>
        </View>
        {body}
      </ScrollView>
    </Surface>
  );
}

function GitDiffScreen({
  workspace,
  conversation,
  diffState,
  requestGitDiff,
}: NativeStackScreenProps<RootStackParamList, 'GitDiff'> & {
  workspace: WorkspaceRecord | null;
  conversation: ConversationRecord | null;
  diffState: GitDiffState | null;
  requestGitDiff: (conversationId?: string) => Promise<boolean>;
}) {
  const status = diffState?.status ?? 'idle';
  const diff = diffState?.diff ?? '';
  const canRefresh = Boolean(conversation);
  const refresh = useCallback(() => {
    if (!conversation) {
      Alert.alert('未选择对话', '请先回到一个 Codex 对话。');
      return;
    }
    void requestGitDiff(conversation.id);
  }, [conversation, requestGitDiff]);
  const copyDiff = useCallback(async () => {
    await Clipboard.setStringAsync(diff);
    Alert.alert('已复制', 'Git diff 已复制到剪贴板。');
  }, [diff]);

  useEffect(() => {
    if (conversation && (!diffState || diffState.status === 'idle')) {
      void requestGitDiff(conversation.id);
    }
  }, [conversation?.id, diffState?.status, requestGitDiff]);

  return (
    <Surface className="flex-1 bg-background">
      <View style={styles.diffToolbar}>
        <View style={styles.diffToolbarText}>
          <Text style={styles.diffTitle} numberOfLines={1}>{workspace?.name || 'Git Diff'}</Text>
          <Text style={styles.diffSubtitle} numberOfLines={1}>
            {diffState?.sha ? `sha ${diffState.sha}` : workspace?.path || '当前工作区'}
          </Text>
        </View>
        <Button size="sm" variant="secondary" isDisabled={!canRefresh || status === 'loading'} onPress={refresh} className="rounded-lg">
          <Button.Label>刷新</Button.Label>
        </Button>
        <Button size="sm" variant="secondary" isDisabled={!diff} onPress={copyDiff} className="rounded-lg">
          <Button.Label>复制</Button.Label>
        </Button>
      </View>
      <ScrollView style={styles.diffScroll} contentContainerStyle={styles.diffContent}>
        {status === 'loading' ? (
          <View style={styles.diffEmptyState}>
            <ActivityIndicator />
            <Text style={styles.diffEmptyTitle}>正在读取 git diff</Text>
          </View>
        ) : status === 'error' ? (
          <View style={styles.diffEmptyState}>
            <Text style={styles.diffEmptyTitle}>读取失败</Text>
            <Text style={styles.diffEmptyText}>{diffState?.error || 'gitDiffToRemote 请求失败'}</Text>
          </View>
        ) : diff ? (
          <Text selectable style={styles.diffText}>{diff}</Text>
        ) : (
          <View style={styles.diffEmptyState}>
            <Text style={styles.diffEmptyTitle}>没有可显示的差异</Text>
            <Text style={styles.diffEmptyText}>当前工作区相对远端没有返回 git diff。</Text>
          </View>
        )}
      </ScrollView>
    </Surface>
  );
}

function ExperimentalScreen({
  workspace,
  conversation,
  features,
  setFeatures,
}: NativeStackScreenProps<RootStackParamList, 'Experimental'> & {
  workspace: WorkspaceRecord | null;
  conversation: ConversationRecord | null;
  features: ExperimentalFeatureSettings;
  setFeatures: React.Dispatch<React.SetStateAction<ExperimentalFeatureSettings>>;
}) {
  const enabledCount = EXPERIMENTAL_FEATURES.filter((feature) => features[feature.id]).length;
  const toggleFeature = useCallback((featureId: ExperimentalFeatureId, enabled: boolean) => {
    setFeatures((current) => ({
      ...current,
      [featureId]: enabled,
    }));
  }, [setFeatures]);

  const resetFeatures = useCallback(() => {
    setFeatures(EXPERIMENTAL_FEATURE_DEFAULTS);
  }, [setFeatures]);

  return (
    <Surface className="flex-1 bg-background">
      <ScrollView contentContainerStyle={styles.pageContent}>
        <View style={styles.commandPageHeader}>
          <Text style={styles.commandPageTitle}>Experimental</Text>
          <Text style={styles.commandPageSubtitle} numberOfLines={2}>
            {workspace?.name || '当前工作区'} · {conversation?.title || '当前对话'} · {enabledCount}/{EXPERIMENTAL_FEATURES.length} enabled
          </Text>
        </View>

        <View style={styles.experimentalSummary}>
          <View style={styles.experimentalSummaryText}>
            <Text style={styles.experimentalSummaryTitle}>测试性功能</Text>
            <Text style={styles.experimentalSummaryBody}>
              开关会保存在本机；关闭后不会删除任何已有对话或工作区数据。
            </Text>
          </View>
          <ActionButton title="重置" onPress={resetFeatures} tone="ghost" />
        </View>

        <View style={styles.commandList}>
          {EXPERIMENTAL_FEATURES.map((feature) => {
            const enabled = features[feature.id];
            return (
              <View key={feature.id} style={styles.experimentalFeatureItem}>
                <View style={styles.experimentalFeatureText}>
                  <View style={styles.experimentalFeatureHeader}>
                    <Text style={styles.experimentalFeatureTitle} numberOfLines={1}>{feature.title}</Text>
                    <Text style={styles.experimentalFeatureScope} numberOfLines={1}>{feature.scope}</Text>
                  </View>
                  <Text style={styles.experimentalFeatureDescription}>{feature.description}</Text>
                  <Text style={enabled ? styles.experimentalFeatureEnabled : styles.experimentalFeatureDisabled}>
                    {enabled ? '已开启' : '已关闭'}
                  </Text>
                </View>
                <Switch
                  value={enabled}
                  onValueChange={(value) => toggleFeature(feature.id, value)}
                  trackColor={{ false: '#d8e0e7', true: '#bfe8cf' }}
                  thumbColor={enabled ? '#19a463' : '#ffffff'}
                />
              </View>
            );
          })}
        </View>
      </ScrollView>
    </Surface>
  );
}

function SettingsScreen({
  settings,
  setSettings,
  modelCatalog,
  modelCatalogStatus,
  modelCatalogError,
  refreshModelCatalog,
  openDefaultModelPicker,
  serverVersion,
  activeWorkspace,
  pendingRequestCount,
  turnId,
  runtimeStatus,
  connectionState,
  connectionHealth,
  lastError,
  connect,
  closeSocket,
  refreshServerVersion,
}: NativeStackScreenProps<RootStackParamList, 'Settings'> & {
  settings: ConnectionSettings;
  setSettings: React.Dispatch<React.SetStateAction<ConnectionSettings>>;
  modelCatalog: CodexModelCatalogItem[];
  modelCatalogStatus: 'idle' | 'loading' | 'ready' | 'error';
  modelCatalogError: string;
  refreshModelCatalog: () => boolean;
  openDefaultModelPicker: () => void;
  serverVersion: ServerVersion | null;
  activeWorkspace: WorkspaceRecord | null;
  pendingRequestCount: number;
  turnId: string;
  runtimeStatus: RuntimeStatusState;
  connectionState: ConnectionState;
  connectionHealth: ConnectionHealth;
  lastError: string;
  connect: () => void;
  closeSocket: (manual?: boolean) => void;
  refreshServerVersion: () => void;
}) {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [pairingScannerVisible, setPairingScannerVisible] = useState(false);
  const [pairingScannerStatus, setPairingScannerStatus] = useState('对准后端配对二维码。');
  const pairingChunkCollectorRef = useRef<PairingChunkCollector | null>(null);
  const pairingScanBusyRef = useRef(false);
  const pairingScannerLastRawRef = useRef<string | null>(null);
  const isConnected = connectionState === 'open';
  const isConnecting = connectionState === 'connecting';
  const connectionActionTitle = isConnected || isConnecting ? '中断' : '连接';
  const connectionAction = isConnected || isConnecting ? () => closeSocket(true) : connect;
  const dotStyle =
    connectionState === 'open'
      ? styles.connectionDotOnline
      : connectionState === 'connecting'
        ? styles.connectionDotChecking
        : connectionState === 'error' || connectionHealth.status === 'offline'
          ? styles.connectionDotOffline
          : styles.connectionDotIdle;
  const encryptionLabel =
    settings.encryptionProtocol === 'none'
      ? '明文'
      : settings.encryptionProtocol === 'x25519'
        ? 'X25519'
        : 'ML-KEM-768';
  const currentModelName = activeWorkspace?.model || settings.defaultModel;
  const currentReasoningEffort = normalizeReasoningEffort(activeWorkspace?.reasoningEffort ?? settings.defaultReasoningEffort);
  const connectionChipColor = connectionState === 'open' ? 'success' : connectionState === 'error' || connectionHealth.status === 'offline' ? 'danger' : 'default';

  const openPairingScanner = useCallback(async () => {
    if (Platform.OS === 'web') {
      Alert.alert('当前平台不支持扫码', '请在移动端使用扫码，或手动粘贴二维码里的 JSON。');
      return;
    }
    if (!cameraPermission?.granted) {
      const next = await requestCameraPermission();
      if (!next.granted) {
        Alert.alert('需要相机权限', '允许相机权限后才能扫描后端配对二维码。');
        return;
      }
    }
    pairingChunkCollectorRef.current = null;
    setPairingScannerStatus('对准后端配对二维码。');
    pairingScannerLastRawRef.current = null;
    setPairingScannerVisible(true);
  }, [cameraPermission?.granted, requestCameraPermission]);

  const closePairingScanner = useCallback(() => {
    pairingChunkCollectorRef.current = null;
    pairingScanBusyRef.current = false;
    pairingScannerLastRawRef.current = null;
    setPairingScannerVisible(false);
    setPairingScannerStatus('对准后端配对二维码。');
  }, []);

  const applyPairingText = useCallback(async (raw: string) => {
    try {
      const pairing = await resolvePairingPayload(raw);
      setSettings((current) => applyPairingToSettings(current, pairing));
      closePairingScanner();
      const summary = `${pairing.serverUrl} · ${pairing.encryptionProtocol}`;
      const manualHint = pairing.importWarning
        ? `\n\n已先填写二维码中的基础信息，密钥或地址可手动调整后再连接。\n${pairing.importWarning}`
        : '\n\n可在连接前继续手动调整配置。';
      Alert.alert('已填写配对信息', `${summary}${manualHint}`);
    } catch (error) {
      Alert.alert('配对失败', error instanceof Error ? error.message : '二维码内容无效');
    }
  }, [closePairingScanner, setSettings]);

  const pastePairingFromClipboard = useCallback(async () => {
    const raw = await Clipboard.getStringAsync();
    await applyPairingText(raw);
  }, [applyPairingText]);

  const handlePairingScan = useCallback((result: BarcodeScanningResult) => {
    if (pairingScanBusyRef.current) {
      return;
    }
    if (pairingScannerLastRawRef.current === result.data) {
      return;
    }
    pairingScannerLastRawRef.current = result.data;
    pairingScanBusyRef.current = true;
    void (async () => {
      try {
        const frame = parsePairingQrFrame(result.data);
        if (frame.kind === 'pairing') {
          await applyPairingText(frame.raw);
          return;
        }

        const existing = pairingChunkCollectorRef.current;
        if (
          !existing ||
          existing.checksum !== frame.chunk.checksum ||
          existing.total !== frame.chunk.total
        ) {
          pairingChunkCollectorRef.current = {
            checksum: frame.chunk.checksum,
            total: frame.chunk.total,
            chunks: new Map(),
          };
          setPairingScannerStatus(
            `已开始收集分段二维码：0/${frame.chunk.total}`,
          );
        }

        const collector = pairingChunkCollectorRef.current;
        if (!collector) {
          throw new Error('无法收集分段二维码');
        }
        if (frame.chunk.index < 1 || frame.chunk.index > collector.total) {
          throw new Error('分段二维码序号无效');
        }
        if (!collector.chunks.has(frame.chunk.index)) {
          collector.chunks.set(frame.chunk.index, frame.chunk);
          setPairingScannerStatus(
            `已收集 ${collector.chunks.size}/${collector.total} 段，请继续扫描下一张。`,
          );
        } else {
          setPairingScannerStatus(
            `已扫描过第 ${frame.chunk.index}/${collector.total} 段，请切换到下一张二维码。`,
          );
        }
        if (collector.chunks.size === collector.total) {
          const assembled = assemblePairingQrChunkPayload([...collector.chunks.values()]);
          pairingChunkCollectorRef.current = null;
          await applyPairingText(assembled);
        }
      } catch (error) {
        pairingChunkCollectorRef.current = null;
        setPairingScannerStatus('扫描失败，请重新开始。');
        Alert.alert('配对失败', error instanceof Error ? error.message : '二维码内容无效');
      } finally {
        pairingScanBusyRef.current = false;
      }
    })();
  }, [applyPairingText]);

  return (
    <Surface className="flex-1 bg-background">
      <ScrollView contentContainerStyle={styles.pageContent}>
      <Card className="gap-4">
        <Card.Header className="items-center justify-between">
          <Card.Title>连接</Card.Title>
          <Chip color={connectionChipColor} size="sm" variant={connectionState === 'open' ? 'primary' : 'secondary'}>
            {connectionStateLabel(connectionState)}
          </Chip>
        </Card.Header>
        <Card.Body className="gap-4">
          <Surface variant="secondary" className="rounded-lg p-3">
            <View className="flex-row items-center gap-3">
              <View style={[styles.connectionDot, dotStyle]} />
              <View className="min-w-0 flex-1">
                <HeroText className="text-base font-semibold text-foreground">{connectionStateLabel(connectionState)}</HeroText>
                <HeroText className="mt-1 text-xs text-muted" numberOfLines={1}>
                  {healthLabelOf(connectionHealth)}
                </HeroText>
              </View>
              <HeroText className="text-sm font-semibold text-foreground">{latencyLabelOf(connectionHealth.latencyMs)}</HeroText>
            </View>
            <View className="mt-3 gap-1">
              <View className="flex-row justify-between gap-3">
                <HeroText className="text-xs text-muted">WebSocket: {runtimeStatus.socket}</HeroText>
                <HeroText className="text-xs text-muted">Transport: {runtimeStatus.transport.status}</HeroText>
              </View>
              <View className="flex-row justify-between gap-3">
                <HeroText className="text-xs text-muted">Daemon: {runtimeStatus.daemon}</HeroText>
                <HeroText className="text-xs text-muted">Codex: {runtimeStatus.codexAdapter}</HeroText>
              </View>
              <View className="flex-row justify-between gap-3">
                <HeroText className="text-xs text-muted">Turn: {runtimeStatus.turn}</HeroText>
                <HeroText className="text-xs text-muted">
                  {connectionHealth.lastCheckedAt ? `检测: ${nowLabel(connectionHealth.lastCheckedAt)}` : '检测: --'}
                </HeroText>
              </View>
            </View>
          </Surface>
            {runtimeStatus.transport.error ? (
              <Text style={styles.connectionErrorText} numberOfLines={2}>{runtimeStatus.transport.error}</Text>
            ) : null}
          <Field
            label="Server URL"
            value={settings.serverUrl}
            onChangeText={(value) => setSettings((current) => ({ ...current, serverUrl: value }))}
            onBlur={() => setSettings((current) => ({ ...current, serverUrl: normalizeServerUrl(current.serverUrl) }))}
            placeholder="http://127.0.0.1:7345"
          />
          <Field
            label="Auth token"
            value={settings.authToken}
            onChangeText={(value) => setSettings((current) => ({ ...current, authToken: value }))}
            placeholder="Bearer token"
            secureTextEntry
          />
          <Surface variant="secondary" className="gap-3 rounded-lg p-3">
            <HeroText className="text-sm font-semibold text-foreground">编辑加密</HeroText>
            <Row>
              <ActionButton
                title="无"
                onPress={() => setSettings((current) => ({ ...current, encryptionProtocol: 'none' }))}
                tone={settings.encryptionProtocol === 'none' ? 'solid' : 'ghost'}
              />
              <ActionButton
                title="后量子"
                onPress={() => setSettings((current) => ({ ...current, encryptionProtocol: 'ml-kem-768' }))}
                tone={settings.encryptionProtocol === 'ml-kem-768' ? 'solid' : 'ghost'}
              />
              <ActionButton
                title="X25519"
                onPress={() => setSettings((current) => ({ ...current, encryptionProtocol: 'x25519' }))}
                tone={settings.encryptionProtocol === 'x25519' ? 'solid' : 'ghost'}
              />
            </Row>
            <HeroText className="text-xs text-muted">当前: {encryptionLabel}</HeroText>
            <Field
              label="Key 密钥"
              value={settings.encryptionPublicKey}
              onChangeText={(value) => setSettings((current) => ({ ...current, encryptionPublicKey: value }))}
              placeholder="扫描一键配对二维码后自动填充"
              multiline
              inputStyle={styles.encryptionKeyInput}
            />
            <Row>
              <ActionButton title="扫码填写配对" onPress={openPairingScanner} tone="solid" />
              <ActionButton title="粘贴配对内容" onPress={pastePairingFromClipboard} tone="ghost" />
            </Row>
          </Surface>
          <Field
            label="Tenant id"
            value={settings.tenantId}
            onChangeText={(value) => setSettings((current) => ({ ...current, tenantId: value }))}
            placeholder="local"
          />
          <Row>
            <ActionButton
              title={connectionActionTitle}
              onPress={connectionAction}
              tone={isConnected || isConnecting ? 'danger' : 'solid'}
            />
            <ActionButton title="刷新版本" onPress={refreshServerVersion} tone="ghost" />
          </Row>
          {lastError ? <HeroText className="text-sm text-danger">{lastError}</HeroText> : null}
        </Card.Body>
      </Card>

      <Modal
        visible={pairingScannerVisible}
        animationType="slide"
        onRequestClose={closePairingScanner}
      >
        <View style={styles.scannerScreen}>
          <CameraView
            style={styles.scannerCamera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handlePairingScan}
          />
          <View style={styles.scannerFooter}>
            <Text style={styles.scannerTitle}>扫描 TodeX 配对二维码</Text>
            <Text style={styles.scannerStatus}>{pairingScannerStatus}</Text>
            <ActionButton title="关闭" onPress={closePairingScanner} tone="ghost" />
          </View>
        </View>
      </Modal>

      <Card className="gap-4">
        <Card.Header>
          <Card.Title>默认参数</Card.Title>
        </Card.Header>
        <Card.Body className="gap-4">
          <Field
            label="默认目录路径"
            value={settings.defaultWorkspacePath}
            onChangeText={(value) => setSettings((current) => ({ ...current, defaultWorkspacePath: value }))}
            placeholder="/home/dev/projects"
          />
          <Field
            label="默认模型"
            value={settings.defaultModel}
            onChangeText={(value) => setSettings((current) => ({ ...current, defaultModel: value }))}
            placeholder="gpt-5.5"
          />
          <Surface variant="secondary" className="gap-3 rounded-lg p-3">
            <View style={styles.modelControlHeader}>
              <View style={styles.modelControlTitleBlock}>
                <HeroText className="text-sm font-semibold text-foreground">模型选择</HeroText>
                <HeroText className="text-xs text-muted" numberOfLines={1}>
                  {modelDisplayLabel(settings.defaultModel, modelCatalog)} · {reasoningEffortLabel(settings.defaultReasoningEffort)}
                </HeroText>
              </View>
              {modelCatalogStatus === 'loading' ? <ActivityIndicator size="small" color="#17202a" /> : null}
            </View>
            <Row>
              <ActionButton title="选择模型" onPress={openDefaultModelPicker} tone="solid" />
              <ActionButton title="刷新列表" onPress={refreshModelCatalog} tone="ghost" disabled={modelCatalogStatus === 'loading'} />
            </Row>
            {modelCatalogError ? <HeroText className="text-sm text-warning">{modelCatalogError}</HeroText> : null}
          </Surface>
          <ReasoningEffortSelector
            label="默认思考强度"
            options={reasoningOptionsForModel(settings.defaultModel, modelCatalog)}
            value={normalizeReasoningEffort(settings.defaultReasoningEffort)}
            defaultValue={defaultReasoningForModel(settings.defaultModel, modelCatalog)}
            onChange={(value) => setSettings((current) => ({ ...current, defaultReasoningEffort: value }))}
          />
          <Field
            label="Approval policy"
            value={settings.approvalPolicy}
            onChangeText={(value) => setSettings((current) => ({ ...current, approvalPolicy: value }))}
            placeholder="on-request"
          />
          <Field
            label="Sandbox mode"
            value={settings.sandboxMode}
            onChangeText={(value) => setSettings((current) => ({ ...current, sandboxMode: value }))}
            placeholder="workspace-write"
          />
        </Card.Body>
      </Card>

      <Card className="gap-4">
        <Card.Header>
          <Card.Title>运行状态</Card.Title>
        </Card.Header>
        <Card.Body className="gap-2">
          <Diagnostic label="版本" value={serverVersion ? `${serverVersion.name} ${serverVersion.version}` : 'unknown'} />
          <Diagnostic label="数据目录" value={serverVersion?.data_dir ?? 'unknown'} />
          <Diagnostic label="工作区根目录" value={serverVersion?.workspace_root ?? 'unknown'} />
          <Diagnostic label="当前目录" value={activeWorkspace?.path ?? 'none'} />
          <Diagnostic label="当前模型" value={currentModelName || 'none'} />
          <Diagnostic label="思考强度" value={reasoningEffortLabel(currentReasoningEffort)} />
          <Diagnostic label="待处理请求" value={String(pendingRequestCount)} />
          <Diagnostic label="当前 Turn" value={turnId || 'unknown'} />
        </Card.Body>
      </Card>
      </ScrollView>
    </Surface>
  );
}

function MessageBubble({
  entry,
  collapsed = false,
  collapsible = false,
  hideTitle = false,
  pendingRequest,
  onToggleProgress,
  onApprovalResponse,
}: {
  entry: TimelineEntry;
  collapsed?: boolean;
  collapsible?: boolean;
  hideTitle?: boolean;
  pendingRequest?: PendingRequest;
  onToggleProgress?: (entry: TimelineEntry, collapsed: boolean) => void;
  onApprovalResponse?: (accepted: boolean, request: PendingRequest) => void;
}) {
  const outgoing = entry.kind === 'outgoing';
  const system = entry.kind === 'system';
  const copyText = async () => {
    const text = entry.subtitle || entry.title || entry.raw;
    if (!text) {
      return;
    }
    await Clipboard.setStringAsync(text);
    Alert.alert('已复制', '消息内容已复制到剪贴板。');
  };
  const bubbleClassName = [
    'max-w-[86%] rounded-lg px-3 py-2',
    outgoing ? 'self-end bg-accent' : system ? 'self-center bg-surface-secondary' : 'self-start bg-surface',
    collapsible ? 'border border-separator' : '',
  ].join(' ');
  const content = (
    <Surface className={bubbleClassName}>
      <View className="flex-row items-center gap-2">
        {collapsible ? (
          <HeroText className={outgoing ? 'text-accent-foreground' : 'text-muted'}>{collapsed ? '›' : '⌄'}</HeroText>
        ) : null}
        {!hideTitle ? (
          <HeroText className={`min-w-0 flex-1 text-xs font-semibold ${outgoing ? 'text-accent-foreground' : 'text-foreground'}`} numberOfLines={1}>
            {entry.title}
          </HeroText>
        ) : (
          <View style={styles.hiddenBubbleTitleSpacer} />
        )}
        <HeroText className={`text-[10px] ${outgoing ? 'text-accent-foreground' : 'text-muted'}`}>{nowLabel(entry.at)}</HeroText>
        <Text style={[styles.bubbleTime, outgoing && styles.bubbleTimeOutgoing]} numberOfLines={1}>
          {nowLabel(entry.at)}
        </Text>
      </View>
      {entry.subtitle && !collapsed ? (
        <HeroText selectable className={`mt-1 text-sm leading-5 ${outgoing ? 'text-accent-foreground' : 'text-foreground'}`}>{entry.subtitle}</HeroText>
      ) : null}
      {entry.subtitle && collapsed ? (
        <HeroText selectable className="mt-1 text-xs text-muted" numberOfLines={1}>
          {entry.subtitle}
        </HeroText>
      ) : null}
      {pendingRequest ? (
        <View style={styles.approvalActions}>
          <MiniButton title="同意" onPress={() => onApprovalResponse?.(true, pendingRequest)} />
          <MiniButton title="拒绝" onPress={() => onApprovalResponse?.(false, pendingRequest)} />
        </View>
      ) : null}
    </Surface>
  );

  return (
    <View className={`mb-2 ${outgoing ? 'items-end' : system ? 'items-center' : 'items-start'}`}>
      <Pressable
        onPress={collapsible ? () => onToggleProgress?.(entry, collapsed) : undefined}
        onLongPress={copyText}
        delayLongPress={360}
        style={[styles.bubblePressable, collapsible && styles.progressPressable]}
      >
        {content}
      </Pressable>
    </View>
  );
}

function ExecutionGroupBubble({
  id,
  entries,
  collapsed,
  compactItems,
  expandedProgressIds,
  pendingRequestById,
  onToggleGroup,
  onToggleProgress,
  onApprovalResponse,
}: {
  id: string;
  entries: TimelineEntry[];
  collapsed: boolean;
  compactItems: boolean;
  expandedProgressIds: Set<string>;
  pendingRequestById: Map<string, PendingRequest>;
  onToggleGroup: (id: string, collapsed: boolean) => void;
  onToggleProgress: (entry: TimelineEntry, collapsed: boolean) => void;
  onApprovalResponse?: (accepted: boolean, request: PendingRequest) => void;
}) {
  const latestEntry = entries[entries.length - 1];
  const summary = entries
    .map((entry) => entry.subtitle)
    .find(Boolean) ?? `${entries.length} 个执行`;

  return (
    <View className="mb-2 items-start">
      <Surface className="max-w-[92%] rounded-lg border border-separator bg-surface-secondary p-2">
        <Button variant="ghost" size="sm" onPress={() => onToggleGroup(id, collapsed)} className="justify-start rounded-md">
          <HeroText className="text-muted">{collapsed ? '›' : '⌄'}</HeroText>
          <HeroText className="min-w-0 flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>
            {summary}
          </HeroText>
          <HeroText className="text-[10px] text-muted">{latestEntry ? nowLabel(latestEntry.at) : ''}</HeroText>
        </Button>
        {!collapsed ? (
          <View style={styles.executionGroupItems}>
            {entries.map((entry) => {
              const manuallyExpanded = expandedProgressIds.has(entry.id);
              const entryCollapsed = compactItems && !manuallyExpanded;
              return (
                <MessageBubble
                  key={entry.id}
                  entry={entry}
                  collapsed={entryCollapsed}
                  collapsible
                  hideTitle
                  pendingRequest={entry.requestId ? pendingRequestById.get(entry.requestId) : undefined}
                  onToggleProgress={onToggleProgress}
                  onApprovalResponse={onApprovalResponse}
                />
              );
            })}
          </View>
        ) : null}
      </Surface>
    </View>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card variant="transparent" className="mx-4 my-4 border border-separator bg-surface-secondary">
      <Card.Body className="items-center gap-2 py-6">
        <StyledIonicons name="chatbubbles-outline" size={24} className="text-muted" />
        <HeroText className="text-center text-sm leading-5 text-muted">{text}</HeroText>
      </Card.Body>
    </Card>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function HeaderIconButton({ label, onPress }: { label: string; onPress: () => void }) {
  const iconName =
    label === '+'
      ? 'add'
      : label === '设置'
        ? 'settings-outline'
        : label === '更多'
          ? 'ellipsis-horizontal'
          : 'chevron-forward';
  return (
    <Button
      isIconOnly
      size="sm"
      variant="ghost"
      accessibilityLabel={label}
      onPress={onPress}
      className="rounded-lg"
    >
      <StyledIonicons name={iconName} size={18} className="text-foreground" />
    </Button>
  );
}

function ConversationHeaderTitle({
  title,
  mode,
  goalLabel,
  localState,
}: {
  title: string;
  mode: ConversationRecord['mode'];
  goalLabel: string;
  localState: LocalAdapterState;
}) {
  const stateLabel = localState === 'idle' ? '' : localState;
  return (
    <View style={styles.conversationHeaderTitle}>
      <Text style={styles.conversationHeaderName} numberOfLines={1}>{title}</Text>
      <View style={styles.conversationHeaderStatusRow}>
        <View style={[styles.headerStatusChip, mode === 'plan' ? styles.headerStatusChipAccent : styles.headerStatusChipMuted]}>
          <Text style={styles.headerStatusText} numberOfLines={1}>{modeLabelOf(mode)}</Text>
        </View>
        <View style={styles.headerStatusChip}>
          <Text style={styles.headerStatusText} numberOfLines={1}>{goalLabel}</Text>
        </View>
        {stateLabel ? (
          <View style={styles.headerStatusChip}>
            <Text style={styles.headerStatusText} numberOfLines={1}>{stateLabel}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ActionButton({
  title,
  onPress,
  tone = 'solid',
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  tone?: 'solid' | 'ghost' | 'danger';
  disabled?: boolean;
}) {
  const variant = tone === 'ghost' ? 'secondary' : tone === 'danger' ? 'danger-soft' : 'primary';
  return (
    <Button
      size="md"
      variant={variant}
      isDisabled={disabled}
      onPress={onPress}
      className="min-h-11 flex-1 rounded-lg"
    >
      <Button.Label numberOfLines={1}>{title}</Button.Label>
    </Button>
  );
}

function MiniButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Button size="sm" variant={title === '拒绝' ? 'danger-soft' : 'secondary'} onPress={onPress} className="rounded-md">
      <Button.Label>{title}</Button.Label>
    </Button>
  );
}

function MenuItem({
  title,
  onPress,
  close,
  danger = false,
}: {
  title: string;
  onPress: () => void;
  close: () => void;
  danger?: boolean;
}) {
  return (
    <Button
      variant={danger ? 'danger-soft' : 'ghost'}
      size="lg"
      onPress={() => {
        close();
        onPress();
      }}
      className="min-h-12 justify-start rounded-lg"
    >
      <Button.Label className={danger ? 'text-danger-soft-foreground' : undefined}>{title}</Button.Label>
    </Button>
  );
}

function Diagnostic({ label, value }: { label: string; value: string }) {
  return (
    <Surface variant="secondary" className="min-h-12 flex-row items-center justify-between gap-3 rounded-lg px-3 py-2">
      <HeroText className="text-xs font-semibold text-muted">{label}</HeroText>
      <HeroText className="min-w-0 flex-1 text-right text-sm font-medium text-foreground" numberOfLines={1}>
        {value}
      </HeroText>
    </Surface>
  );
}

function Field({
  label,
  value,
  onChangeText,
  onBlur,
  placeholder,
  multiline = false,
  editable = true,
  secureTextEntry = false,
  inputStyle,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  multiline?: boolean;
  editable?: boolean;
  secureTextEntry?: boolean;
  inputStyle?: StyleProp<TextStyle>;
}) {
  return (
    <TextField className="gap-2">
      <Label>{label}</Label>
      <Input
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder}
        className={multiline ? 'min-h-24 items-start rounded-lg' : 'min-h-11 rounded-lg'}
        style={[multiline && styles.inputMultiline, inputStyle]}
        multiline={multiline}
        isDisabled={!editable}
        secureTextEntry={secureTextEntry}
        autoCapitalize="none"
        autoCorrect={false}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </TextField>
  );
}

function PromptModal({
  visible,
  title,
  initialValue,
  placeholder,
  warning,
  multiline = false,
  submitTitle = '保存',
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  initialValue: string;
  placeholder: string;
  warning?: string;
  multiline?: boolean;
  submitTitle?: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (visible) {
      setValue(initialValue);
    }
  }, [initialValue, visible]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.promptSheet}>
          <Text style={styles.modalTitle}>{title}</Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor="#8a93a1"
            style={[styles.input, multiline ? styles.inputMultiline : null]}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            multiline={multiline}
            textAlignVertical={multiline ? 'top' : 'center'}
          />
          {warning ? <Text style={styles.warningText}>{warning}</Text> : null}
          <Row>
            <ActionButton title={submitTitle} onPress={() => onSubmit(value)} />
            <ActionButton title="取消" onPress={onCancel} tone="ghost" />
          </Row>
        </View>
      </View>
    </Modal>
  );
}

function ThreadInfoModal({
  visible,
  title,
  detail,
  raw,
  onClose,
}: {
  visible: boolean;
  title: string;
  detail: string;
  raw?: unknown;
  onClose: () => void;
}) {
  const rawText = raw === undefined ? '' : shortJson(raw);
  const copyDetail = async () => {
    await Clipboard.setStringAsync(rawText || detail);
    Alert.alert('已复制', 'Thread 结果已复制到剪贴板。');
  };
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.threadInfoSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle} numberOfLines={1}>{title}</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.modalClose}>关闭</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.threadInfoScroll} contentContainerStyle={styles.threadInfoContent}>
            {detail ? <Text selectable style={styles.threadInfoText}>{detail}</Text> : null}
            {rawText ? (
              <View style={styles.threadRawBlock}>
                <Text style={styles.threadRawTitle}>Raw JSON</Text>
                <Text selectable style={styles.threadRawText}>{rawText}</Text>
              </View>
            ) : null}
          </ScrollView>
          <Row>
            <ActionButton title="复制" onPress={copyDetail} tone="ghost" />
            <ActionButton title="关闭" onPress={onClose} />
          </Row>
        </View>
      </View>
    </Modal>
  );
}

function SkillPickerModal({
  visible,
  workspace,
  conversationId,
  status,
  error,
  skills,
  selectedSkills,
  onRefresh,
  onToggleSkill,
  onClose,
}: {
  visible: boolean;
  workspace: WorkspaceRecord | null;
  conversationId: string;
  status: SkillListStatus;
  error: string;
  skills: SkillListItem[];
  selectedSkills: SelectedSkillAttachment[];
  onRefresh: () => void;
  onToggleSkill: (skill: SkillListItem) => void;
  onClose: () => void;
}) {
  const selectedIds = useMemo(
    () => new Set(selectedSkills.map((item) => skillIdFromPath(item.name, item.path))),
    [selectedSkills],
  );
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.skillPickerSheet}>
          <View style={styles.modalHeader}>
            <View style={styles.modelControlTitleBlock}>
              <Text style={styles.modalTitle}>Skills</Text>
              <Text style={styles.modelPickerSubtitle} numberOfLines={1}>
                {workspace?.name || '当前工作区'} · {selectedSkills.length} selected
              </Text>
            </View>
            <Pressable onPress={onClose}>
              <Text style={styles.modalClose}>关闭</Text>
            </Pressable>
          </View>
          <View style={styles.modelPickerToolbar}>
            <Button size="sm" variant="secondary" isDisabled={status === 'loading'} onPress={onRefresh} className="rounded-lg">
              <Button.Label>刷新</Button.Label>
            </Button>
            <Button size="sm" variant="primary" isDisabled={!conversationId} onPress={onClose} className="rounded-lg">
              <Button.Label>完成</Button.Label>
            </Button>
          </View>
          {status === 'loading' ? (
            <View style={styles.skillPickerStatus}>
              <ActivityIndicator />
              <Text style={styles.diffEmptyText}>正在扫描 Skills</Text>
            </View>
          ) : null}
          {status === 'error' ? <Text style={styles.warningText}>{error || 'skills/list 请求失败'}</Text> : null}
          {status !== 'loading' && skills.length === 0 ? (
            <View style={styles.skillPickerStatus}>
              <Text style={styles.diffEmptyTitle}>没有可选 Skill</Text>
              <Text style={styles.diffEmptyText}>当前工作区没有返回启用的 Skills。</Text>
            </View>
          ) : null}
          <ScrollView style={styles.modelPickerList} contentContainerStyle={styles.modelPickerListContent}>
            {skills.map((skill) => {
              const selected = selectedIds.has(skill.id);
              return (
                <Pressable
                  key={skill.id}
                  disabled={!skill.enabled}
                  style={[
                    styles.skillOption,
                    selected ? styles.skillOptionActive : null,
                    !skill.enabled ? styles.skillOptionDisabled : null,
                  ]}
                  onPress={() => onToggleSkill(skill)}
                >
                  <View style={[styles.skillOptionIcon, selected ? styles.skillOptionIconActive : null]}>
                    <StyledIonicons name={selected ? 'checkmark' : 'flash'} size={16} className={selected ? 'text-accent-foreground' : 'text-foreground'} />
                  </View>
                  <View style={styles.modelOptionBody}>
                    <View style={styles.modelOptionHeader}>
                      <Text style={[styles.modelOptionTitle, selected ? styles.modelOptionTitleActive : null]} numberOfLines={1}>
                        {skill.displayName || skill.name}
                      </Text>
                      <Text style={styles.modelDefaultBadge}>{skill.scope}</Text>
                    </View>
                    <Text style={styles.modelOptionDescription} numberOfLines={2}>
                      {skill.description || skill.name}
                    </Text>
                    <Text style={styles.skillOptionPath} numberOfLines={1}>{skill.path}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ReasoningEffortSelector({
  label,
  options,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  options: CodexReasoningEffortOption[];
  value: string | null;
  defaultValue: string | null;
  onChange: (value: string | null) => void;
}) {
  const normalizedValue = normalizeReasoningEffort(value);
  const normalizedDefault = normalizeReasoningEffort(defaultValue);
  const effectiveOptions = options.length ? options : DEFAULT_REASONING_EFFORT_OPTIONS;
  return (
    <View style={styles.reasoningBlock}>
      <View style={styles.modelControlHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.reasoningDefaultText}>默认: {reasoningEffortLabel(normalizedDefault)}</Text>
      </View>
      <View style={styles.reasoningGrid}>
        {effectiveOptions.map((option) => {
          const selected = normalizedValue === option.reasoningEffort;
          return (
            <Pressable
              key={option.reasoningEffort}
              style={[styles.reasoningOption, selected ? styles.reasoningOptionActive : null]}
              onPress={() => onChange(option.reasoningEffort)}
            >
              <Text style={[styles.reasoningOptionTitle, selected ? styles.reasoningOptionTitleActive : null]} numberOfLines={1}>
                {reasoningEffortLabel(option.reasoningEffort)}
              </Text>
              <Text style={[styles.reasoningOptionDescription, selected ? styles.reasoningOptionDescriptionActive : null]} numberOfLines={2}>
                {option.description}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ModelPickerModal({
  visible,
  title,
  catalog,
  selectedModel,
  selectedReasoningEffort,
  loading,
  error,
  onRefresh,
  onCancel,
  onSubmit,
  onManual,
}: {
  visible: boolean;
  title: string;
  catalog: CodexModelCatalogItem[];
  selectedModel: string;
  selectedReasoningEffort: string | null;
  loading: boolean;
  error: string;
  onRefresh: () => boolean;
  onCancel: () => void;
  onSubmit: (model: string, reasoningEffort: string | null) => void;
  onManual: () => void;
}) {
  const [draftModel, setDraftModel] = useState(selectedModel);
  const [draftReasoningEffort, setDraftReasoningEffort] = useState<string | null>(normalizeReasoningEffort(selectedReasoningEffort));
  const safeCatalog = catalog.length ? catalog : FALLBACK_CODEX_MODELS;

  useEffect(() => {
    if (visible) {
      setDraftModel(selectedModel);
      setDraftReasoningEffort(normalizeReasoningEffort(selectedReasoningEffort));
    }
  }, [selectedModel, selectedReasoningEffort, visible]);

  const selectedPreset = safeCatalog.find((item) => item.model === draftModel);
  const reasoningOptions = reasoningOptionsForModel(draftModel, safeCatalog);
  const defaultEffort = selectedPreset?.defaultReasoningEffort ?? defaultReasoningForModel(draftModel, safeCatalog);

  const selectModel = (model: CodexModelCatalogItem) => {
    setDraftModel(model.model);
    const currentEffort = normalizeReasoningEffort(draftReasoningEffort);
    const supported = model.supportedReasoningEfforts.map((option) => option.reasoningEffort);
    setDraftReasoningEffort(
      currentEffort && supported.includes(currentEffort)
        ? currentEffort
        : model.defaultReasoningEffort ?? supported[0] ?? null,
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modelPickerSheet}>
          <View style={styles.modalHeader}>
            <View style={styles.modelControlTitleBlock}>
              <Text style={styles.modalTitle}>{title}</Text>
              <Text style={styles.modelPickerSubtitle} numberOfLines={1}>
                {modelDisplayLabel(draftModel, safeCatalog)} · {reasoningEffortLabel(draftReasoningEffort)}
              </Text>
            </View>
            <Pressable onPress={onCancel}>
              <Text style={styles.modalClose}>关闭</Text>
            </Pressable>
          </View>
          <View style={styles.modelPickerToolbar}>
            <ActionButton title="刷新" onPress={onRefresh} tone="ghost" disabled={loading} />
            <ActionButton title="手动输入" onPress={onManual} tone="ghost" />
            {loading ? <ActivityIndicator size="small" color="#17202a" /> : null}
          </View>
          {error ? <Text style={styles.warningText}>{error}</Text> : null}
          <ScrollView style={styles.modelPickerList} contentContainerStyle={styles.modelPickerListContent}>
            {safeCatalog.map((model) => {
              const selected = draftModel === model.model;
              return (
                <Pressable
                  key={model.model}
                  style={[styles.modelOption, selected ? styles.modelOptionActive : null]}
                  onPress={() => selectModel(model)}
                >
                  <View style={styles.modelOptionHeader}>
                    <Text style={[styles.modelOptionTitle, selected ? styles.modelOptionTitleActive : null]} numberOfLines={1}>
                      {model.displayName || model.model}
                    </Text>
                    {model.isDefault ? <Text style={styles.modelDefaultBadge}>default</Text> : null}
                  </View>
                  {model.description ? (
                    <Text style={styles.modelOptionDescription} numberOfLines={2}>{model.description}</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <ReasoningEffortSelector
            label={`思考强度 · ${draftModel || 'model'}`}
            options={reasoningOptions}
            value={draftReasoningEffort}
            defaultValue={defaultEffort}
            onChange={setDraftReasoningEffort}
          />
          <Row>
            <ActionButton title="应用" onPress={() => onSubmit(draftModel, draftReasoningEffort)} />
            <ActionButton title="取消" onPress={onCancel} tone="ghost" />
          </Row>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  appRoot: {
    flex: 1,
  },
  root: {
    flex: 1,
    backgroundColor: '#f4f6f8',
  },
  screenBackground: {
    backgroundColor: '#f4f6f8',
  },
  chatRoot: {
    flex: 1,
    backgroundColor: '#f4f6f8',
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: '#17202a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingTitle: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 8,
  },
  loadingText: {
    color: '#b9c3cc',
    fontSize: 15,
  },
  headerTitle: {
    color: '#17202a',
    fontSize: 17,
    fontWeight: '800',
  },
  conversationHeaderTitle: {
    width: 230,
    alignItems: 'center',
    justifyContent: 'center',
  },
  conversationHeaderName: {
    maxWidth: 230,
    color: '#17202a',
    fontSize: 15,
    fontWeight: '800',
  },
  conversationHeaderStatusRow: {
    maxWidth: 230,
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  headerStatusChip: {
    maxWidth: 108,
    minHeight: 18,
    borderRadius: 6,
    backgroundColor: '#eef0f2',
    paddingHorizontal: 6,
    justifyContent: 'center',
  },
  headerStatusChipAccent: {
    backgroundColor: '#dcefeb',
  },
  headerStatusChipMuted: {
    backgroundColor: '#eef0f2',
  },
  headerStatusText: {
    color: '#52606b',
    fontSize: 10,
    fontWeight: '800',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconButton: {
    minWidth: 36,
    minHeight: 36,
    borderRadius: 8,
    backgroundColor: '#eef0f2',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerIconText: {
    color: '#17202a',
    fontSize: 16,
    fontWeight: '800',
  },
  listContent: {
    paddingVertical: 10,
    paddingBottom: 28,
  },
  statusRow: {
    marginHorizontal: 16,
    marginVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusLabel: {
    color: '#17202a',
    fontSize: 24,
    fontWeight: '800',
  },
  statusPill: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
  },
  statusOpen: {
    backgroundColor: '#dcf7ea',
    borderColor: '#65b98d',
  },
  statusMuted: {
    backgroundColor: '#eef0f2',
    borderColor: '#ccd1d6',
  },
  statusText: {
    color: '#17202a',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  listItem: {
    minHeight: 72,
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e7ecef',
  },
  listItemActive: {
    backgroundColor: '#edf5ff',
    borderBottomColor: '#bed7f0',
  },
  listItemRunning: {
    backgroundColor: '#f0fbf5',
    borderBottomColor: '#bfe8cf',
  },
  itemAvatar: {
    width: 46,
    height: 46,
    borderRadius: 8,
    backgroundColor: '#17202a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemAvatarText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
  },
  conversationAvatar: {
    width: 46,
    height: 46,
    borderRadius: 8,
    backgroundColor: '#e1ebea',
    alignItems: 'center',
    justifyContent: 'center',
  },
  conversationAvatarActive: {
    backgroundColor: '#19a463',
  },
  conversationAvatarText: {
    color: '#244641',
    fontSize: 15,
    fontWeight: '800',
  },
  conversationAvatarTextActive: {
    color: '#ffffff',
  },
  itemMain: {
    flex: 1,
    minWidth: 0,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  itemTitle: {
    flex: 1,
    color: '#17202a',
    fontSize: 16,
    fontWeight: '800',
    minWidth: 0,
  },
  itemTitleActive: {
    color: '#168451',
  },
  itemTag: {
    color: '#7a8391',
    fontSize: 11,
    fontWeight: '800',
  },
  itemTagActive: {
    color: '#168451',
  },
  itemBody: {
    color: '#66717c',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  workspaceSummary: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e7ecef',
    marginBottom: 8,
  },
  summaryTitle: {
    color: '#17202a',
    fontSize: 18,
    fontWeight: '800',
  },
  summaryPath: {
    color: '#66717c',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  threadToolbar: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  threadToolbarText: {
    flex: 1,
    color: '#52606d',
    fontSize: 12,
    fontWeight: '700',
  },
  centerScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyState: {
    color: '#66717c',
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(23, 32, 42, 0.32)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#ffffff',
    padding: 18,
    paddingBottom: 28,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    gap: 14,
  },
  promptSheet: {
    backgroundColor: '#ffffff',
    marginHorizontal: 18,
    borderRadius: 8,
    padding: 18,
    gap: 14,
  },
  modelPickerSheet: {
    maxHeight: '92%',
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    padding: 18,
    paddingBottom: 28,
    gap: 14,
  },
  skillPickerSheet: {
    maxHeight: '92%',
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    padding: 18,
    paddingBottom: 28,
    gap: 14,
  },
  threadInfoSheet: {
    maxHeight: '88%',
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    padding: 18,
    paddingBottom: 28,
    gap: 14,
  },
  threadInfoScroll: {
    maxHeight: 420,
  },
  threadInfoContent: {
    gap: 12,
    paddingBottom: 2,
  },
  threadInfoText: {
    color: '#17202a',
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  threadRawBlock: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d8e0e7',
    backgroundColor: '#f7f9fa',
    padding: 10,
    gap: 8,
  },
  threadRawTitle: {
    color: '#66717c',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  threadRawText: {
    color: '#26323d',
    fontSize: 12,
    lineHeight: 17,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    color: '#17202a',
    fontSize: 18,
    fontWeight: '800',
  },
  modalClose: {
    color: '#52606d',
    fontSize: 14,
    fontWeight: '800',
  },
  scannerScreen: {
    flex: 1,
    backgroundColor: '#111820',
  },
  scannerCamera: {
    flex: 1,
  },
  scannerFooter: {
    backgroundColor: '#ffffff',
    padding: 18,
    gap: 12,
  },
  scannerTitle: {
    color: '#17202a',
    fontSize: 16,
    fontWeight: '800',
  },
  scannerStatus: {
    color: '#52606d',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  pageContent: {
    padding: 18,
    paddingBottom: 28,
    gap: 24,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: '#17202a',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0,
  },
  commandPageHeader: {
    gap: 6,
  },
  commandPageTitle: {
    color: '#17202a',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0,
  },
  commandPageSubtitle: {
    color: '#66717c',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  commandDetailCommand: {
    alignSelf: 'flex-start',
    color: '#17202a',
    fontSize: 13,
    fontWeight: '800',
    backgroundColor: '#edf0f2',
    borderWidth: 1,
    borderColor: '#d8e0e7',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  commandDetailCard: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d8e0e7',
    padding: 14,
    gap: 12,
  },
  commandDetailLabel: {
    color: '#66717c',
    fontSize: 12,
    fontWeight: '800',
  },
  commandDetailValue: {
    color: '#17202a',
    fontSize: 16,
    fontWeight: '800',
  },
  commandDetailHint: {
    color: '#66717c',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  commandChoiceItem: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d8e0e7',
    backgroundColor: '#f7f9fa',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  commandQuickPanel: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d8e0e7',
    padding: 12,
    gap: 12,
  },
  commandActionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  commandSection: {
    gap: 10,
  },
  commandSectionTitle: {
    color: '#17202a',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0,
  },
  commandList: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d8e0e7',
    overflow: 'hidden',
  },
  commandListItem: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e7ecef',
  },
  commandListText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  commandName: {
    color: '#17202a',
    fontSize: 14,
    fontWeight: '800',
  },
  commandDescription: {
    color: '#66717c',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  diffToolbar: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#d8e0e7',
    backgroundColor: '#ffffff',
  },
  diffToolbarText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  diffTitle: {
    color: '#17202a',
    fontSize: 15,
    fontWeight: '800',
  },
  diffSubtitle: {
    color: '#66717c',
    fontSize: 12,
    fontWeight: '700',
  },
  diffScroll: {
    flex: 1,
  },
  diffContent: {
    padding: 14,
    paddingBottom: 28,
  },
  diffText: {
    color: '#17202a',
    fontSize: 12,
    lineHeight: 17,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  diffEmptyState: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 20,
  },
  diffEmptyTitle: {
    color: '#17202a',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  diffEmptyText: {
    color: '#66717c',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  experimentalSummary: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d8e0e7',
    padding: 14,
  },
  experimentalSummaryText: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  experimentalSummaryTitle: {
    color: '#17202a',
    fontSize: 16,
    fontWeight: '800',
  },
  experimentalSummaryBody: {
    color: '#66717c',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  experimentalFeatureItem: {
    minHeight: 108,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e7ecef',
  },
  experimentalFeatureText: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  experimentalFeatureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  experimentalFeatureTitle: {
    flex: 1,
    minWidth: 0,
    color: '#17202a',
    fontSize: 14,
    fontWeight: '800',
  },
  experimentalFeatureScope: {
    maxWidth: 108,
    color: '#66717c',
    fontSize: 11,
    fontWeight: '800',
  },
  experimentalFeatureDescription: {
    color: '#66717c',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  experimentalFeatureEnabled: {
    color: '#168451',
    fontSize: 11,
    fontWeight: '800',
  },
  experimentalFeatureDisabled: {
    color: '#87909a',
    fontSize: 11,
    fontWeight: '800',
  },
  formBlock: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d8e0e7',
    padding: 14,
    gap: 12,
  },
  encryptionBlock: {
    gap: 10,
  },
  connectionCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  connectionCardOnline: {
    backgroundColor: '#f0fbf5',
    borderColor: '#65b98d',
  },
  connectionCardChecking: {
    backgroundColor: '#fff8e6',
    borderColor: '#d6a83d',
  },
  connectionCardOffline: {
    backgroundColor: '#fff1f1',
    borderColor: '#d17979',
  },
  connectionCardIdle: {
    backgroundColor: '#f7f9fa',
    borderColor: '#d8e0e7',
  },
  connectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  connectionDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  connectionDotOnline: {
    backgroundColor: '#19a463',
  },
  connectionDotChecking: {
    backgroundColor: '#d89b19',
  },
  connectionDotOffline: {
    backgroundColor: '#c75757',
  },
  connectionDotIdle: {
    backgroundColor: '#9aa3ad',
  },
  connectionSummary: {
    flex: 1,
    minWidth: 0,
  },
  connectionTitle: {
    color: '#17202a',
    fontSize: 16,
    fontWeight: '800',
  },
  connectionSubtitle: {
    marginTop: 2,
    color: '#52606b',
    fontSize: 12,
    fontWeight: '700',
  },
  connectionLatency: {
    color: '#17202a',
    fontSize: 13,
    fontWeight: '800',
  },
  connectionMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  connectionMeta: {
    color: '#66717c',
    fontSize: 11,
    fontWeight: '800',
  },
  connectionErrorText: {
    color: '#8a2f2f',
    fontSize: 11,
    fontWeight: '700',
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    color: '#66717c',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
  },
  input: {
    backgroundColor: '#ffffff',
    color: '#17202a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d7dce0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 42,
  },
  inputMultiline: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  encryptionKeyInput: {
    height: 156,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    fontSize: 13,
    lineHeight: 18,
  },
  modelControlBlock: {
    gap: 10,
  },
  modelControlHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  modelControlTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  modelControlCurrent: {
    marginTop: 4,
    color: '#17202a',
    fontSize: 14,
    fontWeight: '800',
  },
  modelPickerToolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  modelPickerSubtitle: {
    marginTop: 4,
    color: '#66717c',
    fontSize: 12,
    fontWeight: '800',
  },
  modelPickerList: {
    maxHeight: 260,
  },
  modelPickerListContent: {
    gap: 8,
    paddingBottom: 2,
  },
  modelOption: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d8e0e7',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 5,
  },
  skillOption: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d8e0e7',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  skillOptionActive: {
    borderColor: '#19a463',
    backgroundColor: '#f0fbf5',
  },
  skillOptionDisabled: {
    opacity: 0.48,
  },
  skillOptionIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d8e0e7',
    backgroundColor: '#f7f9fa',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  skillOptionIconActive: {
    borderColor: '#19a463',
    backgroundColor: '#19a463',
  },
  modelOptionBody: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  modelOptionActive: {
    borderColor: '#19a463',
    backgroundColor: '#f0fbf5',
  },
  modelOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modelOptionTitle: {
    flex: 1,
    minWidth: 0,
    color: '#17202a',
    fontSize: 14,
    fontWeight: '800',
  },
  modelOptionTitleActive: {
    color: '#168451',
  },
  modelDefaultBadge: {
    color: '#168451',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  modelOptionDescription: {
    color: '#66717c',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  skillOptionPath: {
    color: '#7a8391',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  skillPickerStatus: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
  },
  reasoningBlock: {
    gap: 10,
  },
  reasoningDefaultText: {
    color: '#66717c',
    fontSize: 11,
    fontWeight: '800',
  },
  reasoningGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reasoningOption: {
    width: '48%',
    minHeight: 74,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d8e0e7',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 4,
  },
  reasoningOptionActive: {
    borderColor: '#17202a',
    backgroundColor: '#17202a',
  },
  reasoningOptionTitle: {
    color: '#17202a',
    fontSize: 13,
    fontWeight: '800',
  },
  reasoningOptionTitleActive: {
    color: '#ffffff',
  },
  reasoningOptionDescription: {
    color: '#66717c',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  reasoningOptionDescriptionActive: {
    color: '#d7dde3',
  },
  inputDisabled: {
    opacity: 0.7,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionButton: {
    backgroundColor: '#17202a',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonGhost: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cfd5da',
  },
  actionButtonDanger: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#c75757',
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  actionButtonText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 13,
  },
  actionButtonTextGhost: {
    color: '#17202a',
  },
  actionButtonTextDanger: {
    color: '#a23b3b',
  },
  miniButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cfd5da',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  miniButtonText: {
    color: '#26323d',
    fontSize: 12,
    fontWeight: '800',
  },
  inlineError: {
    color: '#a23b3b',
    fontSize: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  warningText: {
    color: '#a23b3b',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  messageArea: {
    flex: 1,
    position: 'relative',
  },
  messageScroller: {
    flex: 1,
  },
  messageList: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 10,
  },
  jumpToLatestButton: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 14,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(38, 50, 61, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  jumpToLatestText: {
    color: '#26323d',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 28,
  },
  bubbleRow: {
    flexDirection: 'row',
    width: '100%',
  },
  bubbleRowOutgoing: {
    justifyContent: 'flex-end',
  },
  bubblePressable: {
    maxWidth: '88%',
    minWidth: 96,
    flexShrink: 1,
  },
  bubble: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d8e0e7',
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  progressPressable: {
    maxWidth: '88%',
  },
  progressBubble: {
    maxWidth: '100%',
  },
  executionGroupShell: {
    maxWidth: '88%',
    backgroundColor: '#edf0f2',
    borderWidth: 1,
    borderColor: '#d5dade',
    borderRadius: 8,
    padding: 10,
    gap: 8,
  },
  executionGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  executionGroupSummary: {
    flex: 1,
    color: '#26323d',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  executionGroupItems: {
    gap: 8,
  },
  bubbleOutgoing: {
    backgroundColor: '#17202a',
    borderColor: '#17202a',
  },
  bubbleSystem: {
    backgroundColor: '#edf0f2',
    borderColor: '#d5dade',
  },
  bubbleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'nowrap',
  },
  bubbleTitle: {
    flex: 1,
    color: '#17202a',
    fontSize: 12,
    fontWeight: '800',
  },
  bubbleTitleOutgoing: {
    color: '#ffffff',
  },
  hiddenBubbleTitleSpacer: {
    flex: 1,
  },
  progressChevron: {
    width: 12,
    color: '#52606d',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 18,
  },
  bubbleTime: {
    color: '#87909a',
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 0,
  },
  bubbleTimeOutgoing: {
    color: '#c5ccd3',
  },
  bubbleText: {
    color: '#26323d',
    fontSize: 14,
    lineHeight: 20,
  },
  bubbleTextOutgoing: {
    color: '#ffffff',
  },
  collapsedProgressText: {
    color: '#6f7882',
    fontSize: 12,
    lineHeight: 17,
  },
  approvalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 4,
  },
  composer: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#d8e0e7',
    backgroundColor: '#ffffff',
    gap: 10,
  },
  attachmentRail: {
    gap: 8,
    paddingBottom: 2,
  },
  attachmentChip: {
    width: 210,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d7dce0',
    backgroundColor: '#f7f9fa',
    padding: 8,
  },
  skillComposerChip: {
    width: 210,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfe8cf',
    backgroundColor: '#f0fbf5',
    padding: 8,
  },
  skillComposerIcon: {
    width: 38,
    height: 38,
    borderRadius: 6,
    backgroundColor: '#dff5e8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentPreview: {
    width: 38,
    height: 38,
    borderRadius: 6,
    backgroundColor: '#e9edf1',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentPreviewImage: {
    width: '100%',
    height: '100%',
  },
  attachmentPreviewText: {
    color: '#52606d',
    fontSize: 10,
    fontWeight: '800',
  },
  attachmentChipMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  attachmentChipName: {
    color: '#17202a',
    fontSize: 12,
    fontWeight: '800',
  },
  attachmentChipMeta: {
    color: '#66717c',
    fontSize: 11,
    fontWeight: '700',
  },
  attachmentRemoveButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cfd5da',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentRemoveText: {
    color: '#52606d',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 16,
  },
  composerInputRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: 8,
  },
  attachmentButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d7dce0',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentButtonText: {
    color: '#17202a',
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 20,
  },
  attachmentMenuSheet: {
    width: 240,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d8e0e7',
    overflow: 'hidden',
  },
  slashPanel: {
    width: '100%',
    backgroundColor: '#f7f9fa',
    borderWidth: 1,
    borderColor: '#d8e0e7',
    borderRadius: 8,
    overflow: 'hidden',
  },
  slashItem: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e7ecef',
    gap: 2,
  },
  slashCommand: {
    color: '#17202a',
    fontSize: 13,
    fontWeight: '800',
  },
  slashDescription: {
    color: '#66717c',
    fontSize: 12,
  },
  slashSuggestionScroll: {
    maxHeight: 320,
  },
  slashSuggestionContent: {
    paddingVertical: 2,
  },
  mentionPanel: {
    width: '100%',
    backgroundColor: '#f7f9fa',
    borderWidth: 1,
    borderColor: '#d8e0e7',
    borderRadius: 8,
    overflow: 'hidden',
  },
  mentionItem: {
    minHeight: 50,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e7ecef',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mentionIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#e1ebea',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mentionIconText: {
    color: '#244641',
    fontSize: 16,
    fontWeight: '800',
  },
  mentionMain: {
    flex: 1,
    minWidth: 0,
  },
  mentionTitle: {
    color: '#17202a',
    fontSize: 13,
    fontWeight: '800',
  },
  mentionDescription: {
    color: '#66717c',
    fontSize: 12,
    marginTop: 2,
  },
  composerInput: {
    flex: 1,
    minWidth: 0,
    maxHeight: 96,
    minHeight: 40,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d7dce0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#17202a',
    fontSize: 14,
    textAlignVertical: 'top',
  },
  composerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sendButton: {
    width: 40,
    height: 40,
    backgroundColor: '#17202a',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 24,
  },
  stopButton: {
    width: 40,
    height: 40,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#c75757',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopButtonText: {
    color: '#a23b3b',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 18,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(23, 32, 42, 0.24)',
    alignItems: 'flex-end',
    paddingTop: 72,
    paddingRight: 12,
  },
  menuSheet: {
    width: 220,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d8e0e7',
    overflow: 'hidden',
  },
  menuScroll: {
    maxHeight: 520,
  },
  menuScrollContent: {
    gap: 4,
    paddingBottom: 4,
  },
  menuTitle: {
    color: '#17202a',
    fontSize: 13,
    fontWeight: '800',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e7ecef',
  },
  menuItem: {
    minHeight: 44,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#eef0f2',
  },
  menuItemText: {
    color: '#26323d',
    fontSize: 14,
    fontWeight: '700',
  },
  menuDangerText: {
    color: '#a23b3b',
  },
  diagnostics: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d8e0e7',
    overflow: 'hidden',
  },
  diagnosticRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e7ecef',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  diagnosticLabel: {
    width: 92,
    color: '#66717c',
    fontSize: 12,
    fontWeight: '800',
  },
  diagnosticValue: {
    flex: 1,
    color: '#17202a',
    fontSize: 13,
  },
  errorText: {
    color: '#a23b3b',
    fontSize: 13,
    lineHeight: 18,
  },
});

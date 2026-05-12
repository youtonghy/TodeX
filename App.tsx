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
  Keyboard,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type KeyboardEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputSelectionChangeEventData,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';

import {
  ConnectionSettings,
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
  normalizeThreadId,
  normalizeServerUrl,
  sandboxPolicyForMode,
  shortJson,
} from './src/lib/todex';
import { loadJson, loadSecret, saveJson, saveSecret } from './src/lib/storage';
import {
  applyPairingToSettings,
  createTransportCryptoSession,
  resolvePairingPayload,
  type TransportCryptoSession,
} from './src/lib/transportCrypto';

type RootStackParamList = {
  Workspaces: undefined;
  Conversations: { workspaceId: string };
  Chat: { workspaceId: string; conversationId: string };
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
  sessionId: string;
  threadId: string;
  localAdapterState?: LocalAdapterState;
  mode?: 'plan' | 'implement';
  goalStatus?: string;
  goalObjective?: string;
  createdAt: number;
  updatedAt: number;
};

type ComposerSelection = TextInputSelectionChangeEventData['selection'];

const DEFAULT_COMPOSER_SELECTION: ComposerSelection = { start: 0, end: 0 };

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

type ConversationContext = {
  workspace: WorkspaceRecord;
  conversation: ConversationRecord;
};

type TimelineTarget = {
  workspaceId: string;
  conversationId: string;
};

type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

type ConnectionHealth = {
  status: 'unknown' | 'checking' | 'online' | 'offline';
  latencyMs: number | null;
  lastCheckedAt: number | null;
  error: string;
};

const CONNECTION_HEALTH_INTERVAL_MS = 5000;
const CONNECTION_HEALTH_TIMEOUT_MS = 3500;

function localConversationStateOf(conversation: ConversationRecord | null): LocalAdapterState {
  return conversation?.localAdapterState ?? 'idle';
}

function isConversationActive(conversation: ConversationRecord): boolean {
  return conversation.localAdapterState === 'running' || conversation.localAdapterState === 'starting';
}

function sessionIdForConversation(workspace: WorkspaceRecord, conversation: ConversationRecord): string {
  return conversation.sessionId || workspace.sessionId || createSessionId(workspace.name);
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
};

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
enableScreens(true);

const SETTINGS_STORAGE_KEY = 'todex.mobile.settings.v1';
const WORKSPACES_STORAGE_KEY = 'todex.mobile.workspaces.v1';
const CONVERSATIONS_STORAGE_KEY = 'todex.mobile.conversations.v1';
const TIMELINE_STORAGE_KEY = 'todex.mobile.timeline.v1';
const ACTIVE_SELECTION_STORAGE_KEY = 'todex.mobile.activeSelection.v1';
const MENTION_HISTORY_STORAGE_KEY = 'todex.mobile.mentionHistory.v1';
const SESSION_CURSORS_STORAGE_KEY = 'todex.mobile.sessionCursors.v1';
const TOKEN_STORAGE_KEY = 'todex.mobile.token.v1';
const MAX_TIMELINE_ITEMS = 260;
const MAX_EVENTS = 220;
const RECONNECT_DELAY_MS = 2500;
const RECONNECT_REPLAY_LIMIT = 5000;
const CHAT_BOTTOM_FOLLOW_THRESHOLD = 72;

const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/model', title: 'Model', description: 'choose what model and reasoning effort to use' },
  { command: '/ide', title: 'IDE Context', description: 'include current selection, open files, and other context from your IDE' },
  { command: '/permissions', title: 'Permissions', description: 'choose what Codex is allowed to do' },
  { command: '/permission', title: 'Permissions', description: 'alias for /permissions' },
  { command: '/fast', title: 'Fast', description: 'toggle Fast service tier for later turns' },
  { command: '/keymap', title: 'Keymap', description: 'remap TUI shortcuts' },
  { command: '/vim', title: 'Vim', description: 'toggle Vim mode for the composer' },
  { command: '/setup-default-sandbox', title: 'Setup Default Sandbox', description: 'set up elevated agent sandbox' },
  { command: '/sandbox-add-read-dir', title: 'Sandbox Read Root', description: 'let sandbox read a directory' },
  { command: '/experimental', title: 'Experimental', description: 'toggle experimental features' },
  { command: '/approve', title: 'Approve', description: 'approve one retry of a recent auto-review denial' },
  { command: '/memories', title: 'Memories', description: 'configure memory use and generation' },
  { command: '/skills', title: 'Skills', description: 'use skills to improve how Codex performs specific tasks' },
  { command: '/hooks', title: 'Hooks', description: 'view and manage lifecycle hooks' },
  { command: '/review', title: 'Review', description: 'review my current changes and find issues' },
  { command: '/rename', title: 'Rename', description: 'rename the current thread' },
  { command: '/new', title: 'New', description: 'start a new chat during a conversation' },
  { command: '/resume', title: 'Resume', description: 'resume a saved chat' },
  { command: '/fork', title: 'Fork', description: 'fork the current chat' },
  { command: '/init', title: 'Init', description: 'create an AGENTS.md file with instructions for Codex' },
  { command: '/compact', title: 'Compact', description: 'summarize conversation to prevent hitting the context limit' },
  { command: '/plan', title: 'Plan', description: 'switch to Plan mode' },
  { command: '/goal', title: 'Goal', description: 'set or view the goal for a long-running task' },
  { command: '/collab', title: 'Collab', description: 'change collaboration mode' },
  { command: '/agent', title: 'Agent', description: 'switch the active agent thread' },
  { command: '/subagents', title: 'Subagents', description: 'switch the active agent thread' },
  { command: '/side', title: 'Side', description: 'start a side conversation in an ephemeral fork' },
  { command: '/copy', title: 'Copy', description: 'copy last response as markdown' },
  { command: '/raw', title: 'Raw', description: 'toggle raw scrollback mode for copy-friendly selection' },
  { command: '/diff', title: 'Diff', description: 'show git diff including untracked files' },
  { command: '/mention', title: 'Mention', description: 'mention a file' },
  { command: '/status', title: 'Status', description: 'show current session configuration and token usage' },
  { command: '/debug-config', title: 'Debug Config', description: 'show config layers and requirement sources' },
  { command: '/title', title: 'Title', description: 'configure terminal title items' },
  { command: '/statusline', title: 'Statusline', description: 'configure status line items' },
  { command: '/theme', title: 'Theme', description: 'choose a syntax highlighting theme' },
  { command: '/mcp', title: 'MCP', description: 'list configured MCP tools; use /mcp verbose for details' },
  { command: '/apps', title: 'Apps', description: 'manage apps' },
  { command: '/plugins', title: 'Plugins', description: 'browse plugins' },
  { command: '/logout', title: 'Logout', description: 'log out of Codex' },
  { command: '/quit', title: 'Quit', description: 'exit Codex' },
  { command: '/exit', title: 'Exit', description: 'exit Codex' },
  { command: '/feedback', title: 'Feedback', description: 'send logs to maintainers' },
  { command: '/rollout', title: 'Rollout', description: 'print the rollout file path' },
  { command: '/ps', title: 'PS', description: 'list background terminals' },
  { command: '/stop', title: 'Stop', description: 'stop all background terminals' },
  { command: '/clean', title: 'Clean', description: 'alias for /stop' },
  { command: '/clear', title: 'Clear', description: 'clear the terminal and start a new chat' },
  { command: '/personality', title: 'Personality', description: 'choose a communication style for Codex' },
  { command: '/realtime', title: 'Realtime', description: 'toggle realtime voice mode' },
  { command: '/settings', title: 'Settings', description: 'configure realtime microphone/speaker' },
  { command: '/test-approval', title: 'Test Approval', description: 'test approval request' },
  { command: '/debug-m-drop', title: 'Debug Memory Drop', description: 'debug memory drop' },
  { command: '/debug-m-update', title: 'Debug Memory Update', description: 'debug memory update' },
];

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
  approvalPolicy: 'on-request',
  sandboxMode: 'workspace-write',
};

const defaultConnectionHealth: ConnectionHealth = {
  status: 'unknown',
  latencyMs: null,
  lastCheckedAt: null,
  error: '',
};

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

function textFromLocalTurnPayload(payload: Record<string, unknown>): string {
  const input = payload.input;
  if (!Array.isArray(input)) {
    return shortJson(payload).slice(0, 240);
  }

  const text = input
    .map((item) => {
      if (item && typeof item === 'object' && 'text' in item) {
        return String((item as { text?: unknown }).text ?? '');
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
  const payload = objectPayloadOf(event);
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

function cursorFromEvent(event: ServerEvent): number | null {
  if (typeof event.cursor === 'number' && Number.isFinite(event.cursor)) {
    return event.cursor;
  }
  if (typeof event.cursor === 'string') {
    const parsed = Number(event.cursor);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
  const autoConnectAttemptedRef = useRef(false);
  const attachedSessionIdsRef = useRef(new Set<string>());
  const sessionCursorsRef = useRef(new Map<string, number>());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualDisconnectRef = useRef(false);
  const healthProbeSeqRef = useRef(0);

  const [hydrated, setHydrated] = useState(false);
  const [autoConnectEnabled, setAutoConnectEnabled] = useState(false);
  const [settings, setSettings] = useState<ConnectionSettings>(defaultSettings);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('');
  const [activeConversationId, setActiveConversationId] = useState('');
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [connectionHealth, setConnectionHealth] = useState<ConnectionHealth>(defaultConnectionHealth);
  const [lastError, setLastError] = useState('');
  const [serverVersion, setServerVersion] = useState<ServerVersion | null>(null);
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [mentionHistory, setMentionHistory] = useState<WorkspaceMentionHistory[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [queuedChatDrafts, setQueuedChatDrafts] = useState<Record<string, string[]>>({});
  const [composerSelections, setComposerSelections] = useState<Record<string, ComposerSelection>>({});
  const [turnIds, setTurnIds] = useState<Record<string, string>>({});
  const [thinkingConversations, setThinkingConversations] = useState<Record<string, boolean>>({});
  const queuedChatDraftsRef = useRef<Record<string, string[]>>({});
  const queuedChatDispatchingRef = useRef(new Set<string>());
  const sendQueuedChatDraftRef = useRef<(text: string, conversationId: string) => Promise<boolean>>(async () => false);

  const activeTurnId = activeConversationId ? turnIds[activeConversationId] ?? '' : '';

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

  const persistSessionCursors = useCallback(() => {
    const cursors = Object.fromEntries(sessionCursorsRef.current.entries());
    void saveJson(SESSION_CURSORS_STORAGE_KEY, cursors);
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
      try {
        socketRef.current.close();
      } catch {
        // ignore
      }
      socketRef.current = null;
    }
    socketCryptoRef.current = null;
    attachedSessionIdsRef.current.clear();
  }, []);

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
        storedToken,
      ] = await Promise.all([
        loadJson<PersistedSettings | null>(SETTINGS_STORAGE_KEY, null),
        loadJson<WorkspaceRecord[]>(WORKSPACES_STORAGE_KEY, []),
        loadJson<ConversationRecord[]>(CONVERSATIONS_STORAGE_KEY, []),
        loadJson<TimelineEntry[]>(TIMELINE_STORAGE_KEY, []),
        loadJson<{ workspaceId?: string; conversationId?: string } | null>(ACTIVE_SELECTION_STORAGE_KEY, null),
        loadJson<WorkspaceMentionHistory[]>(MENTION_HISTORY_STORAGE_KEY, []),
        loadJson<Record<string, number>>(SESSION_CURSORS_STORAGE_KEY, {}),
        loadSecret(TOKEN_STORAGE_KEY),
      ]);

      if (!alive) {
        return;
      }

      const nextSettings = fromPersistedSettings(storedSettings, storedToken);
      const normalizedWorkspaces = storedWorkspaces.map((workspace) => ({
        ...workspace,
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
    void saveJson(TIMELINE_STORAGE_KEY, timeline.slice(0, MAX_TIMELINE_ITEMS));
  }, [hydrated, timeline]);

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
    const bySession = sessionId ? conversations.find((conversation) => conversation.sessionId === sessionId) : null;
    if (sessionId && !bySession) {
      return {
        workspaceId: '',
        conversationId: '',
        conversation: null,
        sessionId,
        threadId,
      };
    }
    const byThread = !sessionId && threadId
      ? conversations.find((conversation) => normalizeThreadId(conversation.threadId) === threadId)
      : null;
    const conversation = bySession ?? byThread ?? conversations.find((item) => item.id === activeConversationRef.current) ?? null;

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
      const chatEntry = classifyChatEvent(event, target.workspaceId, target.conversationId);
      if (chatEntry) {
        upsertChatTimeline(chatEntry, event.type === 'codex.item.agentMessage.delta');
        if (event.type === 'codex.item.completed') {
          setConversationThinking(targetConversationId, false);
        }
      }
      const progressEntry = classifyProgressEvent(event, target.workspaceId, target.conversationId);
      if (progressEntry) {
        upsertChatTimeline(progressEntry, false);
      }
      const protocolError = extractProtocolError(event.type, data);
      if (event.type === 'codex.control.request.accepted' && data.operation === 'codex.local.turn') {
        setConversationThinking(targetConversationId, true);
      }
      if (isTurnTerminalEvent(event)) {
        setConversationThinking(targetConversationId, false);
        const queuedDrafts = queuedChatDraftsRef.current[targetConversationId] ?? [];
        const nextQueuedDraft = queuedDrafts[0]?.trim() ?? '';
        if (
          nextQueuedDraft &&
          !queuedChatDispatchingRef.current.has(targetConversationId)
        ) {
          queuedChatDispatchingRef.current.add(targetConversationId);
          void (async () => {
            try {
              const sent = await sendQueuedChatDraftRef.current(nextQueuedDraft, targetConversationId);
              if (sent) {
                setQueuedChatDrafts((current) => {
                  const queue = current[targetConversationId] ?? [];
                  if (queue.length === 0 || queue[0]?.trim() !== nextQueuedDraft) {
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
        const pending = findPendingLocalStart(event, data);
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
      if (protocolError && !isLocalAdapterAlreadyRunning(protocolError)) {
        setLastError(localTurnErrorMessage(protocolError));
      }
      const maybeTurnId = data.turnId ?? data.turn_id;
      if (typeof maybeTurnId === 'string' && maybeTurnId) {
        setConversationTurnId(targetConversationId, maybeTurnId);
      }
    },
    [appendTimeline, findPendingLocalStart, persistSessionCursors, resetWorkspaceSession, resolveTimelineTarget, settlePendingLocalStart, settlePendingThreadStart, setConversationThinking, setConversationTurnId, updateConversation, upsertChatTimeline],
  );

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
        attachedSessionIdsRef.current.clear();
        setConnectionState('open');
        pushSystem('已连接', crypto ? `${wsUrl} · ${crypto.protocol}` : wsUrl);
        void checkConnectionHealth();
        void refreshServerVersion();
      };

      socket.onmessage = (event) => {
        try {
          const text = socketCryptoRef.current?.decryptServerText(String(event.data)) ?? String(event.data);
          const data = JSON.parse(text) as ServerEvent;
          appendEvent(data);
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
        socketCryptoRef.current = null;
        pushSystem('已断开', wsUrl);
      };
    } catch (error) {
      setConnectionState('error');
      socketCryptoRef.current = null;
      setLastError(error instanceof Error ? error.message : 'failed to connect');
    }
  }, [appendEvent, checkConnectionHealth, closeSocket, pushSystem, refreshServerVersion, settings]);

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

      const message = { id: requestId, type, payload };
      const json = JSON.stringify(message);
      socket.send(socketCryptoRef.current?.encryptClientText(json) ?? json);
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

  const createConversation = useCallback((workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      Alert.alert('未找到工作区', '请返回后重新选择工作区。');
      return null;
    }

    const count = conversations.filter((conversation) => conversation.workspaceId === workspaceId).length;
    const next: ConversationRecord = {
      id: createRequestId('conversation'),
      workspaceId,
      title: '',
      sessionId: createSessionId(`${workspace.name}_${count + 1}`),
      threadId: '',
      localAdapterState: 'idle',
      mode: 'implement',
      goalStatus: '',
      goalObjective: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConversations((current) => [next, ...current]);
    setActiveWorkspaceId(workspaceId);
    setActiveConversationId(next.id);
    return next;
  }, [conversations, workspaces]);

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

  const renameConversation = useCallback((conversationId: string, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      Alert.alert('标题不能为空', '请输入新的对话标题。');
      return;
    }
    updateConversation(conversationId, { title: nextTitle });
  }, [updateConversation]);

  const forkConversation = useCallback((conversationId: string) => {
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      Alert.alert('未找到对话', '请返回后重新选择对话。');
      return null;
    }
    const nextConversation = forkConversationRecord(conversation);
    setConversations((current) => [nextConversation, ...current]);
    setActiveWorkspaceId(nextConversation.workspaceId);
    setActiveConversationId(nextConversation.id);
    return nextConversation;
  }, [conversations]);

  const removeConversation = useCallback((conversationId: string) => {
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      return;
    }
    const workspaceConversations = conversations.filter((item) => item.workspaceId === conversation.workspaceId);
    setConversations((current) => current.filter((item) => item.id !== conversationId));
    setTimeline((current) => current.filter((entry) => entry.conversationId !== conversationId));
    const pruneConversationState = <T,>(current: Record<string, T>) => {
      const next = { ...current };
      delete next[conversationId];
      return next;
    };
    setChatDrafts(pruneConversationState);
    setQueuedChatDrafts(pruneConversationState);
    setComposerSelections(pruneConversationState);
    setTurnIds(pruneConversationState);
    setThinkingConversations(pruneConversationState);
    if (activeConversationId === conversationId) {
      const next = workspaceConversations.find((item) => item.id !== conversationId);
      setActiveConversationId(next?.id ?? '');
    }
  }, [activeConversationId, conversations]);

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
      replayLimit: RECONNECT_REPLAY_LIMIT,
    }, conversation);
  }, [sendWorkspaceCommand]);

  useEffect(() => {
    if (connectionState !== 'open' || !activeWorkspace || !activeConversation?.sessionId) {
      return;
    }
    const sessionId = sessionIdForConversation(activeWorkspace, activeConversation);
    if (attachedSessionIdsRef.current.has(sessionId)) {
      return;
    }
    attachedSessionIdsRef.current.add(sessionId);
    attachWorkspaceConversation(activeWorkspace, activeConversation);
  }, [activeConversation, activeWorkspace, attachWorkspaceConversation, connectionState]);

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
          model: workspace.model,
          approvalPolicy: workspace.approvalPolicy,
          sandboxMode: workspace.sandboxMode,
          configOverrides: {},
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
    [pushSystem, sendProtocolMessage, updateConversation],
  );

  const ensureThreadId = useCallback(
    (workspace: WorkspaceRecord, conversation: ConversationRecord, forceNewThread = false) => {
      const sessionId = sessionIdForConversation(workspace, conversation);
      const currentThreadId = normalizeThreadId(conversation.threadId);
      if (!forceNewThread && currentThreadId) {
        return Promise.resolve(currentThreadId);
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
            ephemeral: true,
            cwd: workspace.path,
            model: workspace.model || settings.defaultModel || undefined,
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
    [sendProtocolMessage, settings.approvalPolicy, settings.defaultModel, settings.sandboxMode],
  );

  const sendLocalTurn = useCallback(
    async (text: string, mode: ConversationRecord['mode'] = 'implement', conversationId = activeConversationRef.current) => {
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
        input: [{ type: 'text', text }],
        approvalPolicy: workspace.approvalPolicy || settings.approvalPolicy || undefined,
        sandboxPolicy: sandboxPolicyForMode(workspace.sandboxMode || settings.sandboxMode),
        serviceTier: workspace.serviceTier || undefined,
        collaborationMode: {
          mode: 'default',
          settings: {
            model: workspace.model || settings.defaultModel,
            developerInstructions: null,
          },
        },
      };

      if (sendProtocolMessage('codex.local.turn', payload, createRequestId('msg'), {
        workspaceId: workspace.id,
        conversationId: conversation.id,
      })) {
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === context.conversation.id
              ? {
                  ...conversation,
                  sessionId: commandWorkspace.sessionId,
                  threadId,
                  mode,
                  title: conversation.title === '默认对话' ? text.slice(0, 18) || conversation.title : conversation.title,
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
    [appendTimeline, ensureThreadId, getConversationContext, sendProtocolMessage, setConversationThinking, settings.approvalPolicy, settings.defaultModel, settings.sandboxMode, startLocalAdapter],
  );

  useEffect(() => {
    sendQueuedChatDraftRef.current = (text, conversationId) => sendLocalTurn(text, 'implement', conversationId);
  }, [sendLocalTurn]);

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

      if (lower === 'permissions' || lower === 'permission') {
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
        const nextModel = rest[0]?.trim() ?? '';
        if (!nextModel) {
          Alert.alert('Model', workspace.model || settings.defaultModel || '未设置模型');
          return;
        }
        updateWorkspace(workspace.id, { model: nextModel });
        appendTimeline(makeSystemEntry(
          `Model updated to ${nextModel}`,
          '后续新 thread 和 turn 会把该模型作为 Codex app-server 的 model 参数发送。',
          workspace.id,
          conversation.id,
        ));
        return;
      }

      if (lower === 'fast') {
        const enabled = workspace.serviceTier !== 'priority';
        updateWorkspace(workspace.id, { serviceTier: enabled ? 'priority' : null });
        appendTimeline(makeSystemEntry(
          enabled ? 'Fast mode enabled' : 'Fast mode disabled',
          enabled ? '后续新 thread 和 turn 会发送 serviceTier=priority。' : '后续请求会回到默认服务层级。',
          workspace.id,
          conversation.id,
        ));
        return;
      }

      if (lower === 'approve' || lower === 'approval') {
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
        sendLocalMethod('skills/list', { cwds: [workspace.path], forceReload: /reload|refresh|true|1/i.test(rest[0] ?? '') }, 'Skills requested', '已请求 Codex app-server 扫描当前工作区 Skills。');
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
        if (conversation.threadId) {
          sendLocalMethod('thread/backgroundTerminals/clean', { threadId: conversation.threadId }, 'Background terminals clean requested', '已请求 Codex 清理后台终端。');
        }
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
        sendLocalTurn('show and summarize the current git diff, including untracked files when relevant', 'implement', conversation.id);
        return;
      }

      if (lower === 'ps') {
        addCommandNotice('Background terminals', '当前移动端没有独立后台终端列表；可用 /stop 清理当前 thread 的后台终端。');
        return;
      }

      if (lower === 'rollout') {
        addCommandNotice('Rollout', '移动端不会直接读取 Codex 本地 rollout 路径；后端事件会在时间线中显示。');
        return;
      }

      if (lower === 'resume' || lower === 'fork' || lower === 'side' || lower === 'agent' || lower === 'subagents') {
        addCommandNotice(`/${lower} recognized`, '移动端以工作区和对话列表管理会话；该命令已识别，等价操作请使用当前导航中的对话入口。');
        return;
      }

      if (lower === 'copy' || lower === 'raw') {
        addCommandNotice(`/${lower} recognized`, '移动端使用系统选择和复制；该命令已识别但不需要发送到后端。');
        return;
      }

      if (lower === 'ide' || lower === 'keymap' || lower === 'vim' || lower === 'theme' || lower === 'title' || lower === 'statusline') {
        addCommandNotice(`/${lower} recognized`, '这是 TUI/IDE 展示配置命令；移动端已识别，但当前没有等价 app-server 执行动作。');
        return;
      }

      if (
        lower === 'setup-default-sandbox' ||
        lower === 'sandbox-add-read-dir' ||
        lower === 'experimental' ||
        lower === 'collab' ||
        lower === 'memories' ||
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
      appendTimeline,
      createConversation,
      ensureThreadId,
      getConversationContext,
      openPermissionsMenu,
      pendingRequests,
      selectConversation,
      selectedRequest,
      sendApprovalResponse,
      sendLocalTurn,
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
    if (!text) {
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
    setConversationChatDraft(conversationId, '');
    setConversationComposerSelection(conversationId, DEFAULT_COMPOSER_SELECTION);
    if (isThinking) {
      setQueuedChatDrafts((current) => ({
        ...current,
        [conversationId]: [...(current[conversationId] ?? []), text],
      }));
      appendTimeline(makeSystemEntry('消息已加入候选', '当前任务完成后会自动继续发送。', workspace.id, conversationId));
      return;
    }
    sendSlashCommand(text, conversationId);
  }, [appendTimeline, chatDrafts, getConversationContext, thinkingConversations, rememberMentionReferences, sendSlashCommand, setConversationChatDraft, setConversationComposerSelection]);

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

  if (!hydrated) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="light" />
        <Text style={styles.loadingTitle}>TodeX</Text>
        <Text style={styles.loadingText}>正在加载设置和工作区...</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.appRoot}>
      <SafeAreaProvider>
        <NavigationContainer>
          <StatusBar style="dark" />
          <Stack.Navigator
            initialRouteName="Workspaces"
            screenOptions={{
              headerStyle: { backgroundColor: '#ffffff' },
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
                  timeline={timeline}
                  createConversation={createConversation}
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
                  composerSelection={composerSelections[props.route.params.conversationId] ?? DEFAULT_COMPOSER_SELECTION}
                  isThinking={thinkingConversations[props.route.params.conversationId] === true}
                  lastError={lastError}
                  setChatDraft={(value) => setConversationChatDraft(props.route.params.conversationId, value)}
                  setComposerSelection={(value) => setConversationComposerSelection(props.route.params.conversationId, value)}
                  submitChat={submitChat}
                  stopThinking={stopThinking}
                  sendApprovalResponse={sendApprovalResponse}
                  selectConversation={selectConversation}
                  runWorkspaceCommand={runWorkspaceCommand}
                  removeWorkspace={removeWorkspace}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Settings" options={{ title: '设置' }}>
              {(props) => (
                <SettingsScreen
                  {...props}
                  settings={settings}
                  setSettings={setSettings}
                  serverVersion={serverVersion}
                  activeWorkspace={activeWorkspace}
                  pendingRequestCount={pendingRequests.length}
                  turnId={activeTurnId}
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
      </SafeAreaProvider>
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
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.listContent}>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>TodeX</Text>
          <View style={[styles.statusPill, connectionState === 'open' ? styles.statusOpen : styles.statusMuted]}>
            <Text style={styles.statusText}>{connectionState}</Text>
          </View>
        </View>

        {workspaces.length === 0 ? (
          <EmptyState text="还没有工作区。点右上角 + 添加一个目录。" />
        ) : (
          workspaces.map((workspace) => {
            const count = conversations.filter((conversation) => conversation.workspaceId === workspace.id).length;
            return (
              <Pressable
                key={workspace.id}
                onPress={() => {
                  selectWorkspace(workspace.id);
                  navigation.navigate('Conversations', { workspaceId: workspace.id });
                }}
                onLongPress={() => openWorkspaceActions(workspace)}
                style={styles.listItem}
              >
                <View style={styles.itemAvatar}>
                  <Text style={styles.itemAvatarText}>{workspace.name.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={styles.itemMain}>
                  <View style={styles.itemHeader}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {workspace.name}
                    </Text>
                    <Text style={styles.itemTag}>{count} 个对话</Text>
                  </View>
                  <Text style={styles.itemBody} numberOfLines={1}>
                    {workspace.path}
                  </Text>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>新建工作区</Text>
              <Pressable onPress={() => setModalVisible(false)}>
                <Text style={styles.modalClose}>关闭</Text>
              </Pressable>
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
          </View>
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
    </View>
  );
}

function ConversationListScreen({
  navigation,
  route,
  workspaces,
  conversations,
  timeline,
  createConversation,
  selectWorkspace,
  selectConversation,
  renameConversation,
  forkConversation,
  removeConversation,
}: NativeStackScreenProps<RootStackParamList, 'Conversations'> & {
  workspaces: WorkspaceRecord[];
  conversations: ConversationRecord[];
  timeline: TimelineEntry[];
  createConversation: (workspaceId: string) => ConversationRecord | null;
  selectWorkspace: (workspaceId: string) => void;
  selectConversation: (workspaceId: string, conversationId: string) => void;
  renameConversation: (conversationId: string, title: string) => void;
  forkConversation: (conversationId: string) => ConversationRecord | null;
  removeConversation: (conversationId: string) => void;
}) {
  const [renamingConversation, setRenamingConversation] = useState<ConversationRecord | null>(null);
  const workspace = workspaces.find((item) => item.id === route.params.workspaceId) ?? null;
  const workspaceConversations = conversations.filter((conversation) => conversation.workspaceId === route.params.workspaceId);

  useEffect(() => {
    selectWorkspace(route.params.workspaceId);
  }, [route.params.workspaceId, selectWorkspace]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: workspace?.name ?? '对话',
      headerRight: () => (
        <HeaderIconButton
          label="+"
          onPress={() => {
            const next = createConversation(route.params.workspaceId);
            if (next) {
              navigation.navigate('Chat', { workspaceId: route.params.workspaceId, conversationId: next.id });
            }
          }}
        />
      ),
    });
  }, [createConversation, navigation, route.params.workspaceId, workspace?.name]);

  const conversationTitle = (conversation: ConversationRecord) => {
    const latest = timeline.find((entry) => entry.conversationId === conversation.id && isVisibleConversationEntry(entry));
    return conversation.title || conversationPreviewText(latest);
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
            { text: '删除', style: 'destructive', onPress: () => removeConversation(conversation.id) },
          ]);
        },
      },
      { text: '取消', style: 'cancel' },
    ]);
  };

  if (!workspace) {
    return (
      <View style={styles.centerScreen}>
        <EmptyState text="工作区不存在。请返回工作区列表重新选择。" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.listContent}>
      <View style={styles.workspaceSummary}>
        <Text style={styles.summaryTitle} numberOfLines={1}>
          {workspace.name}
        </Text>
        <Text style={styles.summaryPath} numberOfLines={2}>
          {workspace.path}
        </Text>
      </View>

      {workspaceConversations.length === 0 ? (
        <EmptyState text="还没有对话。点右上角 + 创建一个纯粹的新对话。" />
      ) : (
        workspaceConversations.map((conversation) => {
          const latest = timeline.find((entry) => entry.conversationId === conversation.id && isVisibleConversationEntry(entry));
          const preview = conversation.title || conversationPreviewText(latest);
          const active = isConversationActive(conversation);
          return (
            <Pressable
              key={conversation.id}
              onPress={() => {
                selectConversation(workspace.id, conversation.id);
                navigation.navigate('Chat', { workspaceId: workspace.id, conversationId: conversation.id });
              }}
              onLongPress={() => openConversationActions(conversation)}
              style={[styles.listItem, active && styles.listItemActive]}
            >
              <View style={[styles.conversationAvatar, active && styles.conversationAvatarActive]}>
                <Text style={[styles.conversationAvatarText, active && styles.conversationAvatarTextActive]}>
                  {preview.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={styles.itemMain}>
                <View style={styles.itemHeader}>
                  <Text style={[styles.itemTitle, active && styles.itemTitleActive]} numberOfLines={1}>
                    {preview}
                  </Text>
                  <Text style={[styles.itemTag, active && styles.itemTagActive]}>
                    {active ? '运行中' : nowLabel(conversation.updatedAt)}
                  </Text>
                </View>
                <Text style={styles.itemBody} numberOfLines={1}>
                  {active ? '正在处理当前对话' : nowLabel(conversation.updatedAt)}
                </Text>
              </View>
            </Pressable>
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
  composerSelection,
  isThinking,
  lastError,
  setChatDraft,
  setComposerSelection,
  submitChat,
  stopThinking,
  sendApprovalResponse,
  selectConversation,
  runWorkspaceCommand,
  removeWorkspace,
}: NativeStackScreenProps<RootStackParamList, 'Chat'> & {
  settings: ConnectionSettings;
  workspaces: WorkspaceRecord[];
  conversations: ConversationRecord[];
  timeline: TimelineEntry[];
  pendingRequests: PendingRequest[];
  selectedRequest: PendingRequest | null;
  chatDraft: string;
  composerSelection: TextInputSelectionChangeEventData['selection'];
  isThinking: boolean;
  lastError: string;
  setChatDraft: Dispatch<SetStateAction<string>>;
  setComposerSelection: Dispatch<SetStateAction<TextInputSelectionChangeEventData['selection']>>;
  submitChat: (conversationId: string) => void;
  stopThinking: (conversationId: string) => void;
  sendApprovalResponse: (accepted: boolean, request: PendingRequest) => boolean;
  selectConversation: (workspaceId: string, conversationId: string) => void;
  runWorkspaceCommand: (workspace: WorkspaceRecord, conversation: ConversationRecord, command: 'start' | 'status' | 'attach' | 'stop' | 'interrupt') => void;
  removeWorkspace: (workspaceId: string) => void;
}) {
  const [menuVisible, setMenuVisible] = useState(false);
  const [mentionEntries, setMentionEntries] = useState<WorkspaceEntry[]>([]);
  const [expandedProgressIds, setExpandedProgressIds] = useState<Set<string>>(() => new Set());
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const messageScrollRef = useRef<ScrollView | null>(null);
  const shouldFollowLatestRef = useRef(true);
  const initialLatestScrollRef = useRef(true);
  const composerInputRef = useRef<TextInput | null>(null);
  const autoExpandedProgressIdsRef = useRef<Set<string>>(new Set());
  const autoExpandedRequestIdsRef = useRef<Map<string, string[]>>(new Map());
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();
  const composerPaddingBottom = 12 + (keyboardInset > 0 ? 0 : insets.bottom);
  const workspace = workspaces.find((item) => item.id === route.params.workspaceId) ?? null;
  const conversation = conversations.find((item) => item.id === route.params.conversationId) ?? null;
  const conversationMessages = timeline
    .filter((entry) => entry.conversationId === route.params.conversationId)
    .filter(isVisibleConversationEntry)
    .slice()
    .reverse();
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
      }).slice(0, 6)
    : [];
  const mentionTrigger = slashSuggestions.length === 0 ? findMentionTrigger(chatDraft, composerSelection.start) : null;
  const mentionSuggestions = buildMentionSuggestions(mentionTrigger, mentionEntries);

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
      <View style={styles.centerScreen}>
        <EmptyState text="对话不存在。请返回后重新选择。" />
      </View>
    );
  }

  return (
    <View style={[styles.chatRoot, { paddingBottom: keyboardInset }]}>
      {lastError ? <Text style={styles.inlineError}>{lastError}</Text> : null}

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
          <Pressable
            accessibilityLabel="跳到最新消息"
            onPress={jumpToLatest}
            style={styles.jumpToLatestButton}
          >
            <Text style={styles.jumpToLatestText}>↓</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.composer, { paddingBottom: composerPaddingBottom }]}>
        {slashSuggestions.length > 0 ? (
          <View style={styles.slashPanel}>
            {slashSuggestions.map((item) => (
              <Pressable
                key={item.command}
                style={styles.slashItem}
                onPress={() => {
                  const nextText = `${item.command} `;
                  setChatDraft(nextText);
                  setComposerSelection({ start: nextText.length, end: nextText.length });
                }}
              >
                <Text style={styles.slashCommand} numberOfLines={1}>{item.command}</Text>
                <Text style={styles.slashDescription} numberOfLines={1}>{item.description || item.title}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {mentionSuggestions.length > 0 ? (
          <View style={styles.mentionPanel}>
            {mentionSuggestions.map((item) => (
              <Pressable
                key={item.id}
                style={styles.mentionItem}
                onPress={() => selectMention(item)}
              >
                <View style={styles.mentionIcon}>
                  <Text style={styles.mentionIconText}>@</Text>
                </View>
                <View style={styles.mentionMain}>
                  <Text style={styles.mentionTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.mentionDescription} numberOfLines={1}>{item.description}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
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
          {isThinking ? (
            <Pressable
              accessibilityLabel="中断当前任务"
              onPress={() => stopThinking(route.params.conversationId)}
              style={styles.stopButton}
            >
              <Text style={styles.stopButtonText}>ESC</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => submitChat(route.params.conversationId)}
            style={styles.sendButton}
          >
            <Text style={styles.sendButtonText}>发送</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={menuVisible} animationType="fade" transparent onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuVisible(false)}>
          <View style={styles.menuSheet}>
            <Text style={styles.menuTitle}>{workspace.name}</Text>
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
              title="移除工作区"
              danger
              onPress={() => {
                removeWorkspace(workspace.id);
                navigation.popToTop();
              }}
              close={() => setMenuVisible(false)}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function SettingsScreen({
  settings,
  setSettings,
  serverVersion,
  activeWorkspace,
  pendingRequestCount,
  turnId,
  connectionState,
  connectionHealth,
  lastError,
  connect,
  closeSocket,
  refreshServerVersion,
}: NativeStackScreenProps<RootStackParamList, 'Settings'> & {
  settings: ConnectionSettings;
  setSettings: React.Dispatch<React.SetStateAction<ConnectionSettings>>;
  serverVersion: ServerVersion | null;
  activeWorkspace: WorkspaceRecord | null;
  pendingRequestCount: number;
  turnId: string;
  connectionState: ConnectionState;
  connectionHealth: ConnectionHealth;
  lastError: string;
  connect: () => void;
  closeSocket: (manual?: boolean) => void;
  refreshServerVersion: () => void;
}) {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [pairingScannerVisible, setPairingScannerVisible] = useState(false);
  const [pairingScannerArmed, setPairingScannerArmed] = useState(true);
  const isConnected = connectionState === 'open';
  const isConnecting = connectionState === 'connecting';
  const connectionActionTitle = isConnected || isConnecting ? '中断' : '连接';
  const connectionAction = isConnected || isConnecting ? () => closeSocket(true) : connect;
  const statusStyle =
    connectionState === 'open'
      ? styles.connectionCardOnline
      : connectionState === 'connecting'
        ? styles.connectionCardChecking
        : connectionState === 'error' || connectionHealth.status === 'offline'
          ? styles.connectionCardOffline
          : styles.connectionCardIdle;
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
    setPairingScannerArmed(true);
    setPairingScannerVisible(true);
  }, [cameraPermission?.granted, requestCameraPermission]);

  const applyPairingText = useCallback(async (raw: string) => {
    try {
      const pairing = await resolvePairingPayload(raw);
      setSettings((current) => applyPairingToSettings(current, pairing));
      setPairingScannerVisible(false);
      setPairingScannerArmed(false);
      Alert.alert('已导入连接', `${pairing.serverUrl} · ${pairing.encryptionProtocol}`);
    } catch (error) {
      Alert.alert('配对失败', error instanceof Error ? error.message : '二维码内容无效');
    }
  }, [setSettings]);

  const pastePairingFromClipboard = useCallback(async () => {
    const raw = await Clipboard.getStringAsync();
    await applyPairingText(raw);
  }, [applyPairingText]);

  const handlePairingScan = useCallback((result: BarcodeScanningResult) => {
    if (!pairingScannerArmed) {
      return;
    }
    setPairingScannerArmed(false);
    void applyPairingText(result.data);
  }, [applyPairingText, pairingScannerArmed]);

  return (
    <ScrollView contentContainerStyle={styles.pageContent}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>连接</Text>
        <View style={styles.formBlock}>
          <View style={[styles.connectionCard, statusStyle]}>
            <View style={styles.connectionHeader}>
              <View style={[styles.connectionDot, dotStyle]} />
              <View style={styles.connectionSummary}>
                <Text style={styles.connectionTitle}>{connectionStateLabel(connectionState)}</Text>
                <Text style={styles.connectionSubtitle} numberOfLines={1}>
                  {healthLabelOf(connectionHealth)}
                </Text>
              </View>
              <Text style={styles.connectionLatency}>{latencyLabelOf(connectionHealth.latencyMs)}</Text>
            </View>
            <View style={styles.connectionMetaRow}>
              <Text style={styles.connectionMeta}>WebSocket: {connectionState}</Text>
              <Text style={styles.connectionMeta}>
                {connectionHealth.lastCheckedAt ? `检测: ${nowLabel(connectionHealth.lastCheckedAt)}` : '检测: --'}
              </Text>
            </View>
          </View>
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
          <View style={styles.encryptionBlock}>
            <Text style={styles.fieldLabel}>Transport encryption</Text>
            <Row>
              <ActionButton
                title="明文"
                onPress={() => setSettings((current) => ({ ...current, encryptionProtocol: 'none' }))}
                tone={settings.encryptionProtocol === 'none' ? 'solid' : 'ghost'}
              />
              <ActionButton
                title="X25519"
                onPress={() => setSettings((current) => ({ ...current, encryptionProtocol: 'x25519' }))}
                tone={settings.encryptionProtocol === 'x25519' ? 'solid' : 'ghost'}
              />
              <ActionButton
                title="ML-KEM-768"
                onPress={() => setSettings((current) => ({ ...current, encryptionProtocol: 'ml-kem-768' }))}
                tone={settings.encryptionProtocol === 'ml-kem-768' ? 'solid' : 'ghost'}
              />
            </Row>
            <Text style={styles.connectionMeta}>当前: {encryptionLabel}</Text>
            <Field
              label="Encryption public key"
              value={settings.encryptionPublicKey}
              onChangeText={(value) => setSettings((current) => ({ ...current, encryptionPublicKey: value }))}
              placeholder="Scan backend QR to fill"
              multiline
            />
            <Row>
              <ActionButton title="扫描后端二维码" onPress={openPairingScanner} tone="solid" />
              <ActionButton title="粘贴配对 JSON" onPress={pastePairingFromClipboard} tone="ghost" />
            </Row>
          </View>
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
          {lastError ? <Text style={styles.errorText}>{lastError}</Text> : null}
        </View>
      </View>

      <Modal
        visible={pairingScannerVisible}
        animationType="slide"
        onRequestClose={() => setPairingScannerVisible(false)}
      >
        <View style={styles.scannerScreen}>
          <CameraView
            style={styles.scannerCamera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={pairingScannerArmed ? handlePairingScan : undefined}
          />
          <View style={styles.scannerFooter}>
            <Text style={styles.scannerTitle}>扫描 TodeX 后端配对二维码</Text>
            <ActionButton title="关闭" onPress={() => setPairingScannerVisible(false)} tone="ghost" />
          </View>
        </View>
      </Modal>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>默认参数</Text>
        <View style={styles.formBlock}>
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
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>运行状态</Text>
        <View style={styles.diagnostics}>
          <Diagnostic label="版本" value={serverVersion ? `${serverVersion.name} ${serverVersion.version}` : 'unknown'} />
          <Diagnostic label="数据目录" value={serverVersion?.data_dir ?? 'unknown'} />
          <Diagnostic label="工作区根目录" value={serverVersion?.workspace_root ?? 'unknown'} />
          <Diagnostic label="当前目录" value={activeWorkspace?.path ?? 'none'} />
          <Diagnostic label="待处理请求" value={String(pendingRequestCount)} />
          <Diagnostic label="当前 Turn" value={turnId || 'unknown'} />
        </View>
      </View>
    </ScrollView>
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
  const content = (
    <View style={[styles.bubble, collapsible && styles.progressBubble, outgoing && styles.bubbleOutgoing, system && styles.bubbleSystem]}>
      <View style={styles.bubbleMetaRow}>
        {collapsible ? (
          <Text style={styles.progressChevron}>{collapsed ? '›' : '⌄'}</Text>
        ) : null}
        {!hideTitle ? (
          <Text style={[styles.bubbleTitle, outgoing && styles.bubbleTitleOutgoing]} numberOfLines={1}>
            {entry.title}
          </Text>
        ) : (
          <View style={styles.hiddenBubbleTitleSpacer} />
        )}
        <Text style={[styles.bubbleTime, outgoing && styles.bubbleTimeOutgoing]}>{nowLabel(entry.at)}</Text>
      </View>
      {entry.subtitle && !collapsed ? (
        <Text selectable style={[styles.bubbleText, outgoing && styles.bubbleTextOutgoing]}>{entry.subtitle}</Text>
      ) : null}
      {entry.subtitle && collapsed ? (
        <Text selectable style={styles.collapsedProgressText} numberOfLines={1}>
          {entry.subtitle}
        </Text>
      ) : null}
      {pendingRequest ? (
        <View style={styles.approvalActions}>
          <MiniButton title="同意" onPress={() => onApprovalResponse?.(true, pendingRequest)} />
          <MiniButton title="拒绝" onPress={() => onApprovalResponse?.(false, pendingRequest)} />
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.bubbleRow, outgoing && styles.bubbleRowOutgoing]}>
      <Pressable
        onPress={collapsible ? () => onToggleProgress?.(entry, collapsed) : undefined}
        onLongPress={copyText}
        delayLongPress={360}
        style={collapsible ? styles.progressPressable : undefined}
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
    <View style={styles.bubbleRow}>
      <View style={styles.executionGroupShell}>
        <Pressable onPress={() => onToggleGroup(id, collapsed)} style={styles.executionGroupHeader}>
          <Text style={styles.progressChevron}>{collapsed ? '›' : '⌄'}</Text>
          <Text style={styles.executionGroupSummary} numberOfLines={1}>
            {summary}
          </Text>
          <Text style={styles.bubbleTime}>{latestEntry ? nowLabel(latestEntry.at) : ''}</Text>
        </Pressable>
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
      </View>
    </View>
  );
}

function EmptyState({ text }: { text: string }) {
  return <Text style={styles.emptyState}>{text}</Text>;
}

function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function HeaderIconButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.headerIconButton}>
      <Text style={styles.headerIconText}>{label}</Text>
    </Pressable>
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
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.actionButton,
        tone === 'ghost' && styles.actionButtonGhost,
        tone === 'danger' && styles.actionButtonDanger,
        disabled && styles.actionButtonDisabled,
      ]}
    >
      <Text
        style={[
          styles.actionButtonText,
          tone === 'ghost' && styles.actionButtonTextGhost,
          tone === 'danger' && styles.actionButtonTextDanger,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function MiniButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.miniButton}>
      <Text style={styles.miniButtonText}>{title}</Text>
    </Pressable>
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
    <Pressable
      onPress={() => {
        close();
        onPress();
      }}
      style={styles.menuItem}
    >
      <Text style={[styles.menuItemText, danger && styles.menuDangerText]}>{title}</Text>
    </Pressable>
  );
}

function Diagnostic({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.diagnosticRow}>
      <Text style={styles.diagnosticLabel}>{label}</Text>
      <Text style={styles.diagnosticValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
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
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  multiline?: boolean;
  editable?: boolean;
  secureTextEntry?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor="#8a93a1"
        style={[styles.input, multiline && styles.inputMultiline, !editable && styles.inputDisabled]}
        multiline={multiline}
        editable={editable}
        secureTextEntry={secureTextEntry}
        autoCapitalize="none"
        autoCorrect={false}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </View>
  );
}

function PromptModal({
  visible,
  title,
  initialValue,
  placeholder,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  initialValue: string;
  placeholder: string;
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
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
          <Row>
            <ActionButton title="保存" onPress={() => onSubmit(value)} />
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
  },
  bubbleRowOutgoing: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '88%',
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: 10,
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
    maxHeight: 110,
    minHeight: 44,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d7dce0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#17202a',
    fontSize: 14,
    textAlignVertical: 'top',
  },
  composerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sendButton: {
    minHeight: 44,
    backgroundColor: '#17202a',
    borderRadius: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  stopButton: {
    minHeight: 44,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#c75757',
    borderRadius: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopButtonText: {
    color: '#a23b3b',
    fontSize: 14,
    fontWeight: '800',
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

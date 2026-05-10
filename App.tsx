import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Keyboard,
  type KeyboardEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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
  inferApprovalResponseType,
  isApprovalLikeRequest,
  normalizeServerUrl,
  shortJson,
  summarizeEventType,
} from './src/lib/todex';
import { loadJson, loadSecret, saveJson, saveSecret } from './src/lib/storage';

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
  threadId: string;
  createdAt: number;
  updatedAt: number;
};

type PendingLocalStart = {
  workspaceId: string;
  requestId: string;
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

function localAdapterStateOf(workspace: WorkspaceRecord | null): LocalAdapterState {
  return workspace?.localAdapterState ?? 'idle';
}

function localTurnErrorMessage(text: string): string {
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
};

type PersistedSettings = Omit<ConnectionSettings, 'authToken'>;

const Stack = createNativeStackNavigator<RootStackParamList>();
enableScreens(true);

const SETTINGS_STORAGE_KEY = 'todex.mobile.settings.v1';
const WORKSPACES_STORAGE_KEY = 'todex.mobile.workspaces.v1';
const CONVERSATIONS_STORAGE_KEY = 'todex.mobile.conversations.v1';
const TOKEN_STORAGE_KEY = 'todex.mobile.token.v1';
const MAX_TIMELINE_ITEMS = 260;
const MAX_EVENTS = 220;

const defaultSettings: ConnectionSettings = {
  serverUrl: 'http://127.0.0.1:7345',
  authToken: '',
  tenantId: 'local',
  defaultWorkspacePath: '/home/dev/projects',
  defaultThreadId: 'thread_1',
  defaultModel: 'gpt-5.5',
  approvalPolicy: 'on-request',
  sandboxMode: 'workspace-write',
};

function toPersistedSettings(settings: ConnectionSettings): PersistedSettings {
  const { authToken: _authToken, ...rest } = settings;
  return rest;
}

function fromPersistedSettings(raw: Partial<PersistedSettings> | null | undefined, authToken: string): ConnectionSettings {
  return {
    ...defaultSettings,
    ...raw,
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

function nowLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
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

function classifyEvent(event: ServerEvent, workspaceId: string, conversationId: string): TimelineEntry {
  const data = eventPayloadData(event);
  const title = summarizeEventType(event.type);
  const subtitle = shortJson(data).slice(0, 420);
  return {
    id: eventId(event),
    kind: 'incoming',
    title,
    subtitle,
    raw: shortJson(event),
    at: Date.now(),
    workspaceId,
    conversationId,
  };
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

function createDefaultConversation(workspace: WorkspaceRecord, fallbackThreadId: string): ConversationRecord {
  const createdAt = workspace.createdAt || Date.now();
  return {
    id: createRequestId('conversation'),
    workspaceId: workspace.id,
    title: '默认对话',
    threadId: workspace.threadId || fallbackThreadId,
    createdAt,
    updatedAt: workspace.updatedAt || createdAt,
  };
}

export default function App() {
  const socketRef = useRef<WebSocket | null>(null);
  const activeWorkspaceRef = useRef('');
  const activeConversationRef = useRef('');
  const pendingLocalStartsRef = useRef(new Map<string, PendingLocalStart>());
  const autoConnectAttemptedRef = useRef(false);

  const [hydrated, setHydrated] = useState(false);
  const [autoConnectEnabled, setAutoConnectEnabled] = useState(false);
  const [settings, setSettings] = useState<ConnectionSettings>(defaultSettings);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('');
  const [activeConversationId, setActiveConversationId] = useState('');
  const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
  const [lastError, setLastError] = useState('');
  const [serverVersion, setServerVersion] = useState<ServerVersion | null>(null);
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const [chatDraft, setChatDraft] = useState('');
  const [turnId, setTurnId] = useState('');

  const closeSocket = useCallback(() => {
    if (socketRef.current) {
      try {
        socketRef.current.close();
      } catch {
        // ignore
      }
      socketRef.current = null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [storedSettings, storedWorkspaces, storedConversations, storedToken] = await Promise.all([
        loadJson<PersistedSettings | null>(SETTINGS_STORAGE_KEY, null),
        loadJson<WorkspaceRecord[]>(WORKSPACES_STORAGE_KEY, []),
        loadJson<ConversationRecord[]>(CONVERSATIONS_STORAGE_KEY, []),
        loadSecret(TOKEN_STORAGE_KEY),
      ]);

      if (!alive) {
        return;
      }

      const nextSettings = fromPersistedSettings(storedSettings, storedToken);
      const existingWorkspaceIds = new Set(storedWorkspaces.map((workspace) => workspace.id));
      const normalizedConversations =
        storedConversations.length > 0
          ? storedConversations.filter((conversation) => existingWorkspaceIds.has(conversation.workspaceId))
          : storedWorkspaces.map((workspace) => createDefaultConversation(workspace, nextSettings.defaultThreadId));
      const firstWorkspaceId = storedWorkspaces[0]?.id ?? '';
      const firstConversationId =
        normalizedConversations.find((conversation) => conversation.workspaceId === firstWorkspaceId)?.id ?? '';

      setSettings(nextSettings);
      setWorkspaces(storedWorkspaces);
      setConversations(normalizedConversations);
      setActiveWorkspaceId(firstWorkspaceId);
      setActiveConversationId(firstConversationId);
      setAutoConnectEnabled(Boolean(storedSettings?.serverUrl?.trim()));
      setHydrated(true);
    })();

    return () => {
      alive = false;
      closeSocket();
    };
  }, [closeSocket]);

  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  useEffect(() => {
    activeConversationRef.current = activeConversationId;
  }, [activeConversationId]);

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

  const activeWorkspace = useMemo(
    () => workspaces.find((item) => item.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );

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

  const appendTimeline = useCallback((entry: TimelineEntry) => {
    setTimeline((current) => [entry, ...current].slice(0, MAX_TIMELINE_ITEMS));
  }, []);

  const appendEvent = useCallback(
    (event: ServerEvent) => {
      setEvents((current) => [event, ...current].slice(0, MAX_EVENTS));
      appendTimeline(classifyEvent(event, activeWorkspaceRef.current, activeConversationRef.current));
      const data = eventPayloadData(event);
      const protocolError = extractProtocolError(event.type, data);
      const resolvedId = data.requestId ?? data.request_id;
      if (event.type === 'codex.serverRequest.resolved') {
        if (typeof resolvedId === 'string' && resolvedId) {
          const pending = [...pendingLocalStartsRef.current.values()].find((item) => item.requestId === resolvedId);
          if (pending) {
            clearTimeout(pending.timeoutId);
            pendingLocalStartsRef.current.delete(pending.workspaceId);
            if (protocolError) {
              updateWorkspace(pending.workspaceId, { localAdapterState: 'error' });
              const error = new Error(localTurnErrorMessage(protocolError));
              pending.reject(error);
              setLastError(error.message);
              appendTimeline(makeSystemEntry('本地会话启动失败', error.message, activeWorkspaceRef.current, activeConversationRef.current));
            } else {
              updateWorkspace(pending.workspaceId, { localAdapterState: 'running' });
              pending.resolve();
            }
          }
        }
      }
      if (protocolError) {
        setLastError(localTurnErrorMessage(protocolError));
      }
      const maybeTurnId = data.turnId ?? data.turn_id;
      if (typeof maybeTurnId === 'string' && maybeTurnId) {
        setTurnId(maybeTurnId);
      }
    },
    [appendTimeline, updateWorkspace],
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

  const connect = useCallback(() => {
    closeSocket();
    setLastError('');
    setConnectionState('connecting');

    const wsUrl = buildWebSocketUrl(settings.serverUrl);
    const options = settings.authToken
      ? { headers: { Authorization: `Bearer ${settings.authToken}` } }
      : undefined;

    try {
      const socket = new (WebSocket as typeof WebSocket & {
        new (uri: string, protocols?: string | string[] | null, options?: { headers?: Record<string, string> }): WebSocket;
      })(wsUrl, undefined, options);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnectionState('open');
        pushSystem('已连接', wsUrl);
        void refreshServerVersion();
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as ServerEvent;
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
        setConnectionState((current) => (current === 'open' ? 'closed' : current));
        pushSystem('已断开', wsUrl);
      };
    } catch (error) {
      setConnectionState('error');
      setLastError(error instanceof Error ? error.message : 'failed to connect');
    }
  }, [appendEvent, closeSocket, pushSystem, refreshServerVersion, settings.authToken, settings.serverUrl]);

  useEffect(() => {
    if (!hydrated || !autoConnectEnabled || autoConnectAttemptedRef.current) {
      return;
    }

    autoConnectAttemptedRef.current = true;
    connect();
  }, [autoConnectEnabled, connect, hydrated]);

  const sendProtocolMessage = useCallback(
    (type: string, payload: Record<string, unknown>, requestId = createRequestId('msg')) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        setLastError('请先在设置里连接后端。');
        return false;
      }

      const message = { id: requestId, type, payload };
      socket.send(JSON.stringify(message));
      appendTimeline(makeOutgoingEntry(message, activeWorkspaceRef.current, activeConversationRef.current));
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
      const slug = sanitizeSlug(name) || 'workspace';
      const sessionId = `cdxs_${slug}_${Date.now().toString(36)}`;
      const nextWorkspace: WorkspaceRecord = {
        id,
        name,
        path,
        sessionId,
        tenantId: settings.tenantId,
        threadId: settings.defaultThreadId,
        model: settings.defaultModel,
        approvalPolicy: settings.approvalPolicy,
        sandboxMode: settings.sandboxMode,
        localAdapterState: 'idle',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const nextConversation = createDefaultConversation(nextWorkspace, settings.defaultThreadId);

      setWorkspaces((current) => [nextWorkspace, ...current]);
      setConversations((current) => [nextConversation, ...current]);
      setActiveWorkspaceId(id);
      setActiveConversationId(nextConversation.id);
      pushSystem('已添加目录', nextWorkspace.path);
      return { workspace: nextWorkspace, conversation: nextConversation };
    },
    [
      pushSystem,
      settings.approvalPolicy,
      settings.defaultModel,
      settings.defaultThreadId,
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
      title: `对话 ${count + 1}`,
      threadId: `thread_${Date.now().toString(36)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConversations((current) => [next, ...current]);
    setActiveWorkspaceId(workspaceId);
    setActiveConversationId(next.id);
    setTurnId('');
    return next;
  }, [conversations, workspaces]);

  const removeWorkspace = useCallback(
    (workspaceId: string) => {
      setWorkspaces((current) => current.filter((workspace) => workspace.id !== workspaceId));
      setConversations((current) => current.filter((conversation) => conversation.workspaceId !== workspaceId));
      if (activeWorkspaceId === workspaceId) {
        const next = workspaces.find((workspace) => workspace.id !== workspaceId);
        setActiveWorkspaceId(next?.id ?? '');
        setActiveConversationId(conversations.find((conversation) => conversation.workspaceId === next?.id)?.id ?? '');
      }
    },
    [activeWorkspaceId, conversations, workspaces],
  );

  const sendWorkspaceCommand = useCallback(
    (workspace: WorkspaceRecord, type: string, extra: Record<string, unknown> = {}) => {
      const payload = {
        codexSessionId: workspace.sessionId,
        tenantId: workspace.tenantId,
        ...extra,
      };
      return sendProtocolMessage(type, payload);
    },
    [sendProtocolMessage],
  );

  const startLocalAdapter = useCallback(
    (workspace: WorkspaceRecord) => {
      const currentState = localAdapterStateOf(workspace);
      const existingPending = pendingLocalStartsRef.current.get(workspace.id);

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
          pendingLocalStartsRef.current.delete(workspace.id);
          updateWorkspace(workspace.id, { localAdapterState: 'error' });
          const error = new Error('本地会话启动超时，请先确认 Codex 本地 adapter 可用。');
          setLastError(error.message);
          pushSystem('本地会话启动超时', error.message);
          settleReject(error);
          reject(error);
        }, 15000);

        pendingLocalStartsRef.current.set(workspace.id, {
          workspaceId: workspace.id,
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

        updateWorkspace(workspace.id, { localAdapterState: 'starting' });

        const sent = sendProtocolMessage('codex.local.start', {
          codexSessionId: workspace.sessionId,
          tenantId: workspace.tenantId,
          cwd: workspace.path,
          model: workspace.model,
          approvalPolicy: workspace.approvalPolicy,
          sandboxMode: workspace.sandboxMode,
          configOverrides: {},
        }, requestId);

        if (!sent) {
          clearTimeout(timeoutId);
          pendingLocalStartsRef.current.delete(workspace.id);
          updateWorkspace(workspace.id, { localAdapterState: 'error' });
          const error = new Error('请先在设置里连接后端。');
          reject(error);
        }
      });
    },
    [pushSystem, sendProtocolMessage, updateWorkspace],
  );

  const sendLocalTurn = useCallback(
    async (text: string) => {
      if (!activeWorkspace || !activeConversation) {
        Alert.alert('未选择对话', '请先选择工作区和对话。');
        return;
      }

      try {
        await startLocalAdapter(activeWorkspace);
      } catch (error) {
        const message = error instanceof Error ? error.message : '本地会话未启动';
        setLastError(localTurnErrorMessage(message));
        return;
      }

      const payload = {
        codexSessionId: activeWorkspace.sessionId,
        tenantId: activeWorkspace.tenantId,
        threadId: activeConversation.threadId,
        input: [{ type: 'text', text }],
        collaborationMode: {
          mode: 'default',
          settings: {
            model: activeWorkspace.model || settings.defaultModel,
            developerInstructions: null,
          },
        },
      };

      if (sendProtocolMessage('codex.local.turn', payload)) {
        updateWorkspace(activeWorkspace.id, { threadId: activeConversation.threadId });
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === activeConversation.id
              ? {
                  ...conversation,
                  title: conversation.title === '默认对话' ? text.slice(0, 18) || conversation.title : conversation.title,
                  updatedAt: Date.now(),
                }
              : conversation,
          ),
        );
      }
    },
    [activeConversation, activeWorkspace, sendProtocolMessage, settings.defaultModel, startLocalAdapter, updateWorkspace],
  );

  const sendApprovalResponse = useCallback(
    (accepted: boolean, request: PendingRequest) => {
      if (!activeWorkspace) {
        Alert.alert('未选择工作区', '请先选择一个工作区。');
        return;
      }
      sendProtocolMessage('codex.local.approval.respond', {
        codexSessionId: activeWorkspace.sessionId,
        tenantId: activeWorkspace.tenantId,
        requestId: request.requestId,
        responseType: inferApprovalResponseType(request.requestType),
        response: approvalResponsePayload(request, accepted),
      });
    },
    [activeWorkspace, sendProtocolMessage],
  );

  const sendSlashCommand = useCallback(
    (input: string) => {
      const trimmed = input.trim();
      if (!trimmed.startsWith('/')) {
        sendLocalTurn(trimmed);
        return;
      }

      const [command, ...rest] = trimmed.slice(1).trim().split(/\s+/);
      const lower = command.toLowerCase();

      if (!activeWorkspace) {
        Alert.alert('未选择工作区', '请先选择一个工作区。');
        return;
      }

      if (lower === 'permission' || lower === 'approve' || lower === 'approval') {
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

      if (lower === 'start') {
        void startLocalAdapter(activeWorkspace).catch(() => undefined);
        return;
      }

      if (lower === 'status') {
        sendWorkspaceCommand(activeWorkspace, 'codex.local.status');
        return;
      }

      if (lower === 'stop') {
        if (sendWorkspaceCommand(activeWorkspace, 'codex.local.stop', { force: false })) {
          const pending = pendingLocalStartsRef.current.get(activeWorkspace.id);
          if (pending) {
            clearTimeout(pending.timeoutId);
            pendingLocalStartsRef.current.delete(activeWorkspace.id);
            pending.reject(new Error('本地会话已停止'));
          }
          updateWorkspace(activeWorkspace.id, { localAdapterState: 'stopped' });
        }
        return;
      }

      if (lower === 'attach') {
        sendWorkspaceCommand(activeWorkspace, 'codex.local.attach', {
          afterCursor: null,
          replayLimit: 200,
        });
        return;
      }

      if (lower === 'replay') {
        sendWorkspaceCommand(activeWorkspace, 'codex.local.replay', {
          afterCursor: null,
          limit: 200,
        });
        return;
      }

      if (lower === 'interrupt') {
        sendWorkspaceCommand(activeWorkspace, 'codex.local.interrupt', {
          threadId: activeConversation?.threadId || activeWorkspace.threadId || settings.defaultThreadId,
          turnId: turnId || '',
        });
        return;
      }

      sendLocalTurn(trimmed);
    },
    [
      activeConversation,
      activeWorkspace,
      pendingRequests,
      selectedRequest,
      sendApprovalResponse,
      sendLocalTurn,
      startLocalAdapter,
      sendWorkspaceCommand,
      settings.defaultThreadId,
      turnId,
      updateWorkspace,
    ],
  );

  const submitChat = useCallback(() => {
    const text = chatDraft.trim();
    if (!text) {
      return;
    }
    setChatDraft('');
    sendSlashCommand(text);
  }, [chatDraft, sendSlashCommand]);

  const runWorkspaceCommand = useCallback((workspace: WorkspaceRecord, command: 'start' | 'status' | 'attach' | 'stop' | 'interrupt') => {
    if (command === 'start') {
      void startLocalAdapter(workspace).catch(() => undefined);
      return;
    }
    if (command === 'status') {
      sendWorkspaceCommand(workspace, 'codex.local.status');
      return;
    }
    if (command === 'attach') {
      sendWorkspaceCommand(workspace, 'codex.local.attach', { afterCursor: null, replayLimit: 200 });
      return;
    }
    if (command === 'interrupt') {
      sendWorkspaceCommand(workspace, 'codex.local.interrupt', {
        threadId: activeConversation?.threadId || workspace.threadId || settings.defaultThreadId,
        turnId: turnId || '',
      });
      return;
    }
    if (sendWorkspaceCommand(workspace, 'codex.local.stop', { force: false })) {
      const pending = pendingLocalStartsRef.current.get(workspace.id);
      if (pending) {
        clearTimeout(pending.timeoutId);
        pendingLocalStartsRef.current.delete(workspace.id);
        pending.reject(new Error('本地会话已停止'));
      }
      updateWorkspace(workspace.id, { localAdapterState: 'stopped' });
    }
  }, [activeConversation, sendWorkspaceCommand, settings.defaultThreadId, turnId, updateWorkspace, startLocalAdapter]);

  const pendingApprovalCount = pendingRequests.filter((request) => isApprovalLikeRequest(request.requestType)).length;

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
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Chat">
              {(props) => (
                <ChatScreen
                  {...props}
                  workspaces={workspaces}
                  conversations={conversations}
                  timeline={timeline}
                  pendingRequests={pendingRequests}
                  pendingApprovalCount={pendingApprovalCount}
                  selectedRequest={selectedRequest}
                  chatDraft={chatDraft}
                  lastError={lastError}
                  setChatDraft={setChatDraft}
                  submitChat={submitChat}
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
                  turnId={turnId}
                  connectionState={connectionState}
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
}: NativeStackScreenProps<RootStackParamList, 'Workspaces'> & {
  workspaces: WorkspaceRecord[];
  conversations: ConversationRecord[];
  settings: ConnectionSettings;
  connectionState: string;
  createWorkspace: (name: string, path: string) => { workspace: WorkspaceRecord; conversation: ConversationRecord } | null;
  selectWorkspace: (workspaceId: string) => void;
}) {
  const [modalVisible, setModalVisible] = useState(false);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('');
  const [workspacePathDraft, setWorkspacePathDraft] = useState('');

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
}: NativeStackScreenProps<RootStackParamList, 'Conversations'> & {
  workspaces: WorkspaceRecord[];
  conversations: ConversationRecord[];
  timeline: TimelineEntry[];
  createConversation: (workspaceId: string) => ConversationRecord | null;
  selectWorkspace: (workspaceId: string) => void;
  selectConversation: (workspaceId: string, conversationId: string) => void;
}) {
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
          const latest = timeline.find((entry) => entry.conversationId === conversation.id);
          return (
            <Pressable
              key={conversation.id}
              onPress={() => {
                selectConversation(workspace.id, conversation.id);
                navigation.navigate('Chat', { workspaceId: workspace.id, conversationId: conversation.id });
              }}
              style={styles.listItem}
            >
              <View style={styles.conversationAvatar}>
                <Text style={styles.conversationAvatarText}>对</Text>
              </View>
              <View style={styles.itemMain}>
                <View style={styles.itemHeader}>
                  <Text style={styles.itemTitle} numberOfLines={1}>
                    {conversation.title}
                  </Text>
                  <Text style={styles.itemTag}>{nowLabel(conversation.updatedAt)}</Text>
                </View>
                <Text style={styles.itemBody} numberOfLines={1}>
                  {latest?.subtitle || '点进去开始完整对话'}
                </Text>
              </View>
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

function ChatScreen({
  navigation,
  route,
  workspaces,
  conversations,
  timeline,
  pendingRequests,
  pendingApprovalCount,
  selectedRequest,
  chatDraft,
  lastError,
  setChatDraft,
  submitChat,
  sendApprovalResponse,
  selectConversation,
  runWorkspaceCommand,
  removeWorkspace,
}: NativeStackScreenProps<RootStackParamList, 'Chat'> & {
  workspaces: WorkspaceRecord[];
  conversations: ConversationRecord[];
  timeline: TimelineEntry[];
  pendingRequests: PendingRequest[];
  pendingApprovalCount: number;
  selectedRequest: PendingRequest | null;
  chatDraft: string;
  lastError: string;
  setChatDraft: (value: string) => void;
  submitChat: () => void;
  sendApprovalResponse: (accepted: boolean, request: PendingRequest) => void;
  selectConversation: (workspaceId: string, conversationId: string) => void;
  runWorkspaceCommand: (workspace: WorkspaceRecord, command: 'start' | 'status' | 'attach' | 'stop' | 'interrupt') => void;
  removeWorkspace: (workspaceId: string) => void;
}) {
  const [menuVisible, setMenuVisible] = useState(false);
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();
  const composerPaddingBottom = 12 + (keyboardInset > 0 ? 0 : insets.bottom);
  const workspace = workspaces.find((item) => item.id === route.params.workspaceId) ?? null;
  const conversation = conversations.find((item) => item.id === route.params.conversationId) ?? null;
  const conversationMessages = timeline
    .filter((entry) => entry.conversationId === route.params.conversationId)
    .slice()
    .reverse();

  useEffect(() => {
    selectConversation(route.params.workspaceId, route.params.conversationId);
  }, [route.params.conversationId, route.params.workspaceId, selectConversation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: conversation?.title ?? '对话',
      headerRight: () => <HeaderIconButton label="..." onPress={() => setMenuVisible(true)} />,
    });
  }, [conversation?.title, navigation]);

  if (!workspace || !conversation) {
    return (
      <View style={styles.centerScreen}>
        <EmptyState text="对话不存在。请返回后重新选择。" />
      </View>
    );
  }

  return (
    <View style={[styles.chatRoot, { paddingBottom: keyboardInset }]}>
      {pendingRequests.length > 0 ? (
        <View style={styles.pendingStrip}>
          <Text style={styles.pendingText} numberOfLines={1}>
            {pendingApprovalCount || pendingRequests.length} 个待处理请求
          </Text>
          {selectedRequest ? (
            <>
              <MiniButton title="同意" onPress={() => sendApprovalResponse(true, selectedRequest)} />
              <MiniButton title="拒绝" onPress={() => sendApprovalResponse(false, selectedRequest)} />
            </>
          ) : null}
        </View>
      ) : null}

      {lastError ? <Text style={styles.inlineError}>{lastError}</Text> : null}

      <ScrollView contentContainerStyle={styles.messageList} keyboardShouldPersistTaps="handled">
        {conversationMessages.length === 0 ? (
          <EmptyState text="这是一段新的对话。" />
        ) : (
          conversationMessages.map((entry) => <MessageBubble key={entry.id} entry={entry} />)
        )}
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: composerPaddingBottom }]}>
        <TextInput
          value={chatDraft}
          onChangeText={setChatDraft}
          placeholder="输入消息"
          placeholderTextColor="#7a8391"
          style={styles.composerInput}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable onPress={submitChat} style={styles.sendButton}>
          <Text style={styles.sendButtonText}>发送</Text>
        </Pressable>
      </View>

      <Modal visible={menuVisible} animationType="fade" transparent onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuVisible(false)}>
          <View style={styles.menuSheet}>
            <Text style={styles.menuTitle}>{workspace.name}</Text>
            <MenuItem title="启动" onPress={() => runWorkspaceCommand(workspace, 'start')} close={() => setMenuVisible(false)} />
            <MenuItem title="状态" onPress={() => runWorkspaceCommand(workspace, 'status')} close={() => setMenuVisible(false)} />
            <MenuItem title="附加" onPress={() => runWorkspaceCommand(workspace, 'attach')} close={() => setMenuVisible(false)} />
            <MenuItem title="中断" onPress={() => runWorkspaceCommand(workspace, 'interrupt')} close={() => setMenuVisible(false)} />
            <MenuItem title="停止" onPress={() => runWorkspaceCommand(workspace, 'stop')} close={() => setMenuVisible(false)} />
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
  connectionState: string;
  lastError: string;
  connect: () => void;
  closeSocket: () => void;
  refreshServerVersion: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.pageContent}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>连接</Text>
        <View style={styles.formBlock}>
          <Diagnostic label="状态" value={connectionState} />
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
          <Field
            label="Tenant id"
            value={settings.tenantId}
            onChangeText={(value) => setSettings((current) => ({ ...current, tenantId: value }))}
            placeholder="local"
          />
          <Row>
            <ActionButton title="连接" onPress={connect} />
            <ActionButton title="刷新版本" onPress={refreshServerVersion} tone="ghost" />
            <ActionButton title="断开" onPress={closeSocket} tone="ghost" />
          </Row>
          {lastError ? <Text style={styles.errorText}>{lastError}</Text> : null}
        </View>
      </View>

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
            label="默认 Thread"
            value={settings.defaultThreadId}
            onChangeText={(value) => setSettings((current) => ({ ...current, defaultThreadId: value }))}
            placeholder="thread_1"
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

function MessageBubble({ entry }: { entry: TimelineEntry }) {
  const outgoing = entry.kind === 'outgoing';
  const system = entry.kind === 'system';
  return (
    <View style={[styles.bubbleRow, outgoing && styles.bubbleRowOutgoing]}>
      <View style={[styles.bubble, outgoing && styles.bubbleOutgoing, system && styles.bubbleSystem]}>
        <View style={styles.bubbleMetaRow}>
          <Text style={[styles.bubbleTitle, outgoing && styles.bubbleTitleOutgoing]} numberOfLines={1}>
            {entry.title}
          </Text>
          <Text style={[styles.bubbleTime, outgoing && styles.bubbleTimeOutgoing]}>{nowLabel(entry.at)}</Text>
        </View>
        {entry.subtitle ? (
          <Text style={[styles.bubbleText, outgoing && styles.bubbleTextOutgoing]}>{entry.subtitle}</Text>
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

function ActionButton({
  title,
  onPress,
  tone = 'solid',
}: {
  title: string;
  onPress: () => void;
  tone?: 'solid' | 'ghost';
}) {
  return (
    <Pressable onPress={onPress} style={[styles.actionButton, tone === 'ghost' && styles.actionButtonGhost]}>
      <Text style={[styles.actionButtonText, tone === 'ghost' && styles.actionButtonTextGhost]}>{title}</Text>
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
  conversationAvatarText: {
    color: '#244641',
    fontSize: 15,
    fontWeight: '800',
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
  itemTag: {
    color: '#7a8391',
    fontSize: 11,
    fontWeight: '800',
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
  actionButtonText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 13,
  },
  actionButtonTextGhost: {
    color: '#17202a',
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
  pendingStrip: {
    marginHorizontal: 14,
    marginTop: 10,
    marginBottom: 4,
    padding: 10,
    backgroundColor: '#fff7d9',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e1c565',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pendingText: {
    flex: 1,
    color: '#4d4020',
    fontSize: 13,
    fontWeight: '800',
  },
  inlineError: {
    color: '#a23b3b',
    fontSize: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  messageList: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 10,
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
  composer: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#d8e0e7',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  composerInput: {
    flex: 1,
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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import {
  AppTab,
  ConnectionSettings,
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

function classifyEvent(
  event: ServerEvent,
  workspaceId: string,
  conversationId: string,
): TimelineEntry {
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

function makeSystemEntry(
  title: string,
  subtitle = '',
  workspaceId = '',
  conversationId = '',
): TimelineEntry {
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

  const [hydrated, setHydrated] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>('chat');
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
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('');
  const [workspacePathDraft, setWorkspacePathDraft] = useState('');
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

  useEffect(() => {
    if (!activeWorkspaceId && workspaces.length > 0) {
      setActiveWorkspaceId(workspaces[0].id);
    }
  }, [activeWorkspaceId, workspaces]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setActiveConversationId('');
      return;
    }
    const available = conversations.filter((conversation) => conversation.workspaceId === activeWorkspaceId);
    if (available.length > 0 && !available.some((conversation) => conversation.id === activeConversationId)) {
      setActiveConversationId(available[0].id);
    }
  }, [activeConversationId, activeWorkspaceId, conversations]);

  const activeWorkspace = useMemo(
    () => workspaces.find((item) => item.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );

  const workspaceConversations = useMemo(
    () => conversations.filter((conversation) => conversation.workspaceId === activeWorkspaceId),
    [activeWorkspaceId, conversations],
  );

  const activeConversation = useMemo(
    () => workspaceConversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, workspaceConversations],
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

  const appendTimeline = useCallback((entry: TimelineEntry) => {
    setTimeline((current) => [entry, ...current].slice(0, MAX_TIMELINE_ITEMS));
  }, []);

  const appendEvent = useCallback(
    (event: ServerEvent) => {
      setEvents((current) => [event, ...current].slice(0, MAX_EVENTS));
      appendTimeline(classifyEvent(event, activeWorkspaceRef.current, activeConversationRef.current));
      const data = eventPayloadData(event);
      const maybeTurnId = data.turnId ?? data.turn_id;
      if (typeof maybeTurnId === 'string' && maybeTurnId) {
        setTurnId(maybeTurnId);
      }
    },
    [appendTimeline],
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

  const addWorkspace = useCallback(() => {
    const path = workspacePathDraft.trim();
    if (!path) {
      Alert.alert('缺少目录', '请输入要管理的目录路径。');
      return;
    }

    const name = workspaceNameDraft.trim() || displayNameFromPath(path);
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const nextConversation = createDefaultConversation(nextWorkspace, settings.defaultThreadId);

    setWorkspaces((current) => [nextWorkspace, ...current]);
    setConversations((current) => [nextConversation, ...current]);
    setActiveWorkspaceId(id);
    setActiveConversationId(nextConversation.id);
    setWorkspaceNameDraft('');
    setWorkspacePathDraft('');
    pushSystem('已添加目录', nextWorkspace.path);
  }, [
    pushSystem,
    settings.approvalPolicy,
    settings.defaultModel,
    settings.defaultThreadId,
    settings.sandboxMode,
    settings.tenantId,
    workspaceNameDraft,
    workspacePathDraft,
  ]);

  const updateWorkspace = useCallback((id: string, patch: Partial<WorkspaceRecord>) => {
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === id ? { ...workspace, ...patch, updatedAt: Date.now() } : workspace,
      ),
    );
  }, []);

  const selectWorkspace = useCallback((id: string) => {
    const workspace = workspaces.find((item) => item.id === id);
    if (!workspace) {
      return;
    }
    const conversation = conversations.find((item) => item.workspaceId === id);
    setActiveWorkspaceId(id);
    setActiveConversationId(conversation?.id ?? '');
    setLastError('');
  }, [conversations, workspaces]);

  const createConversation = useCallback(() => {
    if (!activeWorkspace) {
      Alert.alert('未选择目录', '请先选择一个目录。');
      return;
    }

    const index = workspaceConversations.length + 1;
    const next: ConversationRecord = {
      id: createRequestId('conversation'),
      workspaceId: activeWorkspace.id,
      title: `对话 ${index}`,
      threadId: `thread_${Date.now().toString(36)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConversations((current) => [next, ...current]);
    setActiveConversationId(next.id);
    setTurnId('');
  }, [activeWorkspace, workspaceConversations.length]);

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

  const sendLocalTurn = useCallback(
    (text: string) => {
      if (!activeWorkspace || !activeConversation) {
        Alert.alert('未选择对话', '请先选择目录和历史对话。');
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
    [activeConversation, activeWorkspace, sendProtocolMessage, settings.defaultModel, updateWorkspace],
  );

  const sendApprovalResponse = useCallback(
    (accepted: boolean, request: PendingRequest) => {
      if (!activeWorkspace) {
        Alert.alert('未选择目录', '请先选择一个目录。');
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
        Alert.alert('未选择目录', '请先选择一个目录。');
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
        sendWorkspaceCommand(activeWorkspace, 'codex.local.start', {
          cwd: activeWorkspace.path,
          model: activeWorkspace.model,
          approvalPolicy: activeWorkspace.approvalPolicy,
          sandboxMode: activeWorkspace.sandboxMode,
          configOverrides: {},
        });
        return;
      }

      if (lower === 'status') {
        sendWorkspaceCommand(activeWorkspace, 'codex.local.status');
        return;
      }

      if (lower === 'stop') {
        sendWorkspaceCommand(activeWorkspace, 'codex.local.stop', { force: false });
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
      sendWorkspaceCommand,
      settings.defaultThreadId,
      turnId,
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

  const conversationMessages = useMemo(() => {
    if (!activeConversationId) {
      return [];
    }
    return timeline
      .filter((entry) => entry.conversationId === activeConversationId)
      .slice()
      .reverse();
  }, [activeConversationId, timeline]);

  const pendingApprovalCount = pendingRequests.filter((request) => isApprovalLikeRequest(request.requestType)).length;

  const renderTopBar = () => (
    <View style={styles.topBar}>
      <View style={styles.topTitleGroup}>
        <Text style={styles.product}>TodeX</Text>
        <Text style={styles.topSubtitle} numberOfLines={1}>
          {activeTab === 'chat'
            ? activeWorkspace?.path ?? '选择目录开始对话'
            : settings.serverUrl}
        </Text>
      </View>
      <View style={[styles.statusPill, connectionState === 'open' ? styles.statusOpen : styles.statusMuted]}>
        <Text style={styles.statusText}>{connectionState}</Text>
      </View>
    </View>
  );

  const renderDirectoryList = () => (
    <ScrollView contentContainerStyle={styles.pageContent}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>目录</Text>
        <View style={styles.formBlock}>
          <Field
            label="目录名称"
            value={workspaceNameDraft}
            onChangeText={setWorkspaceNameDraft}
            placeholder="可选"
          />
          <Field
            label="目录路径"
            value={workspacePathDraft}
            onChangeText={setWorkspacePathDraft}
            placeholder={settings.defaultWorkspacePath}
          />
          <Row>
            <ActionButton title="添加目录" onPress={addWorkspace} />
            <ActionButton
              title="填入默认路径"
              onPress={() => setWorkspacePathDraft(settings.defaultWorkspacePath)}
              tone="ghost"
            />
          </Row>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>已管理目录</Text>
        {workspaces.length === 0 ? (
          <EmptyState text="还没有目录。添加一个目录后，它会成为对话分类。" />
        ) : (
          workspaces.map((workspace) => {
            const count = conversations.filter((conversation) => conversation.workspaceId === workspace.id).length;
            return (
              <Pressable
                key={workspace.id}
                onPress={() => selectWorkspace(workspace.id)}
                style={[styles.directoryItem, workspace.id === activeWorkspaceId && styles.directoryItemActive]}
              >
                <View style={styles.itemHeader}>
                  <Text style={styles.itemTitle} numberOfLines={1}>
                    {workspace.name}
                  </Text>
                  <Text style={styles.itemTag}>{count} 个对话</Text>
                </View>
                <Text style={styles.itemBody} numberOfLines={2}>
                  {workspace.path}
                </Text>
              </Pressable>
            );
          })
        )}
      </View>
    </ScrollView>
  );

  const renderDirectoryManager = () => {
    if (!activeWorkspace) {
      return renderDirectoryList();
    }

    return (
      <View style={styles.chatShell}>
        <View style={styles.workspaceHeader}>
          <Pressable onPress={() => setActiveWorkspaceId('')} style={styles.backButton}>
            <Text style={styles.backButtonText}>目录</Text>
          </Pressable>
          <View style={styles.workspaceTitleGroup}>
            <Text style={styles.workspaceTitle} numberOfLines={1}>
              {activeWorkspace.name}
            </Text>
            <Text style={styles.workspacePath} numberOfLines={1}>
              {activeWorkspace.path}
            </Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.conversationRail}>
          <Pressable onPress={createConversation} style={styles.newConversationButton}>
            <Text style={styles.newConversationText}>新对话</Text>
          </Pressable>
          {workspaceConversations.map((conversation) => (
            <Pressable
              key={conversation.id}
              onPress={() => setActiveConversationId(conversation.id)}
              style={[
                styles.conversationChip,
                conversation.id === activeConversationId && styles.conversationChipActive,
              ]}
            >
              <Text
                style={[
                  styles.conversationChipText,
                  conversation.id === activeConversationId && styles.conversationChipTextActive,
                ]}
                numberOfLines={1}
              >
                {conversation.title}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.workspaceActions}>
          <MiniButton title="启动" onPress={() => sendSlashCommand('/start')} />
          <MiniButton title="状态" onPress={() => sendSlashCommand('/status')} />
          <MiniButton title="附加" onPress={() => sendSlashCommand('/attach')} />
          <MiniButton title="停止" onPress={() => sendSlashCommand('/stop')} />
          <MiniButton title="移除目录" onPress={() => removeWorkspace(activeWorkspace.id)} />
        </View>

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

        <ScrollView contentContainerStyle={styles.messageList}>
          {conversationMessages.length === 0 ? (
            <EmptyState text="选择历史对话或新建对话后，在底部输入消息。" />
          ) : (
            conversationMessages.map((entry) => <MessageBubble key={entry.id} entry={entry} />)
          )}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            value={chatDraft}
            onChangeText={setChatDraft}
            placeholder="输入消息，或使用 /start /status /attach"
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
      </View>
    );
  };

  const renderSettings = () => (
    <ScrollView contentContainerStyle={styles.pageContent}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>连接</Text>
        <View style={styles.formBlock}>
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
          <Diagnostic label="待处理请求" value={String(pendingRequests.length)} />
          <Diagnostic label="当前 Turn" value={turnId || 'unknown'} />
        </View>
      </View>
    </ScrollView>
  );

  if (!hydrated) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="light" />
        <Text style={styles.loadingTitle}>TodeX</Text>
        <Text style={styles.loadingText}>正在加载设置和目录...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="dark" />
      {renderTopBar()}
      <View style={styles.content}>{activeTab === 'chat' ? renderDirectoryManager() : renderSettings()}</View>
      <View style={styles.bottomNav}>
        {(
          [
            ['chat', '对话'],
            ['settings', '设置'],
          ] as Array<[AppTab, string]>
        ).map(([tab, label]) => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={[styles.navButton, activeTab === tab && styles.navButtonActive]}
          >
            <Text style={[styles.navText, activeTab === tab && styles.navTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </KeyboardAvoidingView>
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
    <Pressable
      onPress={onPress}
      style={[styles.actionButton, tone === 'ghost' && styles.actionButtonGhost]}
    >
      <Text style={[styles.actionButtonText, tone === 'ghost' && styles.actionButtonTextGhost]}>
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
  root: {
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
  topBar: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#d8e0e7',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  topTitleGroup: {
    flex: 1,
    minWidth: 0,
  },
  product: {
    color: '#17202a',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0,
  },
  topSubtitle: {
    color: '#66717c',
    fontSize: 13,
    marginTop: 3,
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
  content: {
    flex: 1,
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
  directoryItem: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d8e0e7',
    padding: 14,
    gap: 8,
  },
  directoryItemActive: {
    borderColor: '#17202a',
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
    fontSize: 15,
    fontWeight: '800',
    minWidth: 0,
  },
  itemTag: {
    color: '#5f6c75',
    fontSize: 11,
    fontWeight: '800',
  },
  itemBody: {
    color: '#66717c',
    fontSize: 13,
    lineHeight: 18,
  },
  emptyState: {
    color: '#66717c',
    fontSize: 14,
    lineHeight: 20,
  },
  chatShell: {
    flex: 1,
    backgroundColor: '#f4f6f8',
  },
  workspaceHeader: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#d8e0e7',
  },
  backButton: {
    backgroundColor: '#17202a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  workspaceTitleGroup: {
    flex: 1,
    minWidth: 0,
  },
  workspaceTitle: {
    color: '#17202a',
    fontSize: 17,
    fontWeight: '800',
  },
  workspacePath: {
    color: '#66717c',
    fontSize: 12,
    marginTop: 2,
  },
  conversationRail: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  newConversationButton: {
    backgroundColor: '#17202a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    justifyContent: 'center',
  },
  newConversationText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  conversationChip: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d8e0e7',
    paddingHorizontal: 12,
    paddingVertical: 9,
    maxWidth: 150,
  },
  conversationChipActive: {
    borderColor: '#17202a',
    backgroundColor: '#e7ecef',
  },
  conversationChipText: {
    color: '#66717c',
    fontSize: 12,
    fontWeight: '800',
  },
  conversationChipTextActive: {
    color: '#17202a',
  },
  workspaceActions: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pendingStrip: {
    marginHorizontal: 14,
    marginBottom: 10,
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
  messageList: {
    paddingHorizontal: 14,
    paddingTop: 6,
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
  bottomNav: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#d8e0e7',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  navButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  navButtonActive: {
    backgroundColor: '#17202a',
  },
  navText: {
    color: '#66717c',
    fontSize: 13,
    fontWeight: '800',
  },
  navTextActive: {
    color: '#ffffff',
  },
});

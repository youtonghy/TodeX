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
  COMMAND_PRESETS,
  CommandContext,
  ConnectionSettings,
  PendingRequest,
  ServerEvent,
  WorkspaceRecord,
  approvalResponsePayload,
  buildHttpUrl,
  buildWebSocketUrl,
  classifyPendingRequest,
  createMessage,
  createRequestId,
  displayNameFromPath,
  eventId,
  eventPayloadData,
  findCommandPreset,
  inferApprovalResponseType,
  isApprovalLikeRequest,
  normalizeServerUrl,
  presetsByGroup,
  requestIdFromEvent,
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

type TimelineEntry = {
  id: string;
  kind: 'incoming' | 'outgoing' | 'system';
  title: string;
  subtitle: string;
  raw: string;
  at: number;
};

type PersistedSettings = Omit<ConnectionSettings, 'authToken'>;

const SETTINGS_STORAGE_KEY = 'todex.mobile.settings.v1';
const WORKSPACES_STORAGE_KEY = 'todex.mobile.workspaces.v1';
const TOKEN_STORAGE_KEY = 'todex.mobile.token.v1';
const MAX_TIMELINE_ITEMS = 220;
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
    second: '2-digit',
  });
}

function classifyEvent(event: ServerEvent): TimelineEntry {
  const data = eventPayloadData(event);
  const title = summarizeEventType(event.type);
  const subtitle = shortJson(data).slice(0, 180);
  return {
    id: eventId(event),
    kind: 'incoming',
    title,
    subtitle,
    raw: shortJson(event),
    at: Date.now(),
  };
}

function makeSystemEntry(title: string, subtitle = ''): TimelineEntry {
  return {
    id: createRequestId('sys'),
    kind: 'system',
    title,
    subtitle,
    raw: '',
    at: Date.now(),
  };
}

function makeOutgoingEntry(message: { id: string; type: string; payload: Record<string, unknown> }): TimelineEntry {
  return {
    id: message.id,
    kind: 'outgoing',
    title: `sent ${message.type}`,
    subtitle: shortJson(message.payload).slice(0, 180),
    raw: shortJson(message),
    at: Date.now(),
  };
}

export default function App() {
  const socketRef = useRef<WebSocket | null>(null);
  const hydratedRef = useRef(false);

  const [hydrated, setHydrated] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>('workspaces');
  const [settings, setSettings] = useState<ConnectionSettings>(defaultSettings);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('');
  const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
  const [lastError, setLastError] = useState('');
  const [serverVersion, setServerVersion] = useState<ServerVersion | null>(null);
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const [chatDraft, setChatDraft] = useState('');
  const [commandPromptDraft, setCommandPromptDraft] = useState('Write a message for Codex.');
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('');
  const [workspacePathDraft, setWorkspacePathDraft] = useState('');
  const [commandType, setCommandType] = useState(COMMAND_PRESETS[0].type);
  const [commandRequestId, setCommandRequestId] = useState(createRequestId('cmd'));
  const [commandPayloadText, setCommandPayloadText] = useState('{}');
  const [threadId, setThreadId] = useState(defaultSettings.defaultThreadId);
  const [turnId, setTurnId] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const [storedSettings, storedWorkspaces, storedToken] = await Promise.all([
        loadJson<PersistedSettings | null>(SETTINGS_STORAGE_KEY, null),
        loadJson<WorkspaceRecord[]>(WORKSPACES_STORAGE_KEY, []),
        loadSecret(TOKEN_STORAGE_KEY),
      ]);

      if (!alive) {
        return;
      }

      setSettings(fromPersistedSettings(storedSettings, storedToken));
      setWorkspaces(storedWorkspaces);
      setActiveWorkspaceId(storedWorkspaces[0]?.id ?? '');
      setHydrated(true);
      hydratedRef.current = true;
    })();

    return () => {
      alive = false;
      closeSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!activeWorkspaceId && workspaces.length > 0) {
      setActiveWorkspaceId(workspaces[0].id);
    }
  }, [activeWorkspaceId, workspaces]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }
    const active = workspaces.find((item) => item.id === activeWorkspaceId);
    if (active) {
      setChatDraft('');
    }
  }, [activeWorkspaceId, workspaces]);

  const activeWorkspace = useMemo(
    () => workspaces.find((item) => item.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
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

  const commandContext = useMemo<CommandContext>(
    () => ({
      settings,
      workspace: activeWorkspace,
      threadId: activeWorkspace?.threadId || settings.defaultThreadId,
      turnId,
      prompt: commandPromptDraft,
      selectedRequest,
    }),
    [activeWorkspace, commandPromptDraft, selectedRequest, settings, turnId],
  );

  const groupedPresets = useMemo(() => presetsByGroup(), []);

  const appendTimeline = useCallback((entry: TimelineEntry) => {
    setTimeline((current) => [entry, ...current].slice(0, MAX_TIMELINE_ITEMS));
  }, []);

  const appendEvent = useCallback((event: ServerEvent) => {
    setEvents((current) => [event, ...current].slice(0, MAX_EVENTS));
    appendTimeline(classifyEvent(event));
    const data = eventPayloadData(event);
    const maybeTurnId = data.turnId ?? data.turn_id;
    if (typeof maybeTurnId === 'string' && maybeTurnId) {
      setTurnId(maybeTurnId);
    }
  }, [appendTimeline]);

  const pushSystem = useCallback((title: string, subtitle = '') => {
    appendTimeline(makeSystemEntry(title, subtitle));
  }, [appendTimeline]);

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
        pushSystem('connected', wsUrl);
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
        pushSystem('disconnected', wsUrl);
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
        setLastError('Connect to the backend first.');
        return false;
      }

      const message = { id: requestId, type, payload };
      socket.send(JSON.stringify(message));
      appendTimeline(makeOutgoingEntry(message));
      return true;
    },
    [appendTimeline],
  );

  const loadPreset = useCallback(
    (type: string) => {
      const preset = findCommandPreset(type);
      if (!preset) {
        return;
      }
      const payload = preset.build(commandContext);
      setCommandType(type);
      setCommandRequestId(createRequestId('cmd'));
      setCommandPayloadText(JSON.stringify(payload, null, 2));
      setActiveTab('commands');
    },
    [commandContext],
  );

  useEffect(() => {
    const preset = findCommandPreset(commandType);
    if (!preset) {
      return;
    }
    const payload = preset.build(commandContext);
    setCommandPayloadText(JSON.stringify(payload, null, 2));
  }, [commandContext, commandType]);

  const addWorkspace = useCallback(() => {
    const path = workspacePathDraft.trim();
    if (!path) {
      Alert.alert('Missing path', 'Enter a workspace directory.');
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

    setWorkspaces((current) => [nextWorkspace, ...current]);
    setActiveWorkspaceId(id);
    setWorkspaceNameDraft('');
    setWorkspacePathDraft('');
    setThreadId(nextWorkspace.threadId);
    pushSystem('workspace added', nextWorkspace.path);
    setActiveTab('chat');
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

  const selectWorkspace = useCallback(
    (id: string) => {
      const workspace = workspaces.find((item) => item.id === id);
      if (!workspace) {
        return;
      }
      setActiveWorkspaceId(id);
      setThreadId(workspace.threadId || settings.defaultThreadId);
      setLastError('');
      setActiveTab('chat');
      pushSystem('workspace selected', workspace.name);
    },
    [pushSystem, settings.defaultThreadId, workspaces],
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
      if (!activeWorkspace) {
        Alert.alert('No workspace selected', 'Create or select a workspace first.');
        return;
      }

      const payload = {
        codexSessionId: activeWorkspace.sessionId,
        tenantId: activeWorkspace.tenantId,
        threadId: threadId || activeWorkspace.threadId || settings.defaultThreadId,
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
        updateWorkspace(activeWorkspace.id, { threadId: payload.threadId as string });
      }
    },
    [activeWorkspace, sendProtocolMessage, settings.defaultModel, settings.defaultThreadId, threadId, updateWorkspace],
  );

  const sendApprovalResponse = useCallback(
    (accepted: boolean, request: PendingRequest) => {
      if (!activeWorkspace) {
        Alert.alert('No workspace selected', 'Create or select a workspace first.');
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
      const tail = rest.join(' ').trim();

      if (!activeWorkspace) {
        Alert.alert('No workspace selected', 'Create or select a workspace first.');
        return;
      }

      if (lower === 'help') {
        setActiveTab('commands');
        return;
      }

      if (lower === 'permission' || lower === 'approve' || lower === 'approval') {
        const deny = /^(deny|decline|reject|no)$/i.test(rest[0] ?? '');
        const requestId = rest[1] || selectedRequest?.requestId || '';
        const target = pendingRequests.find((request) => request.requestId === requestId) ?? selectedRequest;
        if (!target) {
          Alert.alert('No pending request', 'There is no approval or prompt to respond to.');
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

      if (lower === 'snapshot') {
        sendWorkspaceCommand(activeWorkspace, 'codex.local.snapshot', { maxBytes: 65_536 });
        return;
      }

      if (lower === 'interrupt') {
        sendWorkspaceCommand(activeWorkspace, 'codex.local.interrupt', {
          threadId: threadId || activeWorkspace.threadId || settings.defaultThreadId,
          turnId: turnId || '',
        });
        return;
      }

      sendLocalTurn(trimmed);
    },
    [
      activeWorkspace,
      pendingRequests,
      selectedRequest,
      sendApprovalResponse,
      sendLocalTurn,
      sendWorkspaceCommand,
      settings.defaultThreadId,
      threadId,
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

  const sendCommandEditorMessage = useCallback(() => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(commandPayloadText) as Record<string, unknown>;
    } catch {
      Alert.alert('Invalid JSON', 'The command payload must be valid JSON.');
      return;
    }

    if (!sendProtocolMessage(commandType, payload, commandRequestId)) {
      return;
    }

    setCommandRequestId(createRequestId('cmd'));
  }, [commandPayloadText, commandRequestId, commandType, sendProtocolMessage]);

  const pendingApprovalCount = pendingRequests.filter((request) => isApprovalLikeRequest(request.requestType)).length;
  const cloudTaskEvents = useMemo(
    () => events.filter((event) => event.type.startsWith('codex.cloudTask.')),
    [events],
  );

  const renderTopBanner = () => (
    <View style={styles.banner}>
      <View style={styles.bannerRow}>
        <View style={styles.bannerLeft}>
          <Text style={styles.product}>TodeX Mobile</Text>
          <Text style={styles.bannerText} numberOfLines={1}>
            {activeWorkspace ? activeWorkspace.name : 'No workspace selected'}
          </Text>
        </View>
        <View style={[styles.badge, connectionState === 'open' ? styles.badgeOpen : styles.badgeMuted]}>
          <Text style={styles.badgeText}>{connectionState}</Text>
        </View>
      </View>
      {lastError ? <Text style={styles.errorText}>{lastError}</Text> : null}
      <View style={styles.metaRow}>
        <Text style={styles.metaText} numberOfLines={1}>
          {settings.serverUrl}
        </Text>
        <Text style={styles.metaText} numberOfLines={1}>
          {serverVersion ? `${serverVersion.name} ${serverVersion.version}` : 'version unknown'}
        </Text>
      </View>
    </View>
  );

  const renderWorkspaceTab = () => (
    <ScrollView contentContainerStyle={styles.tabContent}>
      <Panel title="Add workspace">
        <Field
          label="Name"
          value={workspaceNameDraft}
          onChangeText={setWorkspaceNameDraft}
          placeholder="Optional display name"
        />
        <Field
          label="Directory"
          value={workspacePathDraft}
          onChangeText={setWorkspacePathDraft}
          placeholder={settings.defaultWorkspacePath}
        />
        <Row>
          <ActionButton title="Add" onPress={addWorkspace} />
          <ActionButton
            title="Use default"
            onPress={() => setWorkspacePathDraft(settings.defaultWorkspacePath)}
            tone="ghost"
          />
        </Row>
      </Panel>

      <Panel title={`Workspaces (${workspaces.length})`}>
        {workspaces.length === 0 ? (
          <EmptyState text="Add a directory to start a local session." />
        ) : (
          workspaces.map((workspace) => (
            <View key={workspace.id} style={[styles.listItem, workspace.id === activeWorkspaceId && styles.listItemActive]}>
              <View style={styles.listItemHeader}>
                <Text style={styles.itemTitle} numberOfLines={1}>
                  {workspace.name}
                </Text>
                <Text style={styles.itemTag}>{workspace.id.slice(-6)}</Text>
              </View>
              <Text style={styles.itemBody} numberOfLines={2}>
                {workspace.path}
              </Text>
              <Text style={styles.itemBody} numberOfLines={1}>
                session {workspace.sessionId} · thread {workspace.threadId}
              </Text>
              <View style={styles.wrapRow}>
                <MiniButton title="Select" onPress={() => selectWorkspace(workspace.id)} />
                <MiniButton title="Start" onPress={() => sendWorkspaceCommand(workspace, 'codex.local.start', {
                  cwd: workspace.path,
                  model: workspace.model,
                  approvalPolicy: workspace.approvalPolicy,
                  sandboxMode: workspace.sandboxMode,
                  configOverrides: {},
                })} />
                <MiniButton title="Status" onPress={() => sendWorkspaceCommand(workspace, 'codex.local.status')} />
                <MiniButton title="Attach" onPress={() => sendWorkspaceCommand(workspace, 'codex.local.attach', { afterCursor: null, replayLimit: 200 })} />
                <MiniButton title="Stop" onPress={() => sendWorkspaceCommand(workspace, 'codex.local.stop', { force: false })} />
                <MiniButton
                  title="Delete"
                  onPress={() =>
                    setWorkspaces((current) => {
                      const next = current.filter((item) => item.id !== workspace.id);
                      if (activeWorkspaceId === workspace.id) {
                        setActiveWorkspaceId(next[0]?.id ?? '');
                        if (next[0]) {
                          setThreadId(next[0].threadId);
                        }
                      }
                      return next;
                    })
                  }
                />
              </View>
            </View>
          ))
        )}
      </Panel>
    </ScrollView>
  );

  const renderChatTab = () => (
    <ScrollView contentContainerStyle={styles.tabContent}>
      <Panel title="Session">
        <Field
          label="Thread"
          value={threadId}
          onChangeText={setThreadId}
          placeholder={settings.defaultThreadId}
        />
        <Field
          label="Turn"
          value={turnId}
          onChangeText={() => undefined}
          placeholder="Use command actions to update turn id"
          editable={false}
        />
        <Row>
          <ActionButton title="Start" onPress={() => sendSlashCommand('/start')} />
          <ActionButton title="Status" onPress={() => sendSlashCommand('/status')} tone="ghost" />
          <ActionButton title="Attach" onPress={() => sendSlashCommand('/attach')} tone="ghost" />
          <ActionButton title="Replay" onPress={() => sendSlashCommand('/replay')} tone="ghost" />
          <ActionButton title="Interrupt" onPress={() => sendSlashCommand('/interrupt')} tone="ghost" />
        </Row>
      </Panel>

      <Panel title={`Pending requests (${pendingRequests.length})`}>
        {pendingRequests.length === 0 ? (
          <EmptyState text="Approval and question requests will appear here." />
        ) : (
          pendingRequests.map((request) => (
            <Pressable
              key={request.requestId}
              onPress={() => setSelectedRequestId(request.requestId)}
              style={[
                styles.listItem,
                request.requestId === selectedRequestId && styles.listItemActive,
              ]}
            >
              <View style={styles.listItemHeader}>
                <Text style={styles.itemTitle} numberOfLines={1}>
                  {request.title}
                </Text>
                <Text style={styles.itemTag}>{request.requestType.split('.').slice(-2, -1)[0] ?? 'req'}</Text>
              </View>
              <Text style={styles.itemBody} numberOfLines={2}>
                {request.requestType}
              </Text>
              <Text style={styles.itemBody} numberOfLines={1}>
                {request.requestId}
              </Text>
              <View style={styles.wrapRow}>
                {isApprovalLikeRequest(request.requestType) ? (
                  <>
                    <MiniButton title="Accept" onPress={() => sendApprovalResponse(true, request)} />
                    <MiniButton title="Deny" onPress={() => sendApprovalResponse(false, request)} />
                  </>
                ) : (
                  <MiniButton
                    title="Load command"
                    onPress={() => loadPreset('codex.local.approval.respond')}
                  />
                )}
              </View>
            </Pressable>
          ))
        )}
      </Panel>

      <Panel title="Composer">
        <Field
          label="Message or slash command"
          value={chatDraft}
          onChangeText={setChatDraft}
          placeholder="/permission accept 123 or write a message"
          multiline
        />
        <Row>
          <ActionButton title="Send" onPress={submitChat} />
          <ActionButton title="Command list" onPress={() => setActiveTab('commands')} tone="ghost" />
        </Row>
      </Panel>

      <Panel title="Timeline">
        {timeline.length === 0 ? (
          <EmptyState text="Outgoing requests and server events will be shown here." />
        ) : (
          timeline.map((entry) => (
            <View key={entry.id} style={styles.timelineItem}>
              <View style={styles.listItemHeader}>
                <Text style={styles.itemTitle} numberOfLines={1}>
                  {entry.title}
                </Text>
                <Text style={styles.itemTag}>{nowLabel(entry.at)}</Text>
              </View>
              {entry.subtitle ? (
                <Text style={styles.itemBody} numberOfLines={3}>
                  {entry.subtitle}
                </Text>
              ) : null}
              <Text style={styles.itemMeta} numberOfLines={2}>
                {entry.kind}
              </Text>
            </View>
          ))
        )}
      </Panel>
    </ScrollView>
  );

  const renderTasksTab = () => (
    <ScrollView contentContainerStyle={styles.tabContent}>
      <Panel title={`Cloud tasks (${cloudTaskEvents.length})`}>
        {cloudTaskEvents.length === 0 ? (
          <EmptyState text="Cloud task events will appear here once the backend emits them." />
        ) : (
          cloudTaskEvents.map((event) => {
            const data = eventPayloadData(event);
            const taskId = String(
              data.taskId ?? data.task_id ?? data.requestId ?? data.request_id ?? eventId(event),
            );
            return (
              <View key={eventId(event)} style={styles.listItem}>
                <View style={styles.listItemHeader}>
                  <Text style={styles.itemTitle} numberOfLines={1}>
                    {taskId}
                  </Text>
                  <Text style={styles.itemTag}>{event.type.split('.').slice(-1)[0]}</Text>
                </View>
                <Text style={styles.itemBody} numberOfLines={2}>
                  {event.type}
                </Text>
                <Text style={styles.itemBody} numberOfLines={3}>
                  {shortJson(data)}
                </Text>
              </View>
            );
          })
        )}
      </Panel>
    </ScrollView>
  );

  const renderCommandsTab = () => (
    <ScrollView contentContainerStyle={styles.tabContent}>
      <Panel title="Raw command editor">
        <Field
          label="Type"
          value={commandType}
          onChangeText={setCommandType}
          placeholder="codex.local.turn"
        />
        <Field
          label="Request id"
          value={commandRequestId}
          onChangeText={setCommandRequestId}
          placeholder="msg-..."
        />
        <Field
          label="Payload"
          value={commandPayloadText}
          onChangeText={setCommandPayloadText}
          placeholder="{ }"
          multiline
        />
        <Field
          label="Prompt"
          value={commandPromptDraft}
          onChangeText={setCommandPromptDraft}
          placeholder="Used by command templates"
        />
        <Row>
          <ActionButton title="Send" onPress={sendCommandEditorMessage} />
          <ActionButton
            title="Reset"
            onPress={() => loadPreset(commandType)}
            tone="ghost"
          />
        </Row>
      </Panel>

      {Object.entries(groupedPresets).map(([group, presets]) => (
        <Panel key={group} title={group}>
          {presets.map((preset) => (
            <Pressable
              key={preset.type}
              onPress={() => loadPreset(preset.type)}
              style={styles.listItem}
            >
              <View style={styles.listItemHeader}>
                <Text style={styles.itemTitle} numberOfLines={1}>
                  {preset.label}
                </Text>
                <Text style={styles.itemTag}>load</Text>
              </View>
              <Text style={styles.itemBody} numberOfLines={2}>
                {preset.description}
              </Text>
              <Text style={styles.itemMeta} numberOfLines={1}>
                {preset.type}
              </Text>
            </Pressable>
          ))}
        </Panel>
      ))}
    </ScrollView>
  );

  const renderSettingsTab = () => (
    <ScrollView contentContainerStyle={styles.tabContent}>
      <Panel title="Connection">
        <Field
          label="Server URL"
          value={settings.serverUrl}
          onChangeText={(value) => setSettings((current) => ({ ...current, serverUrl: normalizeServerUrl(value) }))}
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
          <ActionButton title="Connect" onPress={connect} />
          <ActionButton title="Refresh version" onPress={refreshServerVersion} tone="ghost" />
          <ActionButton title="Disconnect" onPress={closeSocket} tone="ghost" />
        </Row>
      </Panel>

      <Panel title="Defaults">
        <Field
          label="Default workspace path"
          value={settings.defaultWorkspacePath}
          onChangeText={(value) => setSettings((current) => ({ ...current, defaultWorkspacePath: value }))}
          placeholder="/home/dev/projects"
        />
        <Field
          label="Default thread id"
          value={settings.defaultThreadId}
          onChangeText={(value) => setSettings((current) => ({ ...current, defaultThreadId: value }))}
          placeholder="thread_1"
        />
        <Field
          label="Default model"
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
      </Panel>

      <Panel title="Diagnostics">
        <Text style={styles.itemBody} numberOfLines={1}>
          version: {serverVersion ? `${serverVersion.name} ${serverVersion.version}` : 'unknown'}
        </Text>
        <Text style={styles.itemBody} numberOfLines={1}>
          data dir: {serverVersion?.data_dir ?? 'unknown'}
        </Text>
        <Text style={styles.itemBody} numberOfLines={1}>
          workspace root: {serverVersion?.workspace_root ?? 'unknown'}
        </Text>
        <Text style={styles.itemBody} numberOfLines={1}>
          active workspace: {activeWorkspace?.path ?? 'none'}
        </Text>
        <Text style={styles.itemBody} numberOfLines={1}>
          pending approvals: {pendingApprovalCount}
        </Text>
        <Text style={styles.itemBody} numberOfLines={1}>
          current turn: {turnId || 'unknown'}
        </Text>
      </Panel>
    </ScrollView>
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'workspaces':
        return renderWorkspaceTab();
      case 'chat':
        return renderChatTab();
      case 'tasks':
        return renderTasksTab();
      case 'commands':
        return renderCommandsTab();
      case 'settings':
        return renderSettingsTab();
      default:
        return null;
    }
  };

  if (!hydrated) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="light" />
        <Text style={styles.loadingTitle}>TodeX Mobile</Text>
        <Text style={styles.loadingText}>Loading settings and workspaces…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />
      {renderTopBanner()}
      <View style={styles.content}>{renderContent()}</View>
      <View style={styles.bottomNav}>
        {(
          [
            ['workspaces', 'Workspaces'],
            ['chat', 'Chat'],
            ['tasks', 'Tasks'],
            ['commands', 'Commands'],
            ['settings', 'Settings'],
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

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      <View style={styles.panelBody}>{children}</View>
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

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  editable = true,
  secureTextEntry = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
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
        placeholder={placeholder}
        placeholderTextColor="#6f7f9d"
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
    backgroundColor: '#08111f',
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: '#08111f',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingTitle: {
    color: '#f8fbff',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  loadingText: {
    color: '#a8b4cb',
    fontSize: 15,
  },
  banner: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2b42',
    backgroundColor: '#0b1628',
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  bannerLeft: {
    flex: 1,
    minWidth: 0,
  },
  product: {
    color: '#f8fbff',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0,
  },
  bannerText: {
    color: '#c4d2ea',
    fontSize: 13,
    marginTop: 2,
  },
  badge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
  },
  badgeOpen: {
    backgroundColor: '#103c35',
    borderColor: '#2dd4bf',
  },
  badgeMuted: {
    backgroundColor: '#18233a',
    borderColor: '#30415f',
  },
  badgeText: {
    color: '#e8f0ff',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  errorText: {
    color: '#ffb4b4',
    marginTop: 10,
    fontSize: 13,
  },
  metaRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  metaText: {
    flex: 1,
    color: '#8fa2c5',
    fontSize: 12,
  },
  content: {
    flex: 1,
  },
  tabContent: {
    padding: 16,
    gap: 16,
    paddingBottom: 24,
  },
  panel: {
    backgroundColor: '#0d1728',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#213049',
    padding: 14,
    gap: 12,
  },
  panelTitle: {
    color: '#f8fbff',
    fontSize: 15,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  panelBody: {
    gap: 12,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    color: '#95a6c4',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  input: {
    backgroundColor: '#121d31',
    color: '#eff5ff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#263551',
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
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  actionButton: {
    backgroundColor: '#6dd7ff',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonGhost: {
    backgroundColor: '#121d31',
    borderWidth: 1,
    borderColor: '#2e405f',
  },
  actionButtonText: {
    color: '#07111f',
    fontWeight: '700',
    fontSize: 13,
  },
  actionButtonTextGhost: {
    color: '#d8e4fb',
  },
  miniButton: {
    backgroundColor: '#121d31',
    borderWidth: 1,
    borderColor: '#2e405f',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  miniButtonText: {
    color: '#d9e6fd',
    fontSize: 12,
    fontWeight: '600',
  },
  listItem: {
    backgroundColor: '#101a2e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#233452',
    padding: 12,
    gap: 8,
  },
  listItemActive: {
    borderColor: '#6dd7ff',
  },
  listItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  itemTitle: {
    flex: 1,
    color: '#f8fbff',
    fontSize: 14,
    fontWeight: '700',
    minWidth: 0,
  },
  itemTag: {
    color: '#8fdcf8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  itemBody: {
    color: '#bfd0ea',
    fontSize: 13,
    lineHeight: 18,
  },
  itemMeta: {
    color: '#8a9bb8',
    fontSize: 11,
  },
  emptyState: {
    color: '#8a9bb8',
    fontSize: 13,
  },
  timelineItem: {
    backgroundColor: '#101a2e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#233452',
    padding: 12,
    gap: 8,
  },
  bottomNav: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#1f2b42',
    backgroundColor: '#0b1628',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  navButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  navButtonActive: {
    backgroundColor: '#14233b',
  },
  navText: {
    color: '#93a6c5',
    fontSize: 12,
    fontWeight: '700',
  },
  navTextActive: {
    color: '#f8fbff',
  },
});

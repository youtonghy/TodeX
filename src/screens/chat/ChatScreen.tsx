import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from 'react';
import {
  FlatList,
  Image,
  Modal,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  ScrollView,
  TextInput,
  type TextInputSelectionChangeEventData,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { KeyboardAvoidingView, KeyboardStickyView, useKeyboardState } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, InputGroup, Surface, Text, TextArea } from 'heroui-native';
import { ProgressBar } from 'heroui-native-pro';

import {
  buildHttpUrl,
  findCapabilityHashTrigger,
  insertCapabilityReference,
  type ConnectionSettings,
  type PendingRequest,
  type PermissionOption,
  type WorkspaceRecord,
} from '../../lib/todex';
import {
  providerDisplayName,
  type ProviderCommandDescriptor,
  type ProviderDescriptor,
  type ProviderKind,
  type ProviderModelDescriptor,
} from '../../lib/v2';
import { workspaceLinkTarget as sharedWorkspaceLinkTarget, type WorkspaceLinkTarget } from '../../lib/mobileParity';
import {
  CHAT_BOTTOM_FOLLOW_THRESHOLD,
  DEFAULT_COMPOSER_SELECTION,
  MAX_COMPOSER_ATTACHMENTS,
  MAX_FILE_ATTACHMENT_BYTES,
  MAX_IMAGE_ATTACHMENT_BYTES,
  SLASH_COMMANDS,
  attachmentId,
  base64FromDataUrl,
  buildConversationRenderItems,
  buildMentionSuggestions,
  canSwitchConversationAgent,
  compactGoalLabel,
  compactTokenCount,
  conversationPreviewText,
  estimatedBytesFromBase64,
  fileNameFromUri,
  findMentionTrigger,
  formatBytes,
  inferMimeType,
  insertMention,
  isCollapsibleProgressEntry,
  isImageMimeType,
  isVisibleConversationEntry,
  mimeTypeFromDataUrl,
  readBase64DataUrl,
  readTextAttachmentContent,
  resolveFileSizeBytes,
  sessionIdForConversation,
  skillIdFromPath,
  type ComposerAttachmentDraft,
  type ConnectionState,
  type ConversationRecord,
  type ConversationRenderItem,
  type MentionSuggestion,
  type MobileContextUsage,
  type SelectedSkillAttachment,
  type ThreadMenuAction,
  type TimelineEntry,
  type WorkspaceEntry,
} from '../../lib/appCore';
import type { CatalogState } from '../../lib/capabilityCatalog';
import type { TimelineStore } from '../../lib/timelineStore';
import type { WorkbenchTab } from '../../lib/workbench';
import type { RootStackParamList } from '../../navigation/routes';
import { ProviderIcon } from '../../components/ProviderIcon';
import {
  ActionSheet,
  AppSheet,
  ConfirmDialog,
  EmptyStateView,
  HeaderActions,
  HeaderIconButton,
  InlineNotice,
  ListRow,
  ListSection,
  Screen,
  SectionHeader,
  StyledIonicons,
  useAppToast,
  type ActionSheetAction,
} from '../../components/ui';
import { ConversationHeaderTitle } from './ConversationHeaderTitle';
import { ExecutionGroupBubble, MessageBubble } from './MessageBubble';

type PickerSheetState =
  | { kind: 'agent' }
  | { kind: 'profile'; provider: ProviderDescriptor }
  | { kind: 'model' }
  | { kind: 'reasoning' }
  | null;

const INITIAL_RENDER_ITEM_COUNT = 32;
const RENDER_ITEM_PAGE_SIZE = 32;

export type ChatScreenProps = NativeStackScreenProps<RootStackParamList, 'Chat'> & {
  settings: ConnectionSettings;
  workspaces: WorkspaceRecord[];
  conversations: ConversationRecord[];
  timelineStore: TimelineStore;
  pendingRequests: PendingRequest[];
  chatDraft: string;
  composerAttachments: ComposerAttachmentDraft[];
  selectedSkills: SelectedSkillAttachment[];
  composerSelection: TextInputSelectionChangeEventData['selection'];
  isThinking: boolean;
  turnId: string;
  lastError: string;
  connectionState: ConnectionState;
  persistChatDraft: (conversationId: string, value: SetStateAction<string>) => void;
  persistComposerAttachments: (conversationId: string, value: SetStateAction<ComposerAttachmentDraft[]>) => void;
  persistSelectedSkills: (conversationId: string, value: SetStateAction<SelectedSkillAttachment[]>) => void;
  persistComposerSelection: (conversationId: string, value: SetStateAction<TextInputSelectionChangeEventData['selection']>) => void;
  submitChat: (conversationId: string, draft: string) => boolean;
  stopThinking: (conversationId: string) => void;
  sendApprovalResponse: (selection: boolean | PermissionOption, request: PendingRequest) => boolean;
  attachWorkspaceConversation: (workspace: WorkspaceRecord, conversation: ConversationRecord) => boolean;
  loadNativeThreadHistory: (conversationId: string, force?: boolean) => boolean;
  runWorkspaceCommand: (workspace: WorkspaceRecord, conversation: ConversationRecord, command: 'start' | 'status' | 'attach' | 'stop' | 'interrupt') => void;
  runThreadMenuAction: (conversationId: string, action: ThreadMenuAction) => void;
  sendSlashCommand: (input: string, conversationId?: string) => void;
  openGitDiff: (conversationId: string) => void;
  openGit: (conversationId: string) => void;
  openTerminal: (conversationId: string) => void;
  openBrowser: (conversationId: string, target?: { url?: string; filePath?: string }) => void;
  openFiles: (conversationId: string, filePath?: string) => void;
  openWorkbench: (conversationId: string, tab?: WorkbenchTab) => void;
  openUsage: () => void;
  v2Providers: ProviderDescriptor[];
  providerModels: Partial<Record<ProviderKind, ProviderModelDescriptor[]>>;
  providerCommands: Partial<Record<ProviderKind, ProviderCommandDescriptor[]>>;
  providerCatalogStatus: Partial<Record<ProviderKind, 'idle' | 'loading' | 'ready' | 'error'>>;
  contextUsage: MobileContextUsage | null;
  switchConversationAgent: (conversationId: string, provider: ProviderKind, providerProfile?: string) => boolean;
  applyConversationModelSelection: (conversationId: string, model: string, reasoningEffort: string | null) => void;
  refreshProviderCatalog: (provider: ProviderKind, workspacePath?: string) => Promise<boolean>;
  removeWorkspace: (workspaceId: string) => void;
  capabilityCatalog?: CatalogState;
};

export function ChatScreen({
  navigation,
  route,
  settings,
  workspaces,
  conversations,
  timelineStore,
  pendingRequests,
  chatDraft: persistedChatDraft,
  composerAttachments,
  selectedSkills,
  composerSelection: persistedComposerSelection,
  isThinking,
  turnId,
  lastError,
  connectionState,
  persistChatDraft,
  persistComposerAttachments,
  persistSelectedSkills,
  persistComposerSelection,
  submitChat,
  stopThinking,
  sendApprovalResponse,
  attachWorkspaceConversation,
  loadNativeThreadHistory,
  runWorkspaceCommand,
  runThreadMenuAction,
  sendSlashCommand,
  openGitDiff,
  openGit,
  openTerminal,
  openBrowser,
  openFiles,
  openWorkbench,
  openUsage,
  v2Providers,
  providerModels,
  providerCommands,
  providerCatalogStatus,
  contextUsage,
  switchConversationAgent,
  applyConversationModelSelection,
  refreshProviderCatalog,
  removeWorkspace,
  capabilityCatalog,
}: ChatScreenProps) {
  const toast = useAppToast();
  const conversationId = route.params.conversationId;
  const [chatDraft, setLocalChatDraft] = useState(persistedChatDraft);
  const [composerSelection, setLocalComposerSelection] = useState(persistedComposerSelection);
  const [menuVisible, setMenuVisible] = useState(false);
  const [removeWorkspaceVisible, setRemoveWorkspaceVisible] = useState(false);
  const [pickerSheet, setPickerSheet] = useState<PickerSheetState>(null);
  const [mentionEntries, setMentionEntries] = useState<WorkspaceEntry[]>([]);
  const [expandedProgressIds, setExpandedProgressIds] = useState<Set<string>>(() => new Set());
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [attachmentMenuVisible, setAttachmentMenuVisible] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [historyLoadReady, setHistoryLoadReady] = useState(false);
  const [visibleRenderItemCount, setVisibleRenderItemCount] = useState(INITIAL_RENDER_ITEM_COUNT);
  const messageScrollRef = useRef<FlatList<ConversationRenderItem> | null>(null);
  const shouldFollowLatestRef = useRef(true);
  const initialLatestScrollRef = useRef(true);
  const pendingScrollFrameRef = useRef<number | null>(null);
  const attachedSessionKeyRef = useRef('');
  const composerInputRef = useRef<TextInput | null>(null);
  const expandedComposerInputRef = useRef<TextInput | null>(null);
  const autoExpandedProgressIdsRef = useRef<Set<string>>(new Set());
  const autoExpandedRequestIdsRef = useRef<Map<string, string[]>>(new Map());
  const chatDraftRef = useRef(persistedChatDraft);
  const composerSelectionRef = useRef(persistedComposerSelection);
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const composerKeyboardOffset = useMemo(() => ({ opened: insets.bottom }), [insets.bottom]);
  const composerPaddingBottom = 12 + insets.bottom;

  const setChatDraft = useCallback((value: SetStateAction<string>) => {
    setLocalChatDraft((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      chatDraftRef.current = next;
      return next;
    });
  }, []);
  const setComposerSelection = useCallback((value: SetStateAction<TextInputSelectionChangeEventData['selection']>) => {
    setLocalComposerSelection((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      composerSelectionRef.current = next;
      return next;
    });
  }, []);
  const setComposerAttachments = useCallback(
    (value: SetStateAction<ComposerAttachmentDraft[]>) => persistComposerAttachments(conversationId, value),
    [conversationId, persistComposerAttachments],
  );
  const setSelectedSkills = useCallback(
    (value: SetStateAction<SelectedSkillAttachment[]>) => persistSelectedSkills(conversationId, value),
    [conversationId, persistSelectedSkills],
  );
  const persistComposerState = useCallback(() => {
    persistChatDraft(conversationId, chatDraftRef.current);
    persistComposerSelection(conversationId, composerSelectionRef.current);
  }, [conversationId, persistChatDraft, persistComposerSelection]);
  const clearLocalComposerDraft = useCallback(() => {
    chatDraftRef.current = '';
    composerSelectionRef.current = DEFAULT_COMPOSER_SELECTION;
    setLocalChatDraft('');
    setLocalComposerSelection(DEFAULT_COMPOSER_SELECTION);
  }, []);
  const clearComposerDraft = useCallback(() => {
    clearLocalComposerDraft();
    persistChatDraft(conversationId, '');
    persistComposerSelection(conversationId, DEFAULT_COMPOSER_SELECTION);
  }, [clearLocalComposerDraft, conversationId, persistChatDraft, persistComposerSelection]);
  const submitComposer = useCallback(() => {
    if (submitChat(conversationId, chatDraftRef.current)) {
      clearLocalComposerDraft();
    }
  }, [clearLocalComposerDraft, conversationId, submitChat]);

  useEffect(() => {
    chatDraftRef.current = persistedChatDraft;
    composerSelectionRef.current = persistedComposerSelection;
    setLocalChatDraft(persistedChatDraft);
    setLocalComposerSelection(persistedComposerSelection);
  }, [conversationId, persistedChatDraft, persistedComposerSelection]);

  useEffect(() => () => {
    persistChatDraft(conversationId, chatDraftRef.current);
    persistComposerSelection(conversationId, composerSelectionRef.current);
  }, [conversationId, persistChatDraft, persistComposerSelection]);

  const workspace = workspaces.find((item) => item.id === route.params.workspaceId) ?? null;
  const conversation = conversations.find((item) => item.id === route.params.conversationId) ?? null;
  const subscribeTimeline = useCallback(
    (listener: () => void) => timelineStore.subscribeConversation(
      route.params.workspaceId,
      route.params.conversationId,
      listener,
    ),
    [route.params.conversationId, route.params.workspaceId, timelineStore],
  );
  const getTimelineSnapshot = useCallback(
    () => timelineStore.getConversationSnapshot(route.params.workspaceId, route.params.conversationId),
    [route.params.conversationId, route.params.workspaceId, timelineStore],
  );
  const timeline = useSyncExternalStore(subscribeTimeline, getTimelineSnapshot, getTimelineSnapshot);
  const currentProvider = conversation?.provider as ProviderKind | undefined;
  const agentProvider = currentProvider || (conversation ? 'codex' : undefined);
  const availableProviders = useMemo(
    () => v2Providers.filter((provider) => provider.available),
    [v2Providers],
  );
  const providerDescriptor = currentProvider
    ? v2Providers.find((provider) => provider.id === currentProvider)
    : v2Providers.find((provider) => provider.id === 'codex');
  const liveProviderModels = currentProvider ? providerModels[currentProvider] ?? providerDescriptor?.models ?? [] : [];
  const currentModel = conversation?.model
    || liveProviderModels.find((model) => model.isDefault)?.id
    || (agentProvider === 'codex' ? workspace?.model || settings.defaultModel : '');
  const currentReasoningEffort = conversation?.reasoningEffort ?? (agentProvider === 'codex' ? workspace?.reasoningEffort ?? settings.defaultReasoningEffort ?? null : null);
  const currentModelDescriptor = liveProviderModels.find((model) => model.id === currentModel || model.id.endsWith(`/${currentModel}`));
  const currentProviderCommands = currentProvider ? providerCommands[currentProvider] ?? [] : [];
  const canSwitchAgent = conversation ? canSwitchConversationAgent(conversation, timeline, isThinking) : false;
  const contextWindow = contextUsage?.contextWindow ?? currentModelDescriptor?.contextWindow;
  const contextPercent = contextWindow && contextUsage ? Math.min(100, Math.max(0, contextUsage.usedTokens / contextWindow * 100)) : null;
  const conversationMessages = useMemo(
    () => timeline
      .filter(isVisibleConversationEntry)
      .slice()
      .reverse(),
    [timeline],
  );
  const chatHeaderTitle = conversation?.title || conversationPreviewText(conversationMessages[conversationMessages.length - 1]);
  const conversationRenderItems = useMemo(
    () => buildConversationRenderItems(conversationMessages),
    [conversationMessages],
  );
  const latestIncomingEntryId = useMemo(() => {
    for (let index = conversationMessages.length - 1; index >= 0; index -= 1) {
      if (conversationMessages[index].kind === 'incoming') {
        return conversationMessages[index].id;
      }
    }
    return '';
  }, [conversationMessages]);
  const visibleConversationRenderItems = useMemo(
    () => conversationRenderItems.slice(-visibleRenderItemCount),
    [conversationRenderItems, visibleRenderItemCount],
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
  const providerSlashCommands = currentProviderCommands.map((item) => ({
    command: `/${item.name}`,
    title: item.name,
    description: item.description || `${item.source} command`,
  }));
  const slashCatalog = [...SLASH_COMMANDS, ...providerSlashCommands];
  const slashSuggestions = chatDraft.startsWith('/')
    ? slashCatalog.filter((item, index, list) => {
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
  const capabilityHashTrigger = slashSuggestions.length === 0 ? findCapabilityHashTrigger(chatDraft, composerSelection.start) : null;
  const capabilitySuggestions = useMemo(() => {
    if (!capabilityHashTrigger || !capabilityCatalog) return [];
    const query = capabilityHashTrigger.query.toLowerCase();
    const skills = (capabilityCatalog.skills?.skills ?? [])
      .filter((item) => item.active && item.valid && (!query || item.name.toLowerCase().includes(query)))
      .slice(0, 6)
      .map((item) => ({ id: `skill:${item.resourceId}`, kind: 'skill' as const, name: item.name, description: item.description, insertText: `#skill/${item.name} ` }));
    const servers = (capabilityCatalog.mcp?.servers ?? [])
      .filter((item) => item.active && item.enabled && (!query || item.name.toLowerCase().includes(query)))
      .slice(0, 6)
      .map((item) => ({ id: `mcp:${item.resourceId}`, kind: 'mcp' as const, name: item.name, description: `${item.transport} MCP Server`, insertText: `#mcp/${item.name} ` }));
    return [...skills, ...servers].slice(0, 8);
  }, [capabilityCatalog, capabilityHashTrigger]);

  const chooseProvider = useCallback((provider: ProviderDescriptor) => {
    if (!conversation || !canSwitchAgent || !provider.available) return;
    if (provider.profiles.length <= 1) {
      switchConversationAgent(conversation.id, provider.id, provider.profiles[0]);
      return;
    }
    setPickerSheet({ kind: 'profile', provider });
  }, [canSwitchAgent, conversation, switchConversationAgent]);

  const chooseAgent = useCallback(() => {
    if (!conversation || !canSwitchAgent) return;
    if (availableProviders.length === 0) {
      toast.warning('暂无可用 Agent', '请检查后端 Provider 配置后重试。');
      return;
    }
    setPickerSheet({ kind: 'agent' });
  }, [availableProviders.length, canSwitchAgent, conversation, toast]);

  const modelOptions = useMemo(
    () => (liveProviderModels.length > 0
      ? liveProviderModels
      : currentModel
        ? [{ id: currentModel, displayName: currentModel, description: '', isDefault: true, supportedReasoningEfforts: [], contextWindow: undefined }]
        : []),
    [currentModel, liveProviderModels],
  );

  const chooseModel = useCallback(() => {
    if (!conversation) return;
    if (modelOptions.length === 0) {
      if (currentProvider) void refreshProviderCatalog(currentProvider, workspace?.path);
      toast.info('暂无模型', '正在刷新当前 Agent 的模型列表，请稍后再试。');
      return;
    }
    setPickerSheet({ kind: 'model' });
  }, [conversation, currentProvider, modelOptions.length, refreshProviderCatalog, toast, workspace?.path]);

  const reasoningOptions = useMemo(() => {
    const efforts = currentModelDescriptor?.supportedReasoningEfforts ?? [];
    return [...new Set([...(currentReasoningEffort ? [currentReasoningEffort] : []), ...efforts])];
  }, [currentModelDescriptor?.supportedReasoningEfforts, currentReasoningEffort]);

  const chooseReasoning = useCallback(() => {
    if (!conversation) return;
    if (reasoningOptions.length === 0) {
      toast.info('思考强度', '当前 Agent 没有返回可选强度，将使用 Provider 默认值。');
      return;
    }
    setPickerSheet({ kind: 'reasoning' });
  }, [conversation, reasoningOptions.length, toast]);

  const pickerSheetTitle = pickerSheet?.kind === 'agent'
    ? '选择 Agent'
    : pickerSheet?.kind === 'profile'
      ? '选择 Agent 配置'
      : pickerSheet?.kind === 'model'
        ? '选择模型'
        : pickerSheet?.kind === 'reasoning'
          ? '思考强度'
          : undefined;
  const pickerSheetDescription = pickerSheet?.kind === 'agent'
    ? providerDescriptor?.displayName || '当前对话 Agent'
    : pickerSheet?.kind === 'profile'
      ? pickerSheet.provider.displayName
      : pickerSheet?.kind === 'model'
        ? '当前对话模型'
        : pickerSheet?.kind === 'reasoning'
          ? currentModel || '当前模型'
          : undefined;
  const pickerSheetActions = useMemo<ActionSheetAction[]>(() => {
    if (!pickerSheet || !conversation) return [];
    if (pickerSheet.kind === 'agent') {
      return availableProviders.map((provider) => ({
        id: provider.id,
        label: provider.displayName,
        description: provider.profiles.length > 1 ? `${provider.profiles.length} 个配置` : undefined,
        icon: provider.id === currentProvider ? 'checkmark-circle' : 'ellipse-outline',
        onPress: () => chooseProvider(provider),
      }));
    }
    if (pickerSheet.kind === 'profile') {
      const { provider } = pickerSheet;
      return [
        ...provider.profiles.map((profile) => ({
          id: profile,
          label: profile,
          icon: 'person-circle-outline' as const,
          onPress: () => switchConversationAgent(conversation.id, provider.id, profile),
        })),
        { id: 'default', label: '默认配置', icon: 'options-outline' as const, onPress: () => switchConversationAgent(conversation.id, provider.id) },
      ];
    }
    if (pickerSheet.kind === 'model') {
      return [
        ...modelOptions.map((model) => ({
          id: model.id,
          label: model.displayName || model.id,
          description: model.description || undefined,
          icon: (model.id === currentModel ? 'checkmark-circle' : 'hardware-chip-outline') as ActionSheetAction['icon'],
          onPress: () => applyConversationModelSelection(conversation.id, model.id, model.supportedReasoningEfforts[0] || currentReasoningEffort || null),
        })),
        {
          id: 'refresh',
          label: '刷新列表',
          icon: 'refresh-outline' as const,
          onPress: () => {
            if (currentProvider) void refreshProviderCatalog(currentProvider, workspace?.path);
          },
        },
      ];
    }
    return [
      ...reasoningOptions.map((effort) => ({
        id: effort,
        label: effort,
        icon: (effort === currentReasoningEffort ? 'checkmark-circle' : 'flash-outline') as ActionSheetAction['icon'],
        onPress: () => applyConversationModelSelection(conversation.id, currentModel, effort),
      })),
      { id: 'default', label: '使用默认', icon: 'options-outline' as const, onPress: () => applyConversationModelSelection(conversation.id, currentModel, null) },
    ];
  }, [
    applyConversationModelSelection,
    availableProviders,
    chooseProvider,
    conversation,
    currentModel,
    currentProvider,
    currentReasoningEffort,
    modelOptions,
    pickerSheet,
    reasoningOptions,
    refreshProviderCatalog,
    switchConversationAgent,
    workspace?.path,
  ]);

  useEffect(() => {
    setHistoryLoadReady(false);
    setComposerExpanded(false);
    setVisibleRenderItemCount(INITIAL_RENDER_ITEM_COUNT);
    initialLatestScrollRef.current = true;
    shouldFollowLatestRef.current = true;
    let cancelled = false;
    let released = false;
    const release = () => {
      if (cancelled || released) return;
      released = true;
      setHistoryLoadReady(true);
    };
    const unsubscribe = navigation.addListener('transitionEnd', (event) => {
      if (!event.data.closing) release();
    });
    const idleCallbackId = requestIdleCallback(release);
    return () => {
      cancelled = true;
      unsubscribe();
      cancelIdleCallback(idleCallbackId);
    };
  }, [navigation, route.params.conversationId]);

  useEffect(() => {
    if (!historyLoadReady) return;
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
  }, [attachWorkspaceConversation, connectionState, conversation?.id, conversation?.sessionId, historyLoadReady, workspace?.id]);

  useEffect(() => {
    if (!historyLoadReady) return;
    if (connectionState !== 'open' || !conversation?.threadId) {
      return;
    }
    loadNativeThreadHistory(conversation.id);
  }, [connectionState, conversation?.id, conversation?.threadId, historyLoadReady, loadNativeThreadHistory]);

  const scrollToLatest = useCallback((animated = false) => {
    if (pendingScrollFrameRef.current !== null) return;
    pendingScrollFrameRef.current = requestAnimationFrame(() => {
      pendingScrollFrameRef.current = null;
      messageScrollRef.current?.scrollToEnd({ animated });
    });
  }, []);

  useEffect(() => () => {
    if (pendingScrollFrameRef.current !== null) {
      cancelAnimationFrame(pendingScrollFrameRef.current);
      pendingScrollFrameRef.current = null;
    }
  }, []);

  const handleMessageScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const isAtBottom = distanceFromBottom <= CHAT_BOTTOM_FOLLOW_THRESHOLD;
    shouldFollowLatestRef.current = isAtBottom;
    setShowJumpToLatest(!isAtBottom && conversationMessages.length > 0);
    if (contentOffset.y <= CHAT_BOTTOM_FOLLOW_THRESHOLD && visibleRenderItemCount < conversationRenderItems.length) {
      setVisibleRenderItemCount((current) => Math.min(conversationRenderItems.length, current + RENDER_ITEM_PAGE_SIZE));
    }
  }, [conversationMessages.length, conversationRenderItems.length, visibleRenderItemCount]);

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

  const keyConversationRenderItem = useCallback((item: ConversationRenderItem) => {
    return item.type === 'executionGroup' ? item.id : item.entry.id;
  }, []);

  useEffect(() => {
    if (!mentionTrigger || !workspace) {
      setMentionEntries([]);
      return;
    }

    const controller = new AbortController();
    const url = new URL(buildHttpUrl(settings.serverUrl, '/v2/workspace/entries'));
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

  const selectCapability = useCallback((item: { insertText: string }) => {
    if (!capabilityHashTrigger) return;
    const nextText = insertCapabilityReference(chatDraft, capabilityHashTrigger, item.insertText);
    const nextCursor = capabilityHashTrigger.start + item.insertText.length;
    setChatDraft(nextText);
    setComposerSelection({ start: nextCursor, end: nextCursor });
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }, [capabilityHashTrigger, chatDraft, setChatDraft, setComposerSelection]);

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
      toast.warning(
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
          toast.warning('读取剪贴板失败', '没有拿到图片数据。');
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

      toast.warning('剪贴板里没有可用图片', '请先复制一张图片后再粘贴。');
      setAttachmentMenuVisible(false);
    } catch (error) {
      toast.warning('粘贴失败', error instanceof Error ? error.message : '无法从剪贴板读取图片。');
    }
  }, [appendComposerAttachments]);

  const pickLibraryAttachments = useCallback(async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        toast.warning('需要相册权限', '允许相册权限后才能从相册选择图片。');
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
      toast.warning('选择图片失败', error instanceof Error ? error.message : '无法从相册导入图片。');
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
      toast.warning('选择文件失败', error instanceof Error ? error.message : '无法打开文件选择器。');
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
    (selection: boolean | PermissionOption, request: PendingRequest) => {
      const sent = sendApprovalResponse(selection, request);
      if (sent) {
        collapseAutoExpandedRequest(request.requestId);
      }
    },
    [collapseAutoExpandedRequest, sendApprovalResponse],
  );

  const openMessageLink = useCallback((href: string) => {
    if (!workspace || !conversation) return;
    const target: WorkspaceLinkTarget = sharedWorkspaceLinkTarget(href, workspace.path, { requireLoopback: true });
    if (!target) {
      toast.warning('无法打开链接', '仅支持当前工作区内的文件和本机 HTTP 地址。');
      return;
    }
    if (target.kind === 'browser-url') {
      openBrowser(conversation.id, { url: target.url });
    } else if (target.kind === 'browser-file') {
      openBrowser(conversation.id, { filePath: target.filePath });
    } else {
      openFiles(conversation.id, target.filePath);
    }
  }, [conversation, openBrowser, openFiles, workspace]);

  const forkCurrentConversation = useCallback(() => {
    if (conversation) runThreadMenuAction(conversation.id, 'fork');
  }, [conversation?.id, runThreadMenuAction]);

  const renderConversationRenderItem = useCallback(({ item }: ListRenderItemInfo<ConversationRenderItem>) => {
    if (item.type === 'executionGroup') {
      const manuallyExpanded = expandedProgressIds.has(item.id);
      const collapsed = !manuallyExpanded;
      return (
        <ExecutionGroupBubble
          id={item.id}
          entries={item.entries}
          collapsed={collapsed}
          compactItems
          expandedProgressIds={expandedProgressIds}
          pendingRequestById={pendingRequestById}
          onToggleGroup={toggleProgressId}
          onToggleProgress={toggleProgressEntry}
          onApprovalResponse={handleApprovalResponse}
          onOpenLink={openMessageLink}
        />
      );
    }

    const entry = item.entry;
    const collapsible = isCollapsibleProgressEntry(entry);
    const manuallyExpanded = expandedProgressIds.has(entry.id);
    const collapsed = collapsible ? !manuallyExpanded : false;
    const isLatestIncoming = entry.kind === 'incoming' && entry.id === latestIncomingEntryId;
    return (
      <MessageBubble
        entry={entry}
        collapsed={collapsed}
        collapsible={collapsible}
        pendingRequest={entry.requestId ? pendingRequestById.get(entry.requestId) : undefined}
        onToggleProgress={toggleProgressEntry}
        onApprovalResponse={handleApprovalResponse}
        onOpenLink={openMessageLink}
        onFork={entry.kind === 'incoming' && conversation ? forkCurrentConversation : undefined}
        usage={isLatestIncoming ? contextUsage : null}
        streaming={isLatestIncoming && isThinking}
      />
    );
  }, [
    expandedProgressIds,
    handleApprovalResponse,
    contextUsage,
    conversation,
    forkCurrentConversation,
    isThinking,
    latestIncomingEntryId,
    openMessageLink,
    pendingRequestById,
    toggleProgressEntry,
    toggleProgressId,
  ]);

  useEffect(() => {
    shouldFollowLatestRef.current = true;
    initialLatestScrollRef.current = true;
    setShowJumpToLatest(false);
    scrollToLatest(false);
  }, [route.params.conversationId, scrollToLatest]);

  useEffect(() => {
    if (keyboardVisible && shouldFollowLatestRef.current) {
      scrollToLatest(false);
    }
  }, [keyboardVisible, scrollToLatest]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <ConversationHeaderTitle
          title={chatHeaderTitle}
          mode={conversation?.mode ?? 'implement'}
          goalLabel={conversation ? compactGoalLabel(conversation) : 'No goal'}
          localState={conversation?.localAdapterState ?? 'idle'}
          agentLabel={conversation?.provider ? providerDisplayName(conversation.provider) : conversation ? '历史 Codex' : undefined}
        />
      ),
      headerRight: () => (
        <HeaderActions>
          <HeaderIconButton
            icon="git-branch-outline"
            label="Git"
            onPress={() => {
              if (conversation) {
                openGit(conversation.id);
              }
            }}
          />
          <HeaderIconButton icon="ellipsis-horizontal" label="更多" onPress={() => setMenuVisible(true)} />
        </HeaderActions>
      ),
    });
  }, [
    conversation?.goalObjective,
    conversation?.goalStatus,
    conversation?.id,
    conversation?.localAdapterState,
    conversation?.mode,
    conversation?.provider,
    chatHeaderTitle,
    navigation,
    openGit,
  ]);

  if (!workspace || !conversation) {
    return (
      <Screen>
        <EmptyStateView
          icon="chatbubble-ellipses-outline"
          title="对话不存在"
          description="请返回后重新选择。"
          actionLabel="返回"
          onAction={() => navigation.goBack()}
          className="flex-1 justify-center"
        />
      </Screen>
    );
  }

  const menuSection = (title: string, actions: ActionSheetAction[]) => (
    <View className="gap-2">
      <SectionHeader title={title} />
      <ListSection variant="secondary">
        {actions.map((action) => (
          <ListRow
            key={action.id}
            title={action.label}
            description={action.description}
            icon={action.icon}
            iconClassName={action.destructive ? 'bg-danger/15' : 'bg-default'}
            iconColorClassName={action.destructive ? 'text-danger' : 'text-foreground'}
            isDisabled={action.disabled}
            showChevron={!action.destructive}
            onPress={() => {
              setMenuVisible(false);
              action.onPress();
            }}
            className={action.destructive ? 'min-h-12' : 'min-h-12'}
          />
        ))}
      </ListSection>
    </View>
  );

  const controlChipClassName = 'h-9 rounded-full px-3';

  return (
    <Screen>
      {lastError ? (
        <View className="px-3 pt-2">
          <InlineNotice status="danger" title="连接异常" description={lastError} />
        </View>
      ) : null}

      <View className="relative min-h-0 flex-1">
        <FlatList
          ref={messageScrollRef}
          data={visibleConversationRenderItems}
          renderItem={renderConversationRenderItem}
          keyExtractor={keyConversationRenderItem}
          className="flex-1"
          contentContainerClassName="px-2 pb-3 pt-3"
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyStateView
              icon="sparkles-outline"
              title="这是一段新的对话"
              description="输入消息开始，或使用 / 查看命令、@ 引用文件、# 调用 Skill 与 MCP。"
            />
          }
          initialNumToRender={18}
          maxToRenderPerBatch={12}
          updateCellsBatchingPeriod={40}
          windowSize={9}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          removeClippedSubviews={Platform.OS !== 'web'}
          onContentSizeChange={handleMessageContentSizeChange}
          onScroll={handleMessageScroll}
          scrollEventThrottle={80}
        />

        {showJumpToLatest ? (
          <View className="absolute bottom-3 w-full items-center">
            <Button size="sm" variant="secondary" accessibilityLabel="跳到最新消息" onPress={jumpToLatest} className="h-9 rounded-full px-3 shadow-sm">
              <StyledIonicons name="arrow-down" size={15} className="text-foreground" />
              <Button.Label>最新消息</Button.Label>
            </Button>
          </View>
        ) : null}
      </View>

      <KeyboardStickyView offset={composerKeyboardOffset}>
        <Surface variant="secondary" className="gap-2 rounded-t-3xl px-3 pt-2.5" style={{ paddingBottom: composerPaddingBottom }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerClassName="items-center gap-2 pr-2"
          >
            <Button
              size="sm"
              variant="primary"
              isDisabled={!canSwitchAgent || (agentProvider ? providerCatalogStatus[agentProvider] === 'loading' : false)}
              onPress={chooseAgent}
              className={`${controlChipClassName} max-w-[176px]`}
              accessibilityLabel="选择 Agent"
            >
              <ProviderIcon provider={agentProvider} size={12} />
              <Button.Label numberOfLines={1}>
                {providerDescriptor?.displayName || providerDisplayName(agentProvider || 'codex')}
              </Button.Label>
              <StyledIonicons name="chevron-down" size={13} className="text-accent-foreground" />
            </Button>
            <Button size="sm" variant="secondary" onPress={chooseModel} className={`${controlChipClassName} max-w-[170px]`} accessibilityLabel="选择模型">
              <StyledIonicons name="hardware-chip-outline" size={14} className="text-foreground" />
              <Button.Label numberOfLines={1}>{currentModel || '选择模型'}</Button.Label>
            </Button>
            <Button size="sm" variant="secondary" onPress={chooseReasoning} className={`${controlChipClassName} max-w-[136px]`} accessibilityLabel="选择思考强度">
              <StyledIonicons name="flash-outline" size={14} className="text-foreground" />
              <Button.Label numberOfLines={1}>{currentReasoningEffort || '默认强度'}</Button.Label>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => navigation.navigate('SlashCommandAction', { workspaceId: workspace.id, conversationId: conversation.id, command: '/permissions' })}
              className={controlChipClassName}
              accessibilityLabel="选择权限"
            >
              <StyledIonicons name="shield-checkmark-outline" size={14} className="text-foreground" />
              <Button.Label numberOfLines={1}>权限</Button.Label>
            </Button>
            {contextUsage ? (
              <View className="h-9 min-w-[128px] justify-center rounded-full bg-default px-3">
                <ProgressBar value={contextPercent ?? 0} size="sm" color={(contextPercent ?? 0) > 85 ? 'danger' : (contextPercent ?? 0) > 65 ? 'warning' : 'accent'} className="gap-1">
                  <Text type="body-xs" weight="semibold" className="text-foreground" numberOfLines={1}>
                    {compactTokenCount(contextUsage.usedTokens)}{contextWindow ? ` / ${compactTokenCount(contextWindow)}` : ''} tok
                  </Text>
                  <ProgressBar.Track className="h-1">
                    <ProgressBar.Fill />
                  </ProgressBar.Track>
                </ProgressBar>
              </View>
            ) : null}
          </ScrollView>

          {slashSuggestions.length > 0 ? (
            <ScrollView keyboardShouldPersistTaps="handled" className="max-h-72">
              <ListSection>
                {slashSuggestions.map((item) => (
                  <ListRow
                    key={item.command}
                    title={item.command}
                    description={item.description || item.title}
                    icon="terminal-outline"
                    iconClassName="bg-accent/15"
                    iconColorClassName="text-accent"
                    className="min-h-12 py-2"
                    onPress={() => {
                      if (item.command === '/skills') {
                        sendSlashCommand('/skills', route.params.conversationId);
                        clearComposerDraft();
                        return;
                      }
                      const nextText = `${item.command} `;
                      setChatDraft(nextText);
                      setComposerSelection({ start: nextText.length, end: nextText.length });
                    }}
                  />
                ))}
              </ListSection>
            </ScrollView>
          ) : null}
          {capabilitySuggestions.length > 0 ? (
            <ListSection>
              {capabilitySuggestions.map((item) => (
                <ListRow
                  key={item.id}
                  title={item.name}
                  description={item.description || (item.kind === 'skill' ? 'Skill' : 'MCP Server')}
                  icon={item.kind === 'skill' ? 'flash-outline' : 'server-outline'}
                  iconClassName={item.kind === 'skill' ? 'bg-accent/15' : 'bg-success/15'}
                  iconColorClassName={item.kind === 'skill' ? 'text-accent' : 'text-success'}
                  className="min-h-12 py-2"
                  onPress={() => selectCapability(item)}
                />
              ))}
            </ListSection>
          ) : null}
          {mentionSuggestions.length > 0 ? (
            <ListSection>
              {mentionSuggestions.map((item) => (
                <ListRow
                  key={item.id}
                  title={item.title}
                  description={item.description}
                  icon={item.title.endsWith('/') ? 'folder-outline' : 'document-text-outline'}
                  iconClassName="bg-accent/15"
                  iconColorClassName="text-accent"
                  className="min-h-12 py-2"
                  onPress={() => selectMention(item)}
                />
              ))}
            </ListSection>
          ) : null}

          {composerAttachments.length > 0 || selectedSkills.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerClassName="gap-2 pr-2">
              {composerAttachments.map((attachment) => (
                <View key={attachment.id} className="flex-row items-center gap-2 rounded-2xl bg-default pl-1.5 pr-1">
                  {attachment.kind === 'image' ? (
                    <Image source={{ uri: attachment.dataUrl }} className="h-9 w-9 rounded-xl" />
                  ) : (
                    <View className="h-9 w-9 items-center justify-center rounded-xl bg-surface-tertiary">
                      <StyledIonicons name="document-outline" size={16} className="text-foreground" />
                    </View>
                  )}
                  <View className="max-w-[140px]">
                    <Text type="body-xs" weight="semibold" className="text-foreground" numberOfLines={1}>
                      {attachment.name}
                    </Text>
                    <Text type="body-xs" color="muted" numberOfLines={1}>
                      {attachment.kind === 'image' ? '图片' : '文件'} · {formatBytes(attachment.sizeBytes)}
                    </Text>
                  </View>
                  <Button isIconOnly size="sm" variant="ghost" accessibilityLabel={`移除附件 ${attachment.name}`} onPress={() => removeComposerAttachment(attachment.id)} className="h-8 w-8 rounded-full">
                    <StyledIonicons name="close" size={14} className="text-muted" />
                  </Button>
                </View>
              ))}
              {selectedSkills.map((skill) => (
                <View key={skillIdFromPath(skill.name, skill.path)} className="flex-row items-center gap-2 rounded-2xl bg-accent/10 pl-1.5 pr-1">
                  <View className="h-9 w-9 items-center justify-center rounded-xl bg-accent/15">
                    <StyledIonicons name="flash" size={15} className="text-accent" />
                  </View>
                  <View className="max-w-[140px]">
                    <Text type="body-xs" weight="semibold" className="text-foreground" numberOfLines={1}>
                      {skill.displayName || skill.name}
                    </Text>
                    <Text type="body-xs" color="muted" numberOfLines={1}>
                      {skill.name}
                    </Text>
                  </View>
                  <Button isIconOnly size="sm" variant="ghost" accessibilityLabel={`移除 Skill ${skill.displayName || skill.name}`} onPress={() => removeSelectedSkill(skill)} className="h-8 w-8 rounded-full">
                    <StyledIonicons name="close" size={14} className="text-muted" />
                  </Button>
                </View>
              ))}
            </ScrollView>
          ) : null}

          <View className="h-11 flex-row items-center gap-2">
            <Button isIconOnly size="md" variant="ghost" accessibilityLabel="添加附件" onPress={() => setAttachmentMenuVisible(true)} className="h-11 w-11 rounded-full">
              <StyledIonicons name="add" size={22} className="text-foreground" />
            </Button>
            <InputGroup className="h-11 min-w-0 flex-1">
              <InputGroup.Input
                ref={composerInputRef}
                value={chatDraft}
                onChangeText={setChatDraft}
                onSelectionChange={(event) => setComposerSelection(event.nativeEvent.selection)}
                onBlur={persistComposerState}
                onKeyPress={(event) => {
                  if (event.nativeEvent.key === 'Escape' && isThinking) {
                    stopThinking(route.params.conversationId);
                  }
                }}
                selection={composerSelection}
                placeholder="输入消息，#能力，@文件，/命令"
                autoCapitalize="none"
                autoCorrect={false}
                multiline={false}
                containerClassName="h-11 min-h-11 rounded-2xl"
                className="h-11 min-h-11 text-[15px] leading-5"
              />
              <InputGroup.Suffix className="px-1.5">
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  accessibilityLabel="全屏编辑消息"
                  onPress={() => setComposerExpanded(true)}
                  className="h-8 w-8 rounded-full"
                >
                  <StyledIonicons name="expand-outline" size={16} className="text-muted" />
                </Button>
              </InputGroup.Suffix>
            </InputGroup>
            {turnId ? (
              <Button isIconOnly size="md" variant="danger-soft" accessibilityLabel="中断当前任务" onPress={() => stopThinking(route.params.conversationId)} className="h-11 w-11 rounded-full">
                <StyledIonicons name="stop" size={18} className="text-danger" />
              </Button>
            ) : null}
            <Button
              isIconOnly
              size="md"
              variant="primary"
              accessibilityLabel="发送消息"
              isDisabled={!chatDraft.trim() && composerAttachments.length === 0 && selectedSkills.length === 0}
              onPress={submitComposer}
              className="h-11 w-11 rounded-full"
            >
              <StyledIonicons name="arrow-up" size={20} className="text-accent-foreground" />
            </Button>
          </View>
        </Surface>
      </KeyboardStickyView>

      <Modal
        visible={composerExpanded}
        animationType="slide"
        presentationStyle="fullScreen"
        statusBarTranslucent
        navigationBarTranslucent
        onShow={() => expandedComposerInputRef.current?.focus()}
        onRequestClose={() => setComposerExpanded(false)}
      >
        <Surface variant="secondary" className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
          <View className="h-14 flex-row items-center justify-between border-b border-separator px-4">
            <Text type="h5" className="text-foreground">编辑消息</Text>
            <Button
              isIconOnly
              size="md"
              variant="ghost"
              accessibilityLabel="退出全屏编辑"
              onPress={() => setComposerExpanded(false)}
              className="h-10 w-10 rounded-full"
            >
              <StyledIonicons name="contract-outline" size={20} className="text-foreground" />
            </Button>
          </View>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
            <TextArea
              ref={expandedComposerInputRef}
              value={chatDraft}
              onChangeText={setChatDraft}
              onSelectionChange={(event) => setComposerSelection(event.nativeEvent.selection)}
              onBlur={persistComposerState}
              onKeyPress={(event) => {
                if (event.nativeEvent.key === 'Escape' && isThinking) {
                  stopThinking(route.params.conversationId);
                }
              }}
              selection={composerSelection}
              placeholder="输入消息，#能力，@文件，/命令"
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              textAlignVertical="top"
              containerClassName="m-4 flex-1 rounded-2xl"
              className="h-full min-h-0 flex-1 p-4 text-[16px] leading-6"
            />
            <View
              className="flex-row items-center justify-end border-t border-separator px-4 pt-3"
              style={{ paddingBottom: Math.max(insets.bottom, 12) }}
            >
              <Button variant="primary" onPress={() => setComposerExpanded(false)} className="min-w-28 rounded-xl">
                <StyledIonicons name="contract-outline" size={16} className="text-accent-foreground" />
                <Button.Label>完成</Button.Label>
              </Button>
            </View>
          </KeyboardAvoidingView>
        </Surface>
      </Modal>

      <AppSheet
        isOpen={menuVisible}
        onOpenChange={setMenuVisible}
        title={workspace.name}
        description={conversation.title || workspace.path}
        snapPoints={['70%', '95%']}
      >
        <View className="gap-5">
          {menuSection('工具', [
            { id: 'diff', label: 'Git Diff', icon: 'git-compare-outline', onPress: () => openGitDiff(conversation.id) },
            { id: 'git', label: 'Git 操作', icon: 'git-branch-outline', onPress: () => openGit(conversation.id) },
            { id: 'terminal', label: '终端', icon: 'terminal-outline', onPress: () => openTerminal(conversation.id) },
            { id: 'browser', label: '浏览器', icon: 'globe-outline', onPress: () => openBrowser(conversation.id) },
            { id: 'files', label: '文件', icon: 'folder-open-outline', onPress: () => openFiles(conversation.id) },
            { id: 'workbench', label: '工作台', icon: 'grid-outline', onPress: () => openWorkbench(conversation.id) },
            { id: 'usage', label: '使用统计', icon: 'stats-chart-outline', onPress: openUsage },
            { id: 'slash', label: 'Slash Commands', icon: 'code-slash-outline', onPress: () => navigation.navigate('SlashCommands', { workspaceId: workspace.id, conversationId: conversation.id }) },
            { id: 'capabilities', label: 'Skills 和 MCPs', icon: 'extension-puzzle-outline', onPress: () => navigation.navigate('Capabilities', route.params) },
            { id: 'settings', label: '设置', icon: 'settings-outline', onPress: () => navigation.navigate('Settings') },
          ])}
          {menuSection('Thread', [
            { id: 'detail', label: 'Thread Details', icon: 'information-circle-outline', onPress: () => runThreadMenuAction(conversation.id, 'detail') },
            { id: 'history', label: 'Thread History', icon: 'time-outline', onPress: () => runThreadMenuAction(conversation.id, 'history') },
            { id: 'turns', label: 'Thread Turns', icon: 'swap-vertical-outline', onPress: () => runThreadMenuAction(conversation.id, 'turns') },
            { id: 'items', label: 'Turn Items', icon: 'list-outline', onPress: () => runThreadMenuAction(conversation.id, 'items') },
            { id: 'loaded', label: 'Loaded Threads', icon: 'layers-outline', onPress: () => runThreadMenuAction(conversation.id, 'loaded') },
            { id: 'resume', label: 'Resume Thread', icon: 'play-outline', onPress: () => runThreadMenuAction(conversation.id, 'resume') },
            { id: 'fork', label: 'Fork Thread', icon: 'git-branch-outline', onPress: () => runThreadMenuAction(conversation.id, 'fork') },
            { id: 'compact', label: 'Compact Thread', icon: 'contract-outline', onPress: () => runThreadMenuAction(conversation.id, 'compact') },
            { id: 'rollback', label: 'Rollback 1 Turn', icon: 'arrow-undo-outline', onPress: () => runThreadMenuAction(conversation.id, 'rollback') },
            { id: 'metadata', label: 'Thread Metadata', icon: 'pricetag-outline', onPress: () => runThreadMenuAction(conversation.id, 'metadata') },
            { id: 'memory', label: 'Thread Memory', icon: 'bookmark-outline', onPress: () => runThreadMenuAction(conversation.id, 'memory') },
            { id: 'shell', label: 'Shell Command', icon: 'terminal-outline', onPress: () => runThreadMenuAction(conversation.id, 'shell') },
            { id: 'inject', label: 'Inject Items', icon: 'enter-outline', onPress: () => runThreadMenuAction(conversation.id, 'inject') },
            { id: 'clean', label: 'Clean Terminals', icon: 'sparkles-outline', onPress: () => runThreadMenuAction(conversation.id, 'clean') },
            { id: 'unarchive', label: 'Unarchive Thread', icon: 'archive-outline', onPress: () => runThreadMenuAction(conversation.id, 'unarchive') },
          ])}
          {menuSection('本地运行时', [
            { id: 'start', label: '启动', icon: 'play-circle-outline', onPress: () => runWorkspaceCommand(workspace, conversation, 'start') },
            { id: 'status', label: '状态', icon: 'pulse-outline', onPress: () => runWorkspaceCommand(workspace, conversation, 'status') },
            { id: 'attach', label: '附加', icon: 'link-outline', onPress: () => runWorkspaceCommand(workspace, conversation, 'attach') },
            { id: 'interrupt', label: '中断', icon: 'pause-circle-outline', onPress: () => runWorkspaceCommand(workspace, conversation, 'interrupt') },
            { id: 'stop', label: '停止', icon: 'stop-circle-outline', onPress: () => runWorkspaceCommand(workspace, conversation, 'stop') },
          ])}
          {menuSection('危险操作', [
            { id: 'archive', label: '归档 Thread', icon: 'archive-outline', destructive: true, onPress: () => runThreadMenuAction(conversation.id, 'archive') },
            { id: 'unsubscribe', label: '取消订阅 Thread', icon: 'notifications-off-outline', destructive: true, onPress: () => runThreadMenuAction(conversation.id, 'unsubscribe') },
            { id: 'remove-workspace', label: '移除工作区', icon: 'trash-outline', destructive: true, onPress: () => setRemoveWorkspaceVisible(true) },
          ])}
        </View>
      </AppSheet>

      <ConfirmDialog
        isOpen={removeWorkspaceVisible}
        onOpenChange={setRemoveWorkspaceVisible}
        title="移除工作区"
        description={`确定移除「${workspace.name}」及其所有本地对话记录？`}
        confirmLabel="移除"
        destructive
        onConfirm={() => {
          removeWorkspace(workspace.id);
          navigation.popToTop();
        }}
      />

      <ActionSheet
        isOpen={attachmentMenuVisible}
        onOpenChange={setAttachmentMenuVisible}
        title="添加附件"
        actions={[
          { id: 'clipboard', label: '从剪贴板粘贴', description: '粘贴已复制的图片', icon: 'clipboard-outline', onPress: () => void addClipboardAttachment() },
          { id: 'library', label: '从相册选择', description: '支持多选图片', icon: 'images-outline', onPress: () => void pickLibraryAttachments() },
          { id: 'file', label: '选择文件', description: '文本文件会作为上下文附加', icon: 'document-attach-outline', onPress: () => void pickFileAttachments() },
        ]}
      />

      <ActionSheet
        isOpen={pickerSheet !== null}
        onOpenChange={(open) => {
          if (!open) setPickerSheet(null);
        }}
        title={pickerSheetTitle}
        description={pickerSheetDescription}
        actions={pickerSheetActions}
      />
    </Screen>
  );
}

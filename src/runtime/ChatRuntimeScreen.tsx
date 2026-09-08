import { ConversationControls, type LiveConversationControl } from '../components/ConversationControls';
import { memo } from 'react';

import { DEFAULT_COMPOSER_SELECTION } from '../lib/appCore';
import type { ComposerAttachmentDraft, SelectedSkillAttachment } from '../lib/appCore';
import { ChatScreen, type ChatScreenProps } from '../screens/chat/ChatScreen';
import type { AppScreenProps } from '../navigation/routes';
import {
  useAppRuntime,
  useConnectionState,
  useExternalStoreValue,
  useKeyedStoreValue,
  useRouteSnapshot,
} from './appRuntime';
import { TabletWorkbenchContainer } from './TabletWorkbenchContainer';

const EMPTY_ATTACHMENTS = Object.freeze([]) as unknown as ComposerAttachmentDraft[];
const EMPTY_SKILLS = Object.freeze([]) as unknown as SelectedSkillAttachment[];

export type ChatRuntimeSnapshot = {
  settings: ChatScreenProps['settings'];
  workspaces: ChatScreenProps['workspaces'];
  conversations: ChatScreenProps['conversations'];
  selectedSkills: Readonly<Record<string, ChatScreenProps['selectedSkills']>>;
  lastError: ChatScreenProps['lastError'];
  v2Providers: ChatScreenProps['v2Providers'];
  providerModels: ChatScreenProps['providerModels'];
  providerCommands: ChatScreenProps['providerCommands'];
  providerCatalogStatus: ChatScreenProps['providerCatalogStatus'];
  capabilityCatalog: ChatScreenProps['capabilityCatalog'];
};

export type ChatRuntimeActions = Pick<
  ChatScreenProps,
  | 'persistChatDraft'
  | 'persistComposerAttachments'
  | 'persistSelectedSkills'
  | 'persistComposerSelection'
  | 'submitChat'
  | 'stopThinking'
  | 'sendApprovalResponse'
  | 'attachWorkspaceConversation'
  | 'loadNativeThreadHistory'
  | 'runThreadMenuAction'
  | 'sendSlashCommand'
  | 'openGitDiff'
  | 'openGit'
  | 'openTerminal'
  | 'openBrowser'
  | 'openFiles'
  | 'openWorkbench'
  | 'openUsage'
  | 'switchConversationAgent'
  | 'applyConversationModelSelection'
  | 'refreshProviderCatalog'
  | 'removeWorkspace'
  | 'openEmbeddedWorkbenchLink'
> & {
  controlConversation: (conversationId: string, control: LiveConversationControl) => Promise<boolean>;
  recoverConversation: (conversationId: string) => Promise<void>;
  retryUnknownDraft: (conversationId: string, id: string) => Promise<boolean>;
  removeQueuedDraft: (conversationId: string, id: string) => void;
  restoreQueuedDraft: (conversationId: string, id: string) => void;
  resumeQueuedDrafts: (conversationId: string) => void;
};

export const CHAT_ROUTE_SNAPSHOT = 'route:chat';
export const CHAT_ACTIONS = 'actions:chat';

export const ChatRouteScreen = memo(function ChatRouteScreen({ navigation, route }: AppScreenProps<'Chat'>) {
  const runtime = useAppRuntime();
  const snapshot = useRouteSnapshot<ChatRuntimeSnapshot>(CHAT_ROUTE_SNAPSHOT);
  const connectionState = useConnectionState();
  const conversationId = route.params.conversationId;
  const turnId = useKeyedStoreValue(runtime.turnIds, conversationId) ?? '';
  const isThinking = useKeyedStoreValue(runtime.thinkingConversations, conversationId) === true;
  const contextUsage = useKeyedStoreValue(runtime.contextUsage, conversationId);
  const pendingRequests = useExternalStoreValue(runtime.pendingRequests);
  const chatDraft = useKeyedStoreValue(runtime.chatDrafts, conversationId) ?? '';
  const composerAttachments = useKeyedStoreValue(runtime.composerAttachments, conversationId) ?? EMPTY_ATTACHMENTS;
  const composerSelection = useKeyedStoreValue(runtime.composerSelections, conversationId) ?? DEFAULT_COMPOSER_SELECTION;
  if (!snapshot) return null;

  const actions = runtime.actions.get<ChatRuntimeActions>(CHAT_ACTIONS);
  return (
    <ChatScreen
      navigation={navigation}
      route={route}
      settings={snapshot.settings}
      workspaces={snapshot.workspaces}
      conversations={snapshot.conversations}
      timelineStore={runtime.timelineStore}
      pendingRequests={pendingRequests}
      chatDraft={chatDraft}
      composerAttachments={composerAttachments}
      selectedSkills={snapshot.selectedSkills[conversationId] ?? EMPTY_SKILLS}
      composerSelection={composerSelection}
      isThinking={isThinking}
      turnId={turnId}
      lastError={snapshot.lastError}
      connectionState={connectionState}
      contextUsage={contextUsage}
      v2Providers={snapshot.v2Providers}
      providerModels={snapshot.providerModels}
      providerCommands={snapshot.providerCommands}
      providerCatalogStatus={snapshot.providerCatalogStatus}
      capabilityCatalog={snapshot.capabilityCatalog}
      composerControls={<ChatControls key={conversationId} conversationId={conversationId} providers={snapshot.v2Providers} />}
      renderTabletWorkbench={(workbenchProps) => (
        <TabletWorkbenchContainer
          visible={workbenchProps.visible}
          workspaceId={route.params.workspaceId}
          conversationId={conversationId}
          activeTab={workbenchProps.activeTab}
          onTabChange={workbenchProps.onTabChange}
          onClose={workbenchProps.onClose}
        />
      )}
      {...actions}
    />
  );
});

const ChatControls = memo(function ChatControls({ conversationId, providers }: { conversationId: string; providers: ChatRuntimeSnapshot['v2Providers'] }) {
  const runtime = useAppRuntime();
  const agentState = useKeyedStoreValue(runtime.agentStates, conversationId);
  const controlStatus = useKeyedStoreValue(runtime.controlStatuses, conversationId);
  const queue = useKeyedStoreValue(runtime.queuedChatDrafts, conversationId);
  const conversation = useKeyedStoreValue(runtime.conversations, conversationId);
  const isThinking = useKeyedStoreValue(runtime.thinkingConversations, conversationId) === true;
  const actions = runtime.actions.get<ChatRuntimeActions>(CHAT_ACTIONS);
  return <ConversationControls
        key={conversationId}
        running={isThinking}
        capabilities={providers.find(provider => provider.id === conversation?.provider)?.capabilities}
        state={agentState}
        controlStatus={controlStatus}
        localQueue={queue ?? []}
        nextModel={conversation?.model || ''}
        nextEffort={conversation?.reasoningEffort}
        onControl={(control) => actions.controlConversation(conversationId, control)}
        onRetryUnknown={(id) => actions.retryUnknownDraft(conversationId, id)}
        onRecover={() => actions.recoverConversation(conversationId)}
        onRemoveLocal={(id) => actions.removeQueuedDraft(conversationId, id)}
        onRestoreLocal={(id) => actions.restoreQueuedDraft(conversationId, id)}
        onResumeLocal={() => actions.resumeQueuedDrafts(conversationId)}
      />;
});

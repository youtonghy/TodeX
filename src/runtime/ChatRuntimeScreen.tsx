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
  | 'runWorkspaceCommand'
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
>;

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
      {...actions}
    />
  );
});

import { memo } from 'react';

import {
  ConversationListScreen,
  type ConversationListScreenProps,
} from '../screens/ConversationListScreen';
import type { AppScreenProps } from '../navigation/routes';
import {
  useAllKeyedStoreValues,
  useAppRuntime,
  useConnectionState,
  useRouteSnapshot,
} from './appRuntime';

export type ConversationRouteSnapshot = Pick<
  ConversationListScreenProps,
  'workspaces' | 'conversations' | 'activeConversationId' | 'v2Providers'
> & {
  threadListStatusByWorkspace: Readonly<Record<string, ConversationListScreenProps['threadListStatus']>>;
  threadListErrorByWorkspace: Readonly<Record<string, string>>;
};

export type ConversationRuntimeActions = Pick<
  ConversationListScreenProps,
  | 'createConversation'
  | 'refreshNativeThreads'
  | 'selectWorkspace'
  | 'selectConversation'
  | 'renameConversation'
  | 'forkConversation'
  | 'removeConversation'
>;

export const CONVERSATION_ROUTE_SNAPSHOT = 'route:conversations';
export const CONVERSATION_ACTIONS = 'actions:conversations';

export const ConversationsRouteScreen = memo(function ConversationsRouteScreen({ navigation, route }: AppScreenProps<'Conversations'>) {
  const runtime = useAppRuntime();
  const snapshot = useRouteSnapshot<ConversationRouteSnapshot>(CONVERSATION_ROUTE_SNAPSHOT);
  const activeTurns = useAllKeyedStoreValues(runtime.turnIds) as Record<string, string>;
  const connectionState = useConnectionState();
  if (!snapshot) return null;

  return (
    <ConversationListScreen
      navigation={navigation}
      route={route}
      workspaces={snapshot.workspaces}
      conversations={snapshot.conversations}
      activeConversationId={snapshot.activeConversationId}
      v2Providers={snapshot.v2Providers}
      threadListStatus={snapshot.threadListStatusByWorkspace[route.params.workspaceId] ?? 'idle'}
      threadListError={snapshot.threadListErrorByWorkspace[route.params.workspaceId] ?? ''}
      activeTurns={activeTurns}
      connectionState={connectionState}
      {...runtime.actions.get<ConversationRuntimeActions>(CONVERSATION_ACTIONS)}
    />
  );
});

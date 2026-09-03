import { memo } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { terminalIdForConversation } from '../lib/appCore';
import type { RootStackParamList } from '../navigation/routes';
import { GitDiffScreen } from '../screens/GitDiffScreen';
import { TerminalScreen } from '../screens/TerminalScreen';
import { useAppRuntime, useConnectionState, useKeyedStoreValue } from './appRuntime';

type OutputPanelProps = {
  workspaceId: string;
  conversationId: string;
};

export const TerminalRuntimePanel = memo(function TerminalRuntimePanel({ workspaceId, conversationId }: OutputPanelProps) {
  const runtime = useAppRuntime();
  const workspace = useKeyedStoreValue(runtime.workspaces, workspaceId);
  const conversation = useKeyedStoreValue(runtime.conversations, conversationId);
  const terminal = useKeyedStoreValue(runtime.terminals, terminalIdForConversation(conversationId));
  const connectionState = useConnectionState();
  const actions = runtime.outputActions;

  return (
    <TerminalScreen
      workspace={workspace}
      conversation={conversation?.workspaceId === workspaceId ? conversation : null}
      terminal={terminal}
      connectionState={connectionState}
      startTerminalSession={actions.startTerminalSession}
      stopTerminalSession={actions.stopTerminalSession}
      sendTerminalInput={actions.sendTerminalInput}
      resizeTerminalSession={actions.resizeTerminalSession}
      requestTerminalStatus={actions.requestTerminalStatus}
      clearTerminalOutput={actions.clearTerminalOutput}
    />
  );
});

export const GitDiffRuntimePanel = memo(function GitDiffRuntimePanel({ workspaceId, conversationId }: OutputPanelProps) {
  const runtime = useAppRuntime();
  const workspace = useKeyedStoreValue(runtime.workspaces, workspaceId);
  const conversation = useKeyedStoreValue(runtime.conversations, conversationId);
  const diffState = useKeyedStoreValue(runtime.gitDiffs, conversationId);

  return (
    <GitDiffScreen
      workspace={workspace}
      conversation={conversation?.workspaceId === workspaceId ? conversation : null}
      diffState={diffState}
      requestGitDiff={runtime.outputActions.requestGitDiff}
    />
  );
});

export const TerminalRouteScreen = memo(function TerminalRouteScreen({ route }: NativeStackScreenProps<RootStackParamList, 'Terminal'>) {
  return <TerminalRuntimePanel {...route.params} />;
});

export const GitDiffRouteScreen = memo(function GitDiffRouteScreen({ route }: NativeStackScreenProps<RootStackParamList, 'GitDiff'>) {
  return <GitDiffRuntimePanel {...route.params} />;
});

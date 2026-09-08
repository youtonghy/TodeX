import { memo, useCallback, useMemo } from 'react';

import { BrowserPreviewWebView } from '../components/BrowserPreviewWebView';
import { DEFAULT_WORKBENCH_STATE, apiClientForConnection } from '../lib/appCore';
import type { WorkbenchTab } from '../lib/workbench';
import { TerminalScreen } from '../screens/TerminalScreen';
import { TabletWorkbenchPanel } from '../screens/chat/TabletWorkbenchPanel';
import { captureBrowserElement, TOOL_ACTIONS, TOOL_ROUTE_SNAPSHOT, type ToolRouteSnapshot, type ToolRuntimeActions } from './ToolRuntimeScreens';
import { useAppRuntime, useConnectionState, useKeyedStoreValue, useRouteSnapshot } from './appRuntime';

export type TabletWorkbenchContainerProps = {
  visible?: boolean;
  workspaceId: string;
  conversationId: string;
  activeTab?: WorkbenchTab;
  onTabChange?: (tab: WorkbenchTab) => void;
  onClose?: () => void;
};

export const TabletWorkbenchContainer = memo(function TabletWorkbenchContainer({
  visible = true,
  workspaceId,
  conversationId,
  activeTab,
  onTabChange,
  onClose,
}: TabletWorkbenchContainerProps) {
  const runtime = useAppRuntime();
  const snapshot = useRouteSnapshot<ToolRouteSnapshot>(TOOL_ROUTE_SNAPSHOT);
  const workspace = useKeyedStoreValue(runtime.workspaces, workspaceId);
  const conversation = useKeyedStoreValue(runtime.conversations, conversationId);
  const gitDiffState = useKeyedStoreValue(runtime.gitDiffs, conversationId);
  const connectionState = useConnectionState();

  const actions = runtime.actions.get<ToolRuntimeActions>(TOOL_ACTIONS);
  const profile = actions.resolveBackendProfile(workspaceId, conversationId);

  const workbench = snapshot?.workbenchByConversation[conversationId] || DEFAULT_WORKBENCH_STATE;
  const currentTab = activeTab ?? workbench.activeTab;
  const backendUrl = profile?.serverUrl || snapshot?.settings.serverUrl || '';
  const client = useMemo(() => snapshot ? apiClientForConnection(snapshot.settings, profile) : undefined, [snapshot?.settings, profile]);

  const handleTabChange = useCallback((next: WorkbenchTab) => {
    actions.updateWorkbenchState(conversationId, { activeTab: next });
    onTabChange?.(next);
  }, [actions, conversationId, onTabChange]);

  const handleFileSelected = useCallback((path: string) => {
    actions.updateWorkbenchState(conversationId, { selectedFilePath: path });
  }, [actions, conversationId]);

  const handleBrowserResult = useCallback((result: { url: string; title: string }) => {
    actions.updateWorkbenchState(conversationId, /^https?:\/\//i.test(result.url) ? { browserUrl: result.url, browserFilePath: '' } : { browserUrl: '', browserFilePath: result.url });
  }, [actions, conversationId]);

  if (!snapshot) return null;

  return (
    <TabletWorkbenchPanel
      key={`${workspaceId}:${conversationId}`}
      workspaceId={workspaceId}
      conversationId={conversationId}
      workspace={workspace}
      conversation={conversation?.workspaceId === workspaceId ? conversation : null}
      activeTab={currentTab}
      onTabChange={handleTabChange}
      onClose={onClose}
      filesClient={client}
      initialFilePath={workbench.selectedFilePath || undefined}
      onFileSelected={handleFileSelected}
      browserClient={client}
      browserUrl={workbench.browserUrl || backendUrl}
      browserFilePath={workbench.browserFilePath || undefined}
      onBrowserResult={handleBrowserResult}
      renderWebView={(result) => (
        <BrowserPreviewWebView
          result={result}
          backendUrl={backendUrl}
          onInspect={(element) => captureBrowserElement(actions, conversationId, element)}
        />
      )}
      visible={visible}
      renderTerminal={(terminalId, isVisible) => <WorkbenchTerminal workspaceId={workspaceId} conversationId={conversationId} terminalId={terminalId} visible={isVisible} />}
      connectionState={connectionState}
      startTerminalSession={runtime.outputActions.startTerminalSession}
      stopTerminalSession={runtime.outputActions.stopTerminalSession}
      sendTerminalInput={runtime.outputActions.sendTerminalInput}
      resizeTerminalSession={runtime.outputActions.resizeTerminalSession}
      requestTerminalStatus={runtime.outputActions.requestTerminalStatus}
      clearTerminalOutput={runtime.outputActions.clearTerminalOutput}
      gitDiffState={gitDiffState}
      requestGitDiff={runtime.outputActions.requestGitDiff}
    />
  );
});

const WorkbenchTerminal = memo(function WorkbenchTerminal({ workspaceId, conversationId, terminalId, visible }: { workspaceId: string; conversationId: string; terminalId: string; visible: boolean }) {
  const runtime = useAppRuntime();
  const workspace = useKeyedStoreValue(runtime.workspaces, workspaceId);
  const conversation = useKeyedStoreValue(runtime.conversations, conversationId);
  const terminal = useKeyedStoreValue(runtime.terminals, terminalId);
  const connectionState = useConnectionState();
  return <TerminalScreen {...runtime.outputActions} workspace={workspace} conversation={conversation} terminal={terminal} terminalId={terminalId} visible={visible} connectionState={connectionState} />;
});

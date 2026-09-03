import { memo } from 'react';

import { BrowserPreviewWebView } from '../components/BrowserPreviewWebView';
import {
  DEFAULT_WORKBENCH_STATE,
  apiClientForConnection,
  type GitRepositorySummary,
  type MobileWorkbenchState,
} from '../lib/appCore';
import type { BackendConnectionProfile, ConnectionSettings } from '../lib/todex';
import type { GitAction } from '../lib/v2';
import type { AppScreenProps } from '../navigation/routes';
import { BrowserScreen } from '../screens/BrowserScreen';
import { FilesScreen } from '../screens/FilesScreen';
import { GitScreen } from '../screens/GitScreen';
import { WorkbenchScreen } from '../screens/WorkbenchScreen';
import { GitDiffRuntimePanel, TerminalRuntimePanel } from './OutputRuntimeScreens';
import { useAppRuntime, useKeyedStoreValue, useRouteSnapshot } from './appRuntime';

export type ToolRouteSnapshot = {
  settings: ConnectionSettings;
  backendProfiles: readonly BackendConnectionProfile[];
  activeBackendConnectionId: string;
  workbenchByConversation: Readonly<Record<string, MobileWorkbenchState>>;
  gitRepositories: GitRepositorySummary[];
  gitRepositoryTarget: string;
  gitRepositoryStatus: 'idle' | 'loading' | 'ready' | 'error';
  gitRepositoryError: string;
  gitRepositoryOutput: string;
  gitRepositoryOutputTarget: string;
  gitRepositoryActionTarget: string;
};

export type ToolRuntimeActions = {
  resolveBackendProfile: (workspaceId?: string, conversationId?: string) => BackendConnectionProfile | null;
  updateWorkbenchState: (conversationId: string, patch: Partial<MobileWorkbenchState>) => void;
  setConversationChatDraft: (conversationId: string, value: string | ((current: string) => string)) => void;
  openGit: (conversationId: string) => void;
  requestGitRepositories: (workspacePath?: string, backendConnectionId?: string | null) => Promise<boolean>;
  runGitAction: (
    workspacePath: string,
    action: GitAction,
    message?: string,
    includeUnstaged?: boolean,
    backendConnectionId?: string | null,
  ) => Promise<boolean>;
};

export const TOOL_ROUTE_SNAPSHOT = 'route:tools';
export const TOOL_ACTIONS = 'actions:tools';

function useToolContext(workspaceId: string, conversationId: string) {
  const runtime = useAppRuntime();
  const snapshot = useRouteSnapshot<ToolRouteSnapshot>(TOOL_ROUTE_SNAPSHOT);
  const workspace = useKeyedStoreValue(runtime.workspaces, workspaceId);
  const conversation = useKeyedStoreValue(runtime.conversations, conversationId);
  const actions = runtime.actions.get<ToolRuntimeActions>(TOOL_ACTIONS);
  const profile = actions.resolveBackendProfile(workspaceId, conversationId);
  return { snapshot, workspace, conversation, actions, profile };
}

export const BrowserRouteScreen = memo(function BrowserRouteScreen(props: AppScreenProps<'Browser'>) {
  const { snapshot, actions, profile } = useToolContext(props.route.params.workspaceId, props.route.params.conversationId);
  if (!snapshot) return null;
  const backendUrl = profile?.serverUrl || snapshot.settings.serverUrl;
  return (
    <BrowserScreen
      client={apiClientForConnection(snapshot.settings, profile)}
      initialUrl={props.route.params.url || backendUrl}
      initialFilePath={props.route.params.filePath}
      renderWebView={(result) => (
        <BrowserPreviewWebView
          result={result}
          backendUrl={backendUrl}
          onInspect={(inspectedElement) => actions.updateWorkbenchState(
            props.route.params.conversationId,
            { inspectedElement },
          )}
        />
      )}
    />
  );
});

export const FilesRouteScreen = memo(function FilesRouteScreen(props: AppScreenProps<'Files'>) {
  const { snapshot, workspace, actions, profile } = useToolContext(props.route.params.workspaceId, props.route.params.conversationId);
  if (!snapshot) return null;
  return (
    <FilesScreen
      client={apiClientForConnection(snapshot.settings, profile)}
      rootPath={workspace?.path || snapshot.settings.defaultWorkspacePath}
      initialFilePath={props.route.params.filePath}
      onFileSelected={(path) => actions.updateWorkbenchState(props.route.params.conversationId, { browserFilePath: path })}
    />
  );
});

export const WorkbenchRouteScreen = memo(function WorkbenchRouteScreen(props: AppScreenProps<'Workbench'>) {
  const { snapshot, workspace, conversation, actions, profile } = useToolContext(
    props.route.params.workspaceId,
    props.route.params.conversationId,
  );
  if (!snapshot) return null;
  const conversationId = props.route.params.conversationId;
  const workbench = snapshot.workbenchByConversation[conversationId] || DEFAULT_WORKBENCH_STATE;
  const tab = props.route.params.tab || workbench.activeTab;
  const backendUrl = profile?.serverUrl || snapshot.settings.serverUrl;
  return (
    <WorkbenchScreen
      activeTab={tab}
      visibleTabs={workbench.tabs}
      onTabChange={(next) => actions.updateWorkbenchState(conversationId, { activeTab: next })}
      title={workspace?.name || '工作台'}
      subtitle={conversation?.title || workspace?.path}
      action={workbench.inspectedElement
        ? {
            label: '插入元素',
            icon: 'add-circle-outline',
            onPress: () => {
              const element = workbench.inspectedElement;
              if (!element) return;
              const description = [
                `[浏览器元素 ${element.tagName.toLowerCase() || 'element'}${element.selector ? ` ${element.selector}` : ''}]`,
                element.text,
              ].filter(Boolean).join(' ');
              actions.setConversationChatDraft(conversationId, (current) => (
                `${current}${current.trim() ? '\n' : ''}${description}`
              ));
              actions.updateWorkbenchState(conversationId, { inspectedElement: null });
              props.navigation.navigate('Chat', {
                workspaceId: props.route.params.workspaceId,
                conversationId,
              });
            },
          }
        : { label: 'Git', icon: 'git-branch-outline', onPress: () => actions.openGit(conversationId) }}
      renderTerminal={<TerminalRuntimePanel workspaceId={props.route.params.workspaceId} conversationId={conversationId} />}
      renderGitDiff={<GitDiffRuntimePanel workspaceId={props.route.params.workspaceId} conversationId={conversationId} />}
      renderBrowser={<BrowserScreen
        client={apiClientForConnection(snapshot.settings, profile)}
        initialUrl={workbench.browserUrl || backendUrl}
        initialFilePath={workbench.browserFilePath || undefined}
        onResult={(result) => actions.updateWorkbenchState(conversationId, { browserUrl: result.url })}
        renderWebView={(result) => (
          <BrowserPreviewWebView
            result={result}
            backendUrl={backendUrl}
            onInspect={(inspectedElement) => actions.updateWorkbenchState(conversationId, { inspectedElement })}
          />
        )}
      />}
      renderFiles={<FilesScreen
        client={apiClientForConnection(snapshot.settings, profile)}
        rootPath={workspace?.path || snapshot.settings.defaultWorkspacePath}
        initialFilePath={workbench.browserFilePath || undefined}
        onFileSelected={(path) => actions.updateWorkbenchState(conversationId, { browserFilePath: path })}
      />}
    />
  );
});

export const GitRouteScreen = memo(function GitRouteScreen(props: AppScreenProps<'Git'>) {
  const { snapshot, workspace, actions, profile } = useToolContext(props.route.params.workspaceId, props.route.params.conversationId);
  if (!snapshot) return null;
  const workspacePath = workspace?.path || snapshot.settings.defaultWorkspacePath;
  const target = `${profile?.id || snapshot.activeBackendConnectionId || 'default'}\n${workspacePath}`;
  const targetMatches = snapshot.gitRepositoryTarget === target;
  return (
    <GitScreen
      key={target}
      client={apiClientForConnection(snapshot.settings, profile)}
      workspacePath={workspacePath}
      repositories={targetMatches ? snapshot.gitRepositories : []}
      status={targetMatches ? snapshot.gitRepositoryStatus : 'loading'}
      error={targetMatches ? snapshot.gitRepositoryError : ''}
      output={targetMatches && snapshot.gitRepositoryOutputTarget === target ? snapshot.gitRepositoryOutput : ''}
      actionBusy={Boolean(snapshot.gitRepositoryActionTarget)}
      onRefresh={(path) => actions.requestGitRepositories(path, profile?.id)}
      onRun={(path, action, message, includeUnstaged) => (
        actions.runGitAction(path, action, message, includeUnstaged, profile?.id)
      )}
    />
  );
});

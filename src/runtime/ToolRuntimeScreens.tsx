import { memo, useMemo, useState } from 'react';
import { usePreventRemove, type NavigationAction } from '@react-navigation/native';

import { ConfirmDialog } from '../components/ui';
import { FileEditorScreen } from '../screens/FileEditorScreen';

import { BrowserPreviewWebView } from '../components/BrowserPreviewWebView';
import {
  DEFAULT_WORKBENCH_STATE,
  apiClientForConnection,
  profileSettings,
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
import { useAppRuntime, useConnectionState, useKeyedStoreValue, useRouteSnapshot } from './appRuntime';

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
  sendGitAgentPrompt: (conversationId: string, text: string) => Promise<boolean>;
  openWorktree: (conversationId: string, path: string) => void;
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

export function captureBrowserElement(actions: ToolRuntimeActions, conversationId: string, element: NonNullable<MobileWorkbenchState['inspectedElement']>) {
  actions.updateWorkbenchState(conversationId, { inspectedElement: element });
  const description = [
    `[浏览器元素 ${element.tagName.toLowerCase() || 'element'}${element.selector ? ` ${element.selector}` : ''}]`,
    element.text,
  ].filter(Boolean).join(' ');
  actions.setConversationChatDraft(conversationId, current => `${current}${current.trim() ? '\n' : ''}${description}`);
}

export const TOOL_ROUTE_SNAPSHOT = 'route:tools';
export const TOOL_ACTIONS = 'actions:tools';

function useToolContext(workspaceId: string, conversationId: string) {
  const runtime = useAppRuntime();
  const snapshot = useRouteSnapshot<ToolRouteSnapshot>(TOOL_ROUTE_SNAPSHOT);
  const workspace = useKeyedStoreValue(runtime.workspaces, workspaceId);
  const conversation = useKeyedStoreValue(runtime.conversations, conversationId);
  const actions = runtime.actions.get<ToolRuntimeActions>(TOOL_ACTIONS);
  const profile = actions.resolveBackendProfile(workspaceId, conversationId);
  const client = useMemo(() => snapshot ? apiClientForConnection(snapshot.settings, profile) : null, [snapshot?.settings, profile]);
  return { snapshot, workspace, conversation, actions, profile, client };
}

export const BrowserRouteScreen = memo(function BrowserRouteScreen(props: AppScreenProps<'Browser'>) {
  const { snapshot, actions, profile, client } = useToolContext(props.route.params.workspaceId, props.route.params.conversationId);
  if (!snapshot || !client) return null;
  const backendUrl = profile?.serverUrl || snapshot.settings.serverUrl;
  return (
    <BrowserScreen
      client={client}
      initialUrl={props.route.params.url || backendUrl}
      initialFilePath={props.route.params.filePath}
      renderWebView={(result) => (
        <BrowserPreviewWebView
          result={result}
          backendUrl={backendUrl}
          onInspect={(element) => captureBrowserElement(actions, props.route.params.conversationId, element)}
        />
      )}
    />
  );
});

export const FileEditorRouteScreen = memo(function FileEditorRouteScreen(props: AppScreenProps<'FileEditor'>) {
  const { client } = useToolContext(props.route.params.workspaceId, props.route.params.conversationId);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<NavigationAction | null>(null);
  usePreventRemove(dirty, ({ data }) => setPending(data.action));
  return <>
    {client ? <FileEditorScreen client={client} path={props.route.params.filePath} onDirtyChange={setDirty} /> : null}
    <ConfirmDialog isOpen={Boolean(pending)} onOpenChange={open => { if (!open) setPending(null); }} title="放弃未保存的修改？" description="返回后将丢失这次修改。" confirmLabel="放弃修改" cancelLabel="继续编辑" destructive onConfirm={() => { if (pending) props.navigation.dispatch(pending); }} />
  </>;
});

export const FilesRouteScreen = memo(function FilesRouteScreen(props: AppScreenProps<'Files'>) {
  const { snapshot, workspace, actions, client } = useToolContext(props.route.params.workspaceId, props.route.params.conversationId);
  if (!snapshot || !client) return null;
  return (
    <FilesScreen
      client={client}
      rootPath={workspace?.path || snapshot.settings.defaultWorkspacePath}
      initialFilePath={props.route.params.filePath}
      onFileSelected={(path) => { actions.updateWorkbenchState(props.route.params.conversationId, { selectedFilePath: path }); props.navigation.navigate('FileEditor', { ...props.route.params, filePath: path }); }}
    />
  );
});

export const WorkbenchRouteScreen = memo(function WorkbenchRouteScreen(props: AppScreenProps<'Workbench'>) {
  const { snapshot, workspace, conversation, actions, profile, client } = useToolContext(
    props.route.params.workspaceId,
    props.route.params.conversationId,
  );
  if (!snapshot || !client) return null;
  const conversationId = props.route.params.conversationId;
  const workbench = snapshot.workbenchByConversation[conversationId] || DEFAULT_WORKBENCH_STATE;
  const tab = props.route.params.tab || workbench.activeTab;
  const backendUrl = profile?.serverUrl || snapshot.settings.serverUrl;
  return (
    <WorkbenchScreen
      activeTab={tab}
      visibleTabs={workbench.tabs}
      onTabChange={(next) => {
        actions.updateWorkbenchState(conversationId, { activeTab: next });
        props.navigation.setParams({ tab: next });
      }}
      title={workspace?.name || '工作台'}
      subtitle={conversation?.title || workspace?.path}
      action={workbench.inspectedElement
        ? {
            label: '返回对话',
            icon: 'add-circle-outline',
            onPress: () => {
              const element = workbench.inspectedElement;
              if (!element) return;
              actions.updateWorkbenchState(conversationId, { inspectedElement: null });
              props.navigation.navigate('Chat', {
                workspaceId: props.route.params.workspaceId,
                conversationId,
              });
            },
          }
        : { label: 'Git', icon: 'git-branch-outline', onPress: () => actions.openGit(conversationId) }}
      renderTerminal={<TerminalRuntimePanel visible={tab === 'terminal'} workspaceId={props.route.params.workspaceId} conversationId={conversationId} />}
      renderGitDiff={<GitDiffRuntimePanel workspaceId={props.route.params.workspaceId} conversationId={conversationId} />}
      renderBrowser={<BrowserScreen
        client={client}
        initialUrl={workbench.browserUrl || backendUrl}
        initialFilePath={workbench.browserFilePath || undefined}
        onResult={(result) => actions.updateWorkbenchState(conversationId, /^https?:\/\//i.test(result.url) ? { browserUrl: result.url, browserFilePath: '' } : { browserUrl: '', browserFilePath: result.url })}
        renderWebView={(result) => (
          <BrowserPreviewWebView
            result={result}
            backendUrl={backendUrl}
            onInspect={(element) => captureBrowserElement(actions, conversationId, element)}
          />
        )}
      />}
      renderFiles={<FilesScreen
        client={client}
        rootPath={workspace?.path || snapshot.settings.defaultWorkspacePath}
        initialFilePath={workbench.selectedFilePath || undefined}
        onFileSelected={(path) => { actions.updateWorkbenchState(conversationId, { selectedFilePath: path }); props.navigation.navigate('FileEditor', { workspaceId: props.route.params.workspaceId, conversationId, filePath: path }); }}
      />}
    />
  );
});

export const GitRouteScreen = memo(function GitRouteScreen(props: AppScreenProps<'Git'>) {
  const runtime = useAppRuntime();
  const thinking = useKeyedStoreValue(runtime.thinkingConversations, props.route.params.conversationId);
  const connection = useConnectionState();
  const { snapshot, workspace, actions, profile, client } = useToolContext(props.route.params.workspaceId, props.route.params.conversationId);
  if (!snapshot || !client) return null;
  const workspacePath = workspace?.path || snapshot.settings.defaultWorkspacePath;
  const target = `${profile?.id || snapshot.activeBackendConnectionId || 'default'}\n${workspacePath}`;
  const targetMatches = snapshot.gitRepositoryTarget === target;
  return (
    <GitScreen
      key={target}
      settings={profile ? profileSettings(profile, snapshot.settings) : snapshot.settings}
      onSendAgentPrompt={(text) => actions.sendGitAgentPrompt(props.route.params.conversationId, text)}
      onOpenWorktree={(path) => actions.openWorktree(props.route.params.conversationId, path)}
      writingBlocked={thinking === true || connection !== 'open'}
      agentUnavailableReason={connection !== 'open' ? '请先连接后端' : thinking ? '请等待当前任务完成' : undefined}
      client={client}
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

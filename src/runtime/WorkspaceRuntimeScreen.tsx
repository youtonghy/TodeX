import { memo } from 'react';

import { WorkspaceListScreen, type WorkspaceListScreenProps } from '../screens/WorkspaceListScreen';
import type { AppScreenProps } from '../navigation/routes';
import { useAppRuntime, useConnectionState, useRouteSnapshot } from './appRuntime';

export type WorkspaceRouteSnapshot = Pick<
  WorkspaceListScreenProps,
  | 'workspaces'
  | 'conversations'
  | 'settings'
  | 'serverVersion'
  | 'v2Providers'
  | 'v2ConversationCount'
  | 'backendProfiles'
  | 'activeBackendConnectionId'
>;

export type WorkspaceRuntimeActions = Pick<
  WorkspaceListScreenProps,
  | 'createWorkspace'
  | 'selectWorkspace'
  | 'renameWorkspace'
  | 'forkWorkspace'
  | 'removeWorkspace'
  | 'openUsage'
  | 'openAbout'
  | 'openKanban'
  | 'openGit'
>;

export const WORKSPACE_ROUTE_SNAPSHOT = 'route:workspaces';
export const WORKSPACE_ACTIONS = 'actions:workspaces';

export const WorkspacesRouteScreen = memo(function WorkspacesRouteScreen({ navigation, route }: AppScreenProps<'Workspaces'>) {
  const runtime = useAppRuntime();
  const snapshot = useRouteSnapshot<WorkspaceRouteSnapshot>(WORKSPACE_ROUTE_SNAPSHOT);
  const connectionState = useConnectionState();
  if (!snapshot) return null;

  return (
    <WorkspaceListScreen
      navigation={navigation}
      route={route}
      {...snapshot}
      connectionState={connectionState}
      {...runtime.actions.get<WorkspaceRuntimeActions>(WORKSPACE_ACTIONS)}
    />
  );
});

import { memo, type ComponentProps } from 'react';

import { CapabilitiesScreen, type CapabilitiesScreenProps } from '../components/CapabilitiesScreen';
import type { CatalogState } from '../lib/capabilityCatalog';
import type {
  HooksCatalogState,
  McpInventoryState,
  MemorySettingsState,
  PermissionProfilesState,
  PluginsCatalogState,
} from '../lib/appCore';
import type { CodexModelCatalogItem, CodexMemorySettings, ConnectionSettings } from '../lib/todex';
import type { ProviderDescriptor, ProviderKind, SkillCatalogDescriptor } from '../lib/v2';
import type { AppScreenProps } from '../navigation/routes';
import { KanbanScreen, type KanbanConversation } from '../screens/KanbanScreen';
import { SlashCommandActionScreen } from '../screens/SlashCommandActionScreen';
import { SlashCommandsScreen } from '../screens/SlashCommandsScreen';
import { useAllKeyedStoreValues, useAppRuntime, useKeyedStoreValue, useRouteSnapshot } from './appRuntime';

type SlashCommandsProps = ComponentProps<typeof SlashCommandsScreen>;
type SlashCommandActionProps = ComponentProps<typeof SlashCommandActionScreen>;

export type CommandRouteSnapshot = {
  settings: ConnectionSettings;
  modelCatalog: CodexModelCatalogItem[];
  modelCatalogStatus: SlashCommandActionProps['modelCatalogStatus'];
  modelCatalogError: string;
  mcpInventoryByConversation: Readonly<Record<string, McpInventoryState>>;
  permissionProfilesByConversation: Readonly<Record<string, PermissionProfilesState>>;
  hooksCatalogByConversation: Readonly<Record<string, HooksCatalogState>>;
  pluginsCatalogByConversation: Readonly<Record<string, PluginsCatalogState>>;
  memorySettingsByConversation: Readonly<Record<string, MemorySettingsState>>;
};

export type CommandRuntimeActions = Pick<
  SlashCommandActionProps,
  | 'refreshModelCatalog'
  | 'applyWorkspaceModelSelection'
  | 'requestMcpInventory'
  | 'requestPermissionProfiles'
  | 'requestHooksCatalog'
  | 'requestPluginsCatalog'
  | 'requestMemorySettings'
  | 'updateMemorySettings'
  | 'resetMemories'
  | 'applyPermissionProfile'
  | 'toggleFastServiceTier'
  | 'applyPersonality'
  | 'submitFeedback'
  | 'selectConversation'
  | 'sendSlashCommand'
  | 'openGitDiff'
> & Pick<SlashCommandsProps, 'runThreadMenuAction'>;

export type CapabilitiesRouteSnapshot = Pick<
  CapabilitiesScreenProps,
  'providers' | 'catalogs'
> & {
  defaultWorkspacePath: string;
  serverWorkspaceRoot?: string;
  selectedSkills: Readonly<Record<string, NonNullable<CapabilitiesScreenProps['selectedSkills']>>>;
};

export type CapabilitiesRuntimeActions = {
  refreshCapabilityCatalog: (provider: ProviderKind) => void;
  toggleCatalogSkill: (conversationId: string, skill: SkillCatalogDescriptor, provider: ProviderKind) => void;
  callMcpTool: (conversationId: string, resourceId: string, toolName: string) => void;
};

export type KanbanRouteSnapshot = {
  conversations: readonly KanbanConversation[];
  canRefresh: boolean;
};

export type KanbanRuntimeActions = {
  selectConversation: (workspaceId: string, conversationId: string) => void;
  refresh: () => void;
};

export const COMMAND_ROUTE_SNAPSHOT = 'route:commands';
export const COMMAND_ACTIONS = 'actions:commands';
export const CAPABILITIES_ROUTE_SNAPSHOT = 'route:capabilities';
export const CAPABILITIES_ACTIONS = 'actions:capabilities';
export const KANBAN_ROUTE_SNAPSHOT = 'route:kanban';
export const KANBAN_ACTIONS = 'actions:kanban';

export const SlashCommandsRouteScreen = memo(function SlashCommandsRouteScreen(props: AppScreenProps<'SlashCommands'>) {
  const runtime = useAppRuntime();
  const snapshot = useRouteSnapshot<CommandRouteSnapshot>(COMMAND_ROUTE_SNAPSHOT);
  const workspace = useKeyedStoreValue(runtime.workspaces, props.route.params.workspaceId);
  const conversation = useKeyedStoreValue(runtime.conversations, props.route.params.conversationId);
  const actions = runtime.actions.get<CommandRuntimeActions>(COMMAND_ACTIONS);
  if (!snapshot) return null;
  return (
    <SlashCommandsScreen
      {...props}
      workspace={workspace}
      conversation={conversation?.workspaceId === props.route.params.workspaceId ? conversation : null}
      settings={snapshot.settings}
      modelCatalog={snapshot.modelCatalog}
      runThreadMenuAction={actions.runThreadMenuAction}
      sendSlashCommand={actions.sendSlashCommand}
      openGitDiff={actions.openGitDiff}
    />
  );
});

export const SlashCommandActionRouteScreen = memo(function SlashCommandActionRouteScreen(props: AppScreenProps<'SlashCommandAction'>) {
  const runtime = useAppRuntime();
  const snapshot = useRouteSnapshot<CommandRouteSnapshot>(COMMAND_ROUTE_SNAPSHOT);
  const workspace = useKeyedStoreValue(runtime.workspaces, props.route.params.workspaceId);
  const conversation = useKeyedStoreValue(runtime.conversations, props.route.params.conversationId);
  const conversations = useAllKeyedStoreValues(runtime.conversations);
  const actions = runtime.actions.get<CommandRuntimeActions>(COMMAND_ACTIONS);
  if (!snapshot) return null;
  const workspaceConversations = Object.values(conversations)
    .filter((item) => item.workspaceId === props.route.params.workspaceId);
  const conversationId = props.route.params.conversationId;
  return (
    <SlashCommandActionScreen
      {...props}
      workspace={workspace}
      conversation={conversation?.workspaceId === props.route.params.workspaceId ? conversation : null}
      settings={snapshot.settings}
      modelCatalog={snapshot.modelCatalog}
      modelCatalogStatus={snapshot.modelCatalogStatus}
      modelCatalogError={snapshot.modelCatalogError}
      mcpInventory={snapshot.mcpInventoryByConversation[conversationId] ?? null}
      permissionProfilesState={snapshot.permissionProfilesByConversation[conversationId] ?? null}
      hooksCatalog={snapshot.hooksCatalogByConversation[conversationId] ?? null}
      pluginsCatalog={snapshot.pluginsCatalogByConversation[conversationId] ?? null}
      memorySettingsState={snapshot.memorySettingsByConversation[conversationId] ?? null}
      workspaceConversations={workspaceConversations}
      {...actions}
    />
  );
});

export const CapabilitiesRouteScreen = memo(function CapabilitiesRouteScreen({ route }: AppScreenProps<'Capabilities'>) {
  const runtime = useAppRuntime();
  const snapshot = useRouteSnapshot<CapabilitiesRouteSnapshot>(CAPABILITIES_ROUTE_SNAPSHOT);
  const workspace = useKeyedStoreValue(runtime.workspaces, route.params.workspaceId);
  const conversation = useKeyedStoreValue(runtime.conversations, route.params.conversationId);
  const actions = runtime.actions.get<CapabilitiesRuntimeActions>(CAPABILITIES_ACTIONS);
  if (!snapshot) return null;
  const conversationId = route.params.conversationId;
  return (
    <CapabilitiesScreen
      workspacePath={workspace?.path ?? snapshot.serverWorkspaceRoot ?? snapshot.defaultWorkspacePath}
      providers={snapshot.providers}
      catalogs={snapshot.catalogs as Partial<Record<ProviderKind, CatalogState>>}
      onRefresh={actions.refreshCapabilityCatalog}
      conversationId={conversationId}
      selectedSkills={snapshot.selectedSkills[conversationId] ?? []}
      canInvoke={Boolean(conversation && (conversation.v2ConversationId || conversation.provider))}
      onToggleSkill={(skill, provider) => actions.toggleCatalogSkill(conversationId, skill, provider)}
      onCallMcp={(resourceId, toolName) => actions.callMcpTool(conversationId, resourceId, toolName)}
    />
  );
});

export const KanbanRouteScreen = memo(function KanbanRouteScreen({ navigation }: AppScreenProps<'Kanban'>) {
  const runtime = useAppRuntime();
  const snapshot = useRouteSnapshot<KanbanRouteSnapshot>(KANBAN_ROUTE_SNAPSHOT);
  const actions = runtime.actions.get<KanbanRuntimeActions>(KANBAN_ACTIONS);
  if (!snapshot) return null;
  return (
    <KanbanScreen
      conversations={snapshot.conversations}
      onOpenConversation={(item) => {
        actions.selectConversation(item.workspaceId, item.id);
        navigation.navigate('Chat', { workspaceId: item.workspaceId, conversationId: item.id });
      }}
      onRefresh={snapshot.canRefresh ? actions.refresh : undefined}
    />
  );
});

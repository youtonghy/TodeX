import { useCallback, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Chip, Surface, Switch, Text } from 'heroui-native';

import {
  FALLBACK_CODEX_MODELS,
  normalizeReasoningEffort,
  normalizeThreadId,
  type CodexMemorySettings,
  type CodexModelCatalogItem,
  type ConnectionSettings,
  type WorkspaceRecord,
} from '../lib/todex';
import {
  FEEDBACK_CATEGORIES,
  PERMISSION_PRESETS,
  PERSONALITY_OPTIONS,
  approvalsReviewerValue,
  canonicalSlashCommand,
  defaultReasoningForModel,
  fastServiceTierForModel,
  modelDisplayLabel,
  permissionPresetForProfile,
  permissionPresetSelected,
  permissionProfileLabel,
  personalityLabel,
  reasoningEffortLabel,
  reasoningOptionsForModel,
  serviceTierLabel,
  serviceTiersForModel,
  slashCommandDefinition,
  type ConversationRecord,
  type HooksCatalogState,
  type McpInventoryState,
  type MemorySettingsState,
  type PermissionProfilesState,
  type PluginsCatalogState,
  type RootStackParamList,
} from '../lib/appCore';
import { ReasoningEffortSelector } from '../components/modals';
import {
  FormField,
  FormTextArea,
  InlineNotice,
  ListRow,
  ListSection,
  LoadingState,
  PageHeader,
  Screen,
  ScreenScrollView,
  SectionHeader,
  StyledIonicons,
  useAppToast,
} from '../components/ui';

type ButtonVariant = NonNullable<ComponentProps<typeof Button>['variant']>;

function DetailCard({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <View className="gap-2">
      {title ? <SectionHeader title={title} /> : null}
      <Surface className="gap-3 rounded-3xl p-4">{children}</Surface>
    </View>
  );
}

function Hint({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <Text type="body-sm" color="muted" className={`leading-5 ${className}`}>
      {children}
    </Text>
  );
}

function ValueBlock({ label, value, hints }: { label: string; value: string; hints?: string[] }) {
  return (
    <View className="gap-0.5">
      <Text type="body-xs" weight="semibold" className="uppercase tracking-wide text-muted">
        {label}
      </Text>
      <Text type="h5" className="text-foreground">
        {value}
      </Text>
      {hints?.map((hint) => (
        <Text key={hint} type="body-xs" color="muted">
          {hint}
        </Text>
      ))}
    </View>
  );
}

function ActionGrid({ children }: { children: ReactNode }) {
  return <View className="flex-row flex-wrap gap-2">{children}</View>;
}

function Action({
  title,
  onPress,
  variant = 'secondary',
  disabled = false,
  icon,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  icon?: ComponentProps<typeof StyledIonicons>['name'];
}) {
  const iconClass = variant === 'primary' ? 'text-accent-foreground' : variant === 'danger' ? 'text-danger-foreground' : variant === 'danger-soft' ? 'text-danger' : 'text-foreground';
  return (
    <Button size="sm" variant={variant} isDisabled={disabled} onPress={onPress} className="h-10 rounded-full">
      {icon ? <StyledIonicons name={icon} size={14} className={iconClass} /> : null}
      <Button.Label>{title}</Button.Label>
    </Button>
  );
}

function ChoiceList({
  items,
}: {
  items: Array<{ id: string; title: string; description?: string; selected?: boolean; onPress?: () => void; trailing?: ReactNode }>;
}) {
  return (
    <ListSection variant="secondary">
      {items.map((item) => (
        <ListRow
          key={item.id}
          title={item.title}
          description={item.description}
          descriptionLines={3}
          onPress={item.onPress}
          suffix={
            item.trailing ?? (
              item.selected !== undefined ? (
                <StyledIonicons
                  name={item.selected ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  className={item.selected ? 'text-accent' : 'text-muted'}
                />
              ) : undefined
            )
          }
        />
      ))}
    </ListSection>
  );
}

export function SlashCommandActionScreen({
  navigation,
  route,
  workspace,
  conversation,
  settings,
  modelCatalog,
  modelCatalogStatus,
  modelCatalogError,
  mcpInventory,
  permissionProfilesState,
  hooksCatalog,
  pluginsCatalog,
  memorySettingsState,
  refreshModelCatalog,
  applyWorkspaceModelSelection,
  requestMcpInventory,
  requestPermissionProfiles,
  requestHooksCatalog,
  requestPluginsCatalog,
  requestMemorySettings,
  updateMemorySettings,
  resetMemories,
  applyPermissionProfile,
  toggleFastServiceTier,
  applyPersonality,
  submitFeedback,
  workspaceConversations,
  selectConversation,
  sendSlashCommand,
  openGitDiff,
}: NativeStackScreenProps<RootStackParamList, 'SlashCommandAction'> & {
  workspace: WorkspaceRecord | null;
  conversation: ConversationRecord | null;
  settings: ConnectionSettings;
  modelCatalog: CodexModelCatalogItem[];
  modelCatalogStatus: 'idle' | 'loading' | 'ready' | 'error';
  modelCatalogError: string;
  mcpInventory: McpInventoryState | null;
  permissionProfilesState: PermissionProfilesState | null;
  hooksCatalog: HooksCatalogState | null;
  pluginsCatalog: PluginsCatalogState | null;
  memorySettingsState: MemorySettingsState | null;
  refreshModelCatalog: () => boolean;
  applyWorkspaceModelSelection: (conversationId: string, model: string, reasoningEffort: string | null) => void;
  requestMcpInventory: (conversationId?: string, detail?: McpInventoryState['detail']) => Promise<boolean>;
  requestPermissionProfiles: (conversationId?: string) => Promise<boolean>;
  requestHooksCatalog: (conversationId?: string) => Promise<boolean>;
  requestPluginsCatalog: (conversationId?: string) => Promise<boolean>;
  requestMemorySettings: (conversationId?: string) => Promise<boolean>;
  updateMemorySettings: (conversationId: string, patch: Partial<CodexMemorySettings>) => Promise<boolean>;
  resetMemories: (conversationId: string) => Promise<boolean>;
  applyPermissionProfile: (conversationId: string, profileId: string, description?: string, approvalsReviewer?: string | null) => Promise<boolean>;
  toggleFastServiceTier: (conversationId: string) => boolean;
  applyPersonality: (conversationId: string, personality: string) => boolean;
  submitFeedback: (conversationId: string, classification: string, reason: string, includeLogs: boolean) => boolean;
  workspaceConversations: ConversationRecord[];
  selectConversation: (workspaceId: string, conversationId: string) => void;
  sendSlashCommand: (input: string, conversationId?: string) => void;
  openGitDiff: (conversationId: string) => void;
}) {
  const command = canonicalSlashCommand(route.params.command);
  const definition = slashCommandDefinition(command);
  const title = definition?.title ?? command.replace(/^\//, '');
  const description = definition?.description ?? '该命令不在当前 Codex 命令表中。';
  const toast = useAppToast();
  const [textValue, setTextValue] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState<string | null>(
    normalizeReasoningEffort(workspace?.reasoningEffort ?? settings.defaultReasoningEffort),
  );
  const [feedbackCategory, setFeedbackCategory] = useState<string>(FEEDBACK_CATEGORIES[0].id);
  const [feedbackIncludeLogs, setFeedbackIncludeLogs] = useState(false);
  const safeCatalog = modelCatalog.length ? modelCatalog : FALLBACK_CODEX_MODELS;
  const currentModel = workspace?.model || settings.defaultModel;
  const activeConversationId = conversation?.id ?? route.params.conversationId;

  useEffect(() => {
    setTextValue('');
    setReasoningEffort(normalizeReasoningEffort(workspace?.reasoningEffort ?? settings.defaultReasoningEffort));
  }, [command, settings.defaultReasoningEffort, workspace?.reasoningEffort]);

  useEffect(() => {
    if (!conversation) {
      return;
    }
    if (command === '/permissions') {
      void requestPermissionProfiles(conversation.id);
    }
    if (command === '/mcp' && !mcpInventory) {
      void requestMcpInventory(conversation.id, 'toolsAndAuthOnly');
    }
    if (command === '/hooks') {
      void requestHooksCatalog(conversation.id);
    }
    if (command === '/plugins') {
      void requestPluginsCatalog(conversation.id);
    }
    if (command === '/memories') {
      void requestMemorySettings(conversation.id);
    }
  }, [
    activeConversationId,
    command,
    mcpInventory,
    requestHooksCatalog,
    requestMcpInventory,
    requestMemorySettings,
    requestPermissionProfiles,
    requestPluginsCatalog,
  ]);

  const runSlash = useCallback((input: string) => {
    if (!conversation) {
      toast.warning('未选择对话', '请先回到一个 Codex 对话。');
      return;
    }
    sendSlashCommand(input, conversation.id);
  }, [conversation, sendSlashCommand]);

  const commandWithText = useCallback((base: string) => {
    const trimmed = textValue.trim();
    runSlash(trimmed ? `${base} ${trimmed}` : base);
  }, [runSlash, textValue]);

  const openDiff = useCallback(() => {
    if (!conversation) {
      toast.warning('未选择对话', '请先回到一个 Codex 对话。');
      return;
    }
    openGitDiff(conversation.id);
  }, [conversation, openGitDiff]);

  const renderModelControls = () => (
    <>
      <DetailCard title="当前模型">
        <ValueBlock
          label="Model"
          value={modelDisplayLabel(currentModel, safeCatalog)}
          hints={[
            `Reasoning: ${reasoningEffortLabel(workspace?.reasoningEffort ?? settings.defaultReasoningEffort)}`,
            `Service tier: ${serviceTierLabel(workspace?.serviceTier)}`,
          ]}
        />
        <ActionGrid>
          <Action title="刷新模型" icon="refresh-outline" onPress={() => refreshModelCatalog()} disabled={modelCatalogStatus === 'loading'} />
          <Action title="手动应用" icon="create-outline" onPress={() => commandWithText('/model')} />
          {serviceTiersForModel(currentModel, safeCatalog).map((tier) => (
            <Action
              key={tier.id}
              title={tier.name === 'fast' && serviceTierLabel(workspace?.serviceTier) === 'Fast' ? '关闭 Fast' : `/${tier.name}`}
              onPress={() => runSlash(`/${tier.name}`)}
            />
          ))}
        </ActionGrid>
        {modelCatalogError ? <InlineNotice status="danger" title="模型列表获取失败" description={modelCatalogError} /> : null}
        <FormField value={textValue} onChangeText={setTextValue} placeholder="gpt-5.5 high 或 --model gpt-5.5 --effort high" monospace />
      </DetailCard>
      <DetailCard title="模型列表">
        {modelCatalogStatus === 'loading' ? <LoadingState label="正在获取模型列表" className="py-4" /> : null}
        <ChoiceList
          items={safeCatalog.map((model) => ({
            id: model.model,
            title: model.displayName || model.model,
            description: model.description || model.model,
            selected: model.model === currentModel,
            trailing: (
              <View className="flex-row items-center gap-2">
                {model.isDefault ? (
                  <Chip size="sm" variant="soft">
                    <Chip.Label>default</Chip.Label>
                  </Chip>
                ) : null}
                <StyledIonicons
                  name={model.model === currentModel ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  className={model.model === currentModel ? 'text-accent' : 'text-muted'}
                />
              </View>
            ),
            onPress: () => {
              if (!conversation) {
                return;
              }
              applyWorkspaceModelSelection(conversation.id, model.model, model.defaultReasoningEffort ?? defaultReasoningForModel(model.model, safeCatalog));
            },
          }))}
        />
        <ReasoningEffortSelector
          label="思考强度"
          options={reasoningOptionsForModel(currentModel, safeCatalog)}
          value={reasoningEffort}
          defaultValue={defaultReasoningForModel(currentModel, safeCatalog)}
          onChange={(value) => {
            setReasoningEffort(value);
            if (conversation) {
              applyWorkspaceModelSelection(conversation.id, currentModel, value);
            }
          }}
        />
      </DetailCard>
    </>
  );

  const renderPermissionsControls = () => (
    <DetailCard title="当前权限">
      <ValueBlock
        label="Profile"
        value={permissionProfileLabel(workspace?.permissionProfile, approvalsReviewerValue(workspace, settings))}
        hints={[`${workspace?.approvalPolicy || settings.approvalPolicy} · ${approvalsReviewerValue(workspace, settings) || 'user'} · ${workspace?.sandboxMode || settings.sandboxMode}`]}
      />
      <ActionGrid>
        <Action title="刷新 Profiles" icon="refresh-outline" onPress={() => void requestPermissionProfiles(activeConversationId)} disabled={permissionProfilesState?.status === 'loading'} />
      </ActionGrid>
      <ChoiceList
        items={[
          ...PERMISSION_PRESETS.map((preset) => ({
            id: preset.id,
            title: preset.title,
            description: preset.description,
            selected: permissionPresetSelected(preset, workspace, settings),
            onPress: () => void applyPermissionProfile(activeConversationId, preset.profileId, preset.description, preset.approvalsReviewer),
          })),
          ...(permissionProfilesState?.profiles ?? [])
            .filter((profile) => !permissionPresetForProfile(profile.id))
            .map((profile) => ({
              id: `profile:${profile.id}`,
              title: profile.id,
              description: profile.description,
              selected: workspace?.permissionProfile === profile.id,
              onPress: () => void applyPermissionProfile(activeConversationId, profile.id, profile.description),
            })),
        ]}
      />
      {permissionProfilesState?.status === 'loading' ? <LoadingState label="正在读取权限 Profiles" className="py-2" /> : null}
      {permissionProfilesState?.status === 'error' ? <InlineNotice status="danger" title="读取失败" description={permissionProfilesState.error} /> : null}
    </DetailCard>
  );

  const renderThreadControls = () => {
    if (command === '/rename') {
      return (
        <DetailCard>
          <FormField label="新名称" value={textValue} onChangeText={setTextValue} placeholder={conversation?.title || 'New thread name'} />
          <Action title="重命名" variant="primary" icon="create-outline" onPress={() => commandWithText('/rename')} />
        </DetailCard>
      );
    }
    if (command === '/goal') {
      return (
        <DetailCard title="当前目标">
          <ValueBlock label="Objective" value={conversation?.goalObjective || 'none'} hints={[conversation?.goalStatus || 'unknown']} />
          <FormTextArea value={textValue} onChangeText={setTextValue} placeholder="Objective" minHeightClassName="min-h-24" />
          <ActionGrid>
            <Action title="设置目标" variant="primary" icon="flag-outline" onPress={() => commandWithText('/goal set')} />
            <Action title="查看" onPress={() => runSlash('/goal get')} />
            <Action title="暂停" onPress={() => runSlash('/goal pause')} />
            <Action title="继续" onPress={() => runSlash('/goal resume')} />
            <Action title="清除" variant="danger-soft" onPress={() => runSlash('/goal clear')} />
          </ActionGrid>
        </DetailCard>
      );
    }
    if (command === '/resume') {
      return (
        <DetailCard>
          <Hint>Codex 支持按会话 id/name resume；当前移动端协议已实现当前 thread resume 和 loaded thread 查询。</Hint>
          <ActionGrid>
            <Action title="恢复当前 thread" variant="primary" icon="play-outline" onPress={() => runSlash('/resume')} />
            <Action title="查看 loaded threads" onPress={() => runSlash('/status loaded')} />
          </ActionGrid>
        </DetailCard>
      );
    }
    if (command === '/archive') {
      return (
        <DetailCard>
          <Hint>Archive the current mobile conversation and its native Codex thread when available.</Hint>
          <Action title="Archive Thread" variant="danger" icon="archive-outline" onPress={() => runSlash('/archive')} />
        </DetailCard>
      );
    }
    if (command === '/fork' || command === '/side') {
      return (
        <DetailCard>
          <Hint>{command === '/side' ? '创建临时 side conversation。' : 'Fork 当前 Codex thread。'}</Hint>
          <Action title={command === '/side' ? '创建 Side' : 'Fork Thread'} variant="primary" icon="git-branch-outline" onPress={() => runSlash(command)} />
        </DetailCard>
      );
    }
    return null;
  };

  const renderCatalogControls = () => {
    if (command === '/skills') {
      return (
        <DetailCard>
          <Hint>打开 Skill 选择器，选择后会作为下一条消息的上下文注入。</Hint>
          <ActionGrid>
            <Action title="打开 Skills" variant="primary" icon="flash-outline" onPress={() => runSlash('/skills')} />
            <Action title="刷新 Skills" icon="refresh-outline" onPress={() => runSlash('/skills reload')} />
          </ActionGrid>
        </DetailCard>
      );
    }
    if (command === '/mcp') {
      return (
        <DetailCard title="MCP Servers">
          <ActionGrid>
            <Action title="刷新状态" variant="primary" icon="refresh-outline" onPress={() => void requestMcpInventory(activeConversationId, 'toolsAndAuthOnly')} disabled={mcpInventory?.status === 'loading'} />
            <Action title="Verbose" onPress={() => void requestMcpInventory(activeConversationId, 'full')} disabled={mcpInventory?.status === 'loading'} />
          </ActionGrid>
          {mcpInventory?.status === 'loading' ? <LoadingState label="正在读取 MCP 状态" className="py-2" /> : null}
          {mcpInventory?.status === 'error' ? <InlineNotice status="danger" title="读取失败" description={mcpInventory.error} /> : null}
          {mcpInventory?.status === 'ready' && mcpInventory.servers.length === 0 ? <Hint>No MCP servers returned.</Hint> : null}
          {mcpInventory?.servers.length ? (
            <ChoiceList
              items={mcpInventory.servers.map((server) => ({
                id: server.name,
                title: server.title || server.name,
                description: `${server.name} · auth ${server.authStatus} · ${server.tools.length} tools · ${server.resources.length} resources${server.tools.length ? `\n${server.tools.slice(0, 8).join(', ')}` : ''}`,
                trailing: (
                  <Chip size="sm" variant="soft" color={server.authStatus === 'authenticated' || server.authStatus === 'ok' ? 'success' : 'default'}>
                    <Chip.Label>{server.authStatus}</Chip.Label>
                  </Chip>
                ),
              }))}
            />
          ) : null}
        </DetailCard>
      );
    }
    if (command === '/hooks') {
      const status = hooksCatalog?.status ?? 'idle';
      const entries = hooksCatalog?.entries ?? [];
      const hookCount = entries.reduce((total, entry) => total + entry.hooks.length, 0);
      return (
        <DetailCard title="Hooks">
          <ActionGrid>
            <Action title="刷新 Hooks" variant="primary" icon="refresh-outline" onPress={() => void requestHooksCatalog(activeConversationId)} disabled={status === 'loading'} />
          </ActionGrid>
          {status === 'loading' ? <LoadingState label="正在读取 Hooks" className="py-2" /> : null}
          {status === 'error' ? <InlineNotice status="danger" title="读取失败" description={hooksCatalog?.error || 'hooks/list 请求失败'} /> : null}
          {status === 'ready' && hookCount === 0 ? <Hint>No hooks returned for this workspace.</Hint> : null}
          {entries.map((entry) => (
            <View key={entry.cwd} className="gap-2">
              <Text type="body-xs" weight="semibold" className="font-mono text-muted" numberOfLines={1}>
                {entry.cwd}
              </Text>
              {entry.warnings.map((warning, index) => (
                <InlineNotice key={`warning-${index}`} status="warning" title={warning} />
              ))}
              {entry.errors.map((error, index) => (
                <InlineNotice key={`error-${index}`} status="danger" title={error} />
              ))}
              {entry.hooks.length ? (
                <ChoiceList
                  items={entry.hooks.map((hook) => ({
                    id: hook.key,
                    title: hook.eventName || hook.key,
                    description: [
                      `${hook.handlerType || 'handler'} · ${hook.enabled ? 'enabled' : 'disabled'} · ${hook.trustStatus || 'trust unknown'}`,
                      hook.command,
                      hook.sourcePath,
                    ].filter(Boolean).join('\n'),
                    trailing: (
                      <Chip size="sm" variant="soft" color={hook.enabled ? 'success' : 'default'}>
                        <Chip.Label>{hook.enabled ? 'enabled' : 'disabled'}</Chip.Label>
                      </Chip>
                    ),
                  }))}
                />
              ) : null}
            </View>
          ))}
        </DetailCard>
      );
    }
    if (command === '/plugins') {
      const status = pluginsCatalog?.status ?? 'idle';
      const catalog = pluginsCatalog?.catalog ?? { marketplaces: [], marketplaceLoadErrors: [], featuredPluginIds: [] };
      const pluginCount = catalog.marketplaces.reduce((total, marketplace) => total + marketplace.plugins.length, 0);
      return (
        <DetailCard title="Plugins">
          <ActionGrid>
            <Action title="刷新 Plugins" variant="primary" icon="refresh-outline" onPress={() => void requestPluginsCatalog(activeConversationId)} disabled={status === 'loading'} />
          </ActionGrid>
          {status === 'loading' ? <LoadingState label="正在读取 Plugins" className="py-2" /> : null}
          {status === 'error' ? <InlineNotice status="danger" title="读取失败" description={pluginsCatalog?.error || 'plugin/list 请求失败'} /> : null}
          {catalog.marketplaceLoadErrors.map((error, index) => (
            <InlineNotice key={`marketplace-error-${index}`} status="warning" title={error} />
          ))}
          {status === 'ready' && pluginCount === 0 ? <Hint>No plugins returned.</Hint> : null}
          {catalog.marketplaces.map((marketplace) => (
            <View key={marketplace.name} className="gap-2">
              <SectionHeader title={marketplace.displayName || marketplace.name} description={marketplace.path || undefined} />
              <ChoiceList
                items={marketplace.plugins.map((plugin) => ({
                  id: plugin.id,
                  title: plugin.displayName || plugin.name,
                  description: [
                    `${plugin.category || 'plugin'} · ${plugin.enabled ? 'enabled' : 'disabled'} · ${plugin.installed ? 'installed' : plugin.availability || 'available'}`,
                    plugin.description,
                  ].filter(Boolean).join('\n'),
                  trailing: catalog.featuredPluginIds.includes(plugin.id) ? (
                    <StyledIonicons name="star" size={18} className="text-warning" />
                  ) : (
                    <View />
                  ),
                }))}
              />
            </View>
          ))}
        </DetailCard>
      );
    }
    if (command === '/apps') {
      return (
        <DetailCard>
          <ActionGrid>
            <Action title="读取列表" variant="primary" onPress={() => runSlash(command)} />
            <Action title="强制刷新" icon="refresh-outline" onPress={() => runSlash('/apps refresh')} />
          </ActionGrid>
        </DetailCard>
      );
    }
    return null;
  };

  const renderRuntimeControls = () => {
    if (command === '/status') {
      return (
        <DetailCard>
          <ActionGrid>
            <Action title="Session 状态" variant="primary" onPress={() => runSlash('/status')} />
            <Action title="Thread 详情" onPress={() => runSlash('/status thread')} />
            <Action title="历史" onPress={() => runSlash('/status history')} />
            <Action title="Turns" onPress={() => runSlash('/status turns')} />
            <Action title="Loaded" onPress={() => runSlash('/status loaded')} />
          </ActionGrid>
          <FormField label="Turn id" value={textValue} onChangeText={setTextValue} placeholder="turn_id for items" monospace />
          <Action title="读取 Turn Items" onPress={() => commandWithText('/status items')} />
        </DetailCard>
      );
    }
    if (command === '/ps' || command === '/stop') {
      return (
        <DetailCard>
          <ActionGrid>
            <Action title="列出后台任务" variant="primary" onPress={() => runSlash('/ps')} />
            <Action title="清理后台终端" onPress={() => runSlash('/ps clean')} />
            <Action title="停止本地会话" variant="danger-soft" onPress={() => runSlash('/stop')} />
          </ActionGrid>
        </DetailCard>
      );
    }
    if (command === '/approve') {
      return (
        <DetailCard>
          <ActionGrid>
            <Action title="批准当前请求" variant="primary" icon="checkmark" onPress={() => runSlash('/approve')} />
            <Action title="拒绝当前请求" variant="danger-soft" icon="close" onPress={() => runSlash('/approve deny')} />
            <Action title="Guardian override" onPress={() => runSlash('/approve guardian')} />
          </ActionGrid>
        </DetailCard>
      );
    }
    if (command === '/logout' || command === '/quit' || command === '/exit') {
      return (
        <DetailCard>
          <Action title={command === '/logout' ? '登出 Codex' : '停止本地会话'} variant="danger" onPress={() => runSlash(command)} />
        </DetailCard>
      );
    }
    return null;
  };

  const renderPromptControls = () => {
    if (command === '/review') {
      return (
        <DetailCard>
          <FormTextArea value={textValue} onChangeText={setTextValue} placeholder="自定义 review instructions，可留空检查未提交变更" />
          <Action title="开始 Review" variant="primary" icon="search-outline" onPress={() => commandWithText('/review')} />
        </DetailCard>
      );
    }
    if (command === '/plan') {
      return (
        <DetailCard>
          <FormTextArea value={textValue} onChangeText={setTextValue} placeholder="Plan topic" />
          <Action title="进入 Plan" variant="primary" icon="map-outline" onPress={() => commandWithText('/plan')} />
        </DetailCard>
      );
    }
    return null;
  };

  const renderSettingsControls = () => {
    if (command === '/fast') {
      const fastTier = fastServiceTierForModel(currentModel, safeCatalog);
      const fastEnabled = workspace?.serviceTier === fastTier.id || workspace?.serviceTier === 'fast';
      return (
        <DetailCard title="当前服务层级">
          <ValueBlock label="Service tier" value={serviceTierLabel(workspace?.serviceTier)} hints={[fastTier.description]} />
          <Action title={fastEnabled ? '关闭 Fast' : '开启 Fast'} variant="primary" icon="flash-outline" onPress={() => toggleFastServiceTier(activeConversationId)} />
        </DetailCard>
      );
    }
    if (command === '/memories') {
      const status = memorySettingsState?.status ?? 'idle';
      const memorySettings = memorySettingsState?.settings ?? {
        useMemories: false,
        generateMemories: false,
      };
      const saving = status === 'loading' || status === 'saving';
      return (
        <DetailCard title="Memory">
          <ListSection variant="secondary">
            <ListRow
              title="Use memories"
              description="Read saved memories when starting work."
              icon="book-outline"
              suffix={
                <Switch
                  isSelected={memorySettings.useMemories}
                  isDisabled={saving}
                  onSelectedChange={(value) => {
                    void updateMemorySettings(activeConversationId, { useMemories: value });
                  }}
                />
              }
            />
            <ListRow
              title="Generate memories"
              description="Allow Codex to update local memories for this thread."
              icon="create-outline"
              suffix={
                <Switch
                  isSelected={memorySettings.generateMemories}
                  isDisabled={saving}
                  onSelectedChange={(value) => {
                    void updateMemorySettings(activeConversationId, { generateMemories: value });
                  }}
                />
              }
            />
          </ListSection>
          <ActionGrid>
            <Action title="刷新" icon="refresh-outline" onPress={() => void requestMemorySettings(activeConversationId)} disabled={saving} />
            <Action title="Reset" variant="danger-soft" icon="trash-outline" onPress={() => void resetMemories(activeConversationId)} disabled={saving} />
          </ActionGrid>
          {saving ? <LoadingState label="正在同步 memory 设置" className="py-2" /> : null}
          {status === 'error' ? <InlineNotice status="danger" title="请求失败" description={memorySettingsState?.error || 'memory settings 请求失败'} /> : null}
        </DetailCard>
      );
    }
    if (command === '/experimental') {
      return (
        <DetailCard>
          <Action title="打开实验功能" variant="primary" icon="flask-outline" onPress={() => navigation.navigate('Experimental', { workspaceId: workspace?.id ?? route.params.workspaceId, conversationId: activeConversationId })} />
        </DetailCard>
      );
    }
    if (command === '/diff') {
      return (
        <DetailCard>
          <Action title="打开 Git Diff" variant="primary" icon="git-compare-outline" onPress={openDiff} />
        </DetailCard>
      );
    }
    return null;
  };

  const renderPersonalityControls = () => {
    if (command !== '/personality') {
      return null;
    }
    const current = (workspace?.personality || 'none').toLowerCase();
    return (
      <DetailCard title="当前沟通风格">
        <ValueBlock label="Personality" value={personalityLabel(current)} />
        <ChoiceList
          items={PERSONALITY_OPTIONS.map((option) => ({
            id: option.id,
            title: option.title,
            description: option.description,
            selected: current === option.id,
            onPress: () => applyPersonality(activeConversationId, option.id),
          }))}
        />
      </DetailCard>
    );
  };

  const renderFeedbackControls = () => {
    if (command !== '/feedback') {
      return null;
    }
    return (
      <DetailCard title="反馈">
        <ChoiceList
          items={FEEDBACK_CATEGORIES.map((category) => ({
            id: category.id,
            title: category.title,
            description: category.description,
            selected: feedbackCategory === category.id,
            onPress: () => setFeedbackCategory(category.id),
          }))}
        />
        <FormTextArea label="补充说明" value={textValue} onChangeText={setTextValue} placeholder="补充说明（可选）" minHeightClassName="min-h-24" />
        <ListSection variant="secondary">
          <ListRow
            title="附带日志"
            description="随反馈上传本地会话日志"
            icon="document-text-outline"
            suffix={<Switch isSelected={feedbackIncludeLogs} onSelectedChange={setFeedbackIncludeLogs} />}
          />
        </ListSection>
        <Action
          title="提交反馈"
          variant="primary"
          icon="send-outline"
          onPress={() => {
            if (submitFeedback(activeConversationId, feedbackCategory, textValue, feedbackIncludeLogs)) {
              setTextValue('');
              setFeedbackIncludeLogs(false);
              navigation.goBack();
            }
          }}
        />
      </DetailCard>
    );
  };

  const renderSubagentControls = () => {
    if (command !== '/subagents') {
      return null;
    }
    return (
      <DetailCard title="子代理 / Sub-agents">
        <Hint>本工作区的会话线程。点选可切换为当前会话。</Hint>
        <ActionGrid>
          <Action title="刷新线程" icon="refresh-outline" onPress={() => runSlash('/status loaded')} />
        </ActionGrid>
        {workspaceConversations.length === 0 ? <Hint>当前工作区还没有其它会话。</Hint> : null}
        {workspaceConversations.length ? (
          <ChoiceList
            items={workspaceConversations.map((item) => ({
              id: item.id,
              title: item.title || item.id,
              description: `${normalizeThreadId(item.threadId) ? `thread ${normalizeThreadId(item.threadId)}` : 'no native thread'} · ${item.localAdapterState || 'idle'}`,
              selected: item.id === activeConversationId,
              onPress: () => {
                if (workspace) {
                  selectConversation(workspace.id, item.id);
                  navigation.goBack();
                }
              },
            }))}
          />
        ) : null}
      </DetailCard>
    );
  };

  const body =
    command === '/model'
      ? renderModelControls()
      : command === '/permissions'
        ? renderPermissionsControls()
        : renderThreadControls() ??
          renderCatalogControls() ??
          renderRuntimeControls() ??
          renderPromptControls() ??
          renderSettingsControls() ??
          renderPersonalityControls() ??
          renderFeedbackControls() ??
          renderSubagentControls() ?? (
            <DetailCard>
              <Hint>该命令在 Codex TUI 中是本地 TUI/IDE 配置或实验命令；移动端没有等价安全协议时只记录识别结果，不会把它作为普通 prompt 发送。</Hint>
              <Action title="执行兼容动作" onPress={() => runSlash(command)} />
            </DetailCard>
          );

  return (
    <Screen>
      <ScreenScrollView>
        <PageHeader
          title={title}
          subtitle={description}
          trailing={
            <Chip size="sm" variant="soft" color="accent">
              <Chip.Label className="font-mono">{command}</Chip.Label>
            </Chip>
          }
        />
        {body}
      </ScreenScrollView>
    </Screen>
  );
}

import { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Chip } from 'heroui-native';

import type { CodexModelCatalogItem, ConnectionSettings, WorkspaceRecord } from '../lib/todex';
import {
  SLASH_COMMANDS,
  SLASH_COMMAND_CATEGORY_LABELS,
  SLASH_COMMAND_CATEGORY_ORDER,
  canonicalSlashCommand,
  serviceTierSlashCommandsForModel,
  slashCommandNeedsActionPage,
  type ConversationRecord,
  type RootStackParamList,
  type SlashCommandCategory,
  type ThreadMenuAction,
} from '../lib/appCore';
import {
  ListRow,
  ListSection,
  Screen,
  ScreenIntro,
  ScreenScrollView,
  SectionHeader,
  StyledIonicons,
  useAppToast,
} from '../components/ui';

const CATEGORY_ICONS: Record<SlashCommandCategory, { icon: React.ComponentProps<typeof StyledIonicons>['name']; className: string; color: string }> = {
  core: { icon: 'flash-outline', className: 'bg-accent/15', color: 'text-accent' },
  thread: { icon: 'git-branch-outline', className: 'bg-success/15', color: 'text-success' },
  context: { icon: 'layers-outline', className: 'bg-warning/15', color: 'text-warning' },
  runtime: { icon: 'pulse-outline', className: 'bg-default', color: 'text-foreground' },
  settings: { icon: 'settings-outline', className: 'bg-default', color: 'text-foreground' },
  debug: { icon: 'bug-outline', className: 'bg-danger/15', color: 'text-danger' },
};

export function SlashCommandsScreen({
  navigation,
  route,
  workspace,
  conversation,
  settings,
  modelCatalog,
  runThreadMenuAction,
  sendSlashCommand,
  openGitDiff,
}: NativeStackScreenProps<RootStackParamList, 'SlashCommands'> & {
  workspace: WorkspaceRecord | null;
  conversation: ConversationRecord | null;
  settings: ConnectionSettings;
  modelCatalog: CodexModelCatalogItem[];
  runThreadMenuAction: (conversationId: string, action: ThreadMenuAction) => void;
  sendSlashCommand: (input: string, conversationId?: string) => void;
  openGitDiff: (conversationId: string) => void;
}) {
  const toast = useAppToast();
  const runSlash = useCallback((command: string) => {
    if (!conversation) {
      toast.warning('未选择对话', '请先回到一个 Codex 对话。');
      return;
    }
    sendSlashCommand(command, conversation.id);
  }, [conversation, sendSlashCommand, toast]);

  const runThreadAction = useCallback((action: ThreadMenuAction) => {
    if (!conversation) {
      toast.warning('未选择对话', '请先回到一个 Codex 对话。');
      return;
    }
    runThreadMenuAction(conversation.id, action);
  }, [conversation, runThreadMenuAction, toast]);

  const openDiff = useCallback(() => {
    if (!conversation) {
      toast.warning('未选择对话', '请先回到一个 Codex 对话。');
      return;
    }
    openGitDiff(conversation.id);
  }, [conversation, openGitDiff, toast]);

  const openExperimental = useCallback(() => {
    navigation.navigate('Experimental', {
      workspaceId: workspace?.id ?? route.params.workspaceId,
      conversationId: conversation?.id ?? route.params.conversationId,
    });
  }, [conversation?.id, navigation, route.params.conversationId, route.params.workspaceId, workspace?.id]);

  const currentModel = workspace?.model || settings.defaultModel;
  const dynamicServiceTierCommands = useMemo(
    () => serviceTierSlashCommandsForModel(currentModel, modelCatalog),
    [currentModel, modelCatalog],
  );
  const dynamicServiceTierCommandNames = useMemo(
    () => new Set(dynamicServiceTierCommands.map((item) => canonicalSlashCommand(item.command))),
    [dynamicServiceTierCommands],
  );

  const openCommandAction = useCallback((command: string) => {
    if (!conversation) {
      toast.warning('未选择对话', '请先回到一个 Codex 对话。');
      return;
    }
    if (dynamicServiceTierCommandNames.has(canonicalSlashCommand(command))) {
      runSlash(command);
      return;
    }
    if (!slashCommandNeedsActionPage(command)) {
      runSlash(command);
      return;
    }
    navigation.navigate('SlashCommandAction', {
      workspaceId: workspace?.id ?? route.params.workspaceId,
      conversationId: conversation.id,
      command,
    });
  }, [conversation, dynamicServiceTierCommandNames, navigation, route.params.workspaceId, runSlash, toast, workspace?.id]);

  const slashCommandItems = useMemo(
    () => SLASH_COMMANDS.flatMap((item) => (item.command === '/model' ? [item, ...dynamicServiceTierCommands] : [item])),
    [dynamicServiceTierCommands],
  );

  const slashGroups = SLASH_COMMAND_CATEGORY_ORDER
    .map((category) => ({
      category,
      commands: slashCommandItems.filter((item) => item.category === category),
    }))
    .filter((group) => group.commands.length > 0);

  const quickActions: Array<{ title: string; onPress: () => void }> = [
    { title: 'Thread 详情', onPress: () => runSlash('/status thread') },
    { title: '历史', onPress: () => runSlash('/status history') },
    { title: 'Turns', onPress: () => runSlash('/status turns') },
    { title: 'Items', onPress: () => runThreadAction('items') },
    { title: 'Loaded', onPress: () => runSlash('/status loaded') },
    { title: 'Memory', onPress: () => runSlash('/memories') },
    { title: 'Metadata', onPress: () => runThreadAction('metadata') },
    { title: 'Shell', onPress: () => runThreadAction('shell') },
    { title: 'Inject', onPress: () => runThreadAction('inject') },
    { title: 'Rollback', onPress: () => runThreadAction('rollback') },
    { title: 'Compact', onPress: () => runSlash('/compact') },
    { title: 'Clean', onPress: () => runSlash('/ps clean') },
    { title: 'Diff', onPress: openDiff },
  ];

  return (
    <Screen>
      <ScreenScrollView>
        <ScreenIntro
          description={`${workspace?.name || '当前工作区'} · 点选命令直接执行或进入配置页`}
          trailing={
            <Chip size="sm" variant="soft">
              <Chip.Label>{slashCommandItems.length} commands</Chip.Label>
            </Chip>
          }
        />

        <View className="gap-2">
          <SectionHeader title="快捷操作" />
          <View className="flex-row flex-wrap gap-2">
            {quickActions.map((action) => (
              <Button key={action.title} size="sm" variant="secondary" onPress={action.onPress} className="h-9 rounded-full">
                <Button.Label>{action.title}</Button.Label>
              </Button>
            ))}
          </View>
        </View>

        {slashGroups.map((group) => {
          const meta = CATEGORY_ICONS[group.category];
          return (
            <View key={group.category} className="gap-2">
              <SectionHeader title={SLASH_COMMAND_CATEGORY_LABELS[group.category]} description={`${group.commands.length} 个`} />
              <ListSection>
                {group.commands.map((item) => (
                  <ListRow
                    key={item.command}
                    title={item.command}
                    description={item.description}
                    descriptionLines={2}
                    icon={meta.icon}
                    iconClassName={meta.className}
                    iconColorClassName={meta.color}
                    showChevron
                    onPress={() => {
                      if (item.command === '/diff') {
                        openDiff();
                        return;
                      }
                      if (item.command === '/experimental') {
                        openExperimental();
                        return;
                      }
                      if (item.command === '/settings') {
                        navigation.navigate('Settings');
                        return;
                      }
                      openCommandAction(item.command);
                    }}
                  />
                ))}
              </ListSection>
            </View>
          );
        })}
      </ScreenScrollView>
    </Screen>
  );
}

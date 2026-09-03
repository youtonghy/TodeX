import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Avatar, Button, Chip, Menu, Spinner, Text, useThemeColor } from 'heroui-native';
import { FAB } from 'heroui-native-pro';

import type { BackendConnectionProfile, ConnectionSettings, WorkspaceRecord } from '../lib/todex';
import type { ProviderDescriptor } from '../lib/v2';
import {
  fetchWorkspaceDirectorySnapshot,
  profileSettings,
  type ConversationRecord,
  type ServerVersion,
} from '../lib/appCore';
import type { RootStackParamList } from '../navigation/routes';
import { WorkspacePathPickerModal, PromptModal } from '../components/modals';
import {
  ActionSheet,
  AppSheet,
  ConfirmDialog,
  ConnectionChip,
  EmptyStateView,
  FormField,
  HeaderActions,
  HeaderIconButton,
  InlineNotice,
  ListRow,
  ListSection,
  PageHeader,
  PathField,
  Screen,
  ScreenScrollView,
  SectionHeader,
  StyledIonicons,
  useAppToast,
} from '../components/ui';

export type WorkspaceListScreenProps = NativeStackScreenProps<RootStackParamList, 'Workspaces'> & {
  workspaces: WorkspaceRecord[];
  conversations: ConversationRecord[];
  settings: ConnectionSettings;
  serverVersion: ServerVersion | null;
  v2Providers: ProviderDescriptor[];
  v2ConversationCount: number;
  connectionState: string;
  createWorkspace: (name: string, path: string, backendConnectionId?: string) => { workspace: WorkspaceRecord; conversation: ConversationRecord } | null;
  selectWorkspace: (workspaceId: string) => void;
  renameWorkspace: (workspaceId: string, name: string) => void;
  forkWorkspace: (workspaceId: string) => { workspace: WorkspaceRecord; conversation: ConversationRecord | null } | null;
  removeWorkspace: (workspaceId: string) => void;
  openUsage: () => void;
  openAbout: () => void;
  openKanban: () => void;
  openGit: (conversationId?: string) => void;
  backendProfiles: BackendConnectionProfile[];
  activeBackendConnectionId: string;
};

export function WorkspaceListScreen({
  navigation,
  workspaces,
  conversations,
  settings,
  serverVersion,
  v2Providers,
  v2ConversationCount,
  connectionState,
  createWorkspace,
  selectWorkspace,
  renameWorkspace,
  forkWorkspace,
  removeWorkspace,
  openUsage,
  openAbout,
  openKanban,
  openGit,
  backendProfiles,
  activeBackendConnectionId,
}: WorkspaceListScreenProps) {
  const toast = useAppToast();
  const accentForeground = useThemeColor('accent-foreground');
  const [createVisible, setCreateVisible] = useState(false);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('');
  const [workspacePathDraft, setWorkspacePathDraft] = useState('');
  const [createError, setCreateError] = useState('');
  const [pathPickerVisible, setPathPickerVisible] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [renamingWorkspace, setRenamingWorkspace] = useState<WorkspaceRecord | null>(null);
  const [actionWorkspace, setActionWorkspace] = useState<WorkspaceRecord | null>(null);
  const [deletingWorkspace, setDeletingWorkspace] = useState<WorkspaceRecord | null>(null);
  const [createBackendId, setCreateBackendId] = useState(activeBackendConnectionId);
  const availableProviderCount = v2Providers.filter((provider) => provider.available).length;

  const conversationCountByWorkspace = useMemo(() => {
    const counts = new Map<string, number>();
    conversations.forEach((conversation) => {
      counts.set(conversation.workspaceId, (counts.get(conversation.workspaceId) ?? 0) + 1);
    });
    return counts;
  }, [conversations]);

  const orderedWorkspaces = useMemo(() => {
    const latestConversationAt = new Map<string, number>();
    conversations.forEach((conversation) => {
      latestConversationAt.set(
        conversation.workspaceId,
        Math.max(latestConversationAt.get(conversation.workspaceId) ?? 0, conversation.updatedAt),
      );
    });
    return [...workspaces].sort((left, right) => {
      const leftActivity = Math.max(left.updatedAt, latestConversationAt.get(left.id) ?? 0);
      const rightActivity = Math.max(right.updatedAt, latestConversationAt.get(right.id) ?? 0);
      return rightActivity - leftActivity;
    });
  }, [conversations, workspaces]);

  useEffect(() => {
    if (!backendProfiles.some((profile) => profile.id === createBackendId)) {
      setCreateBackendId(activeBackendConnectionId);
    }
  }, [activeBackendConnectionId, backendProfiles, createBackendId]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <HeaderActions>
          <HeaderIconButton icon="grid-outline" label="看板" onPress={openKanban} />
          <Menu>
            <Menu.Trigger asChild>
              <Button isIconOnly size="sm" variant="ghost" accessibilityLabel="更多" className="h-9 w-9 rounded-full">
                <StyledIonicons name="ellipsis-horizontal" size={19} className="text-foreground" />
              </Button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Overlay />
              <Menu.Content presentation="popover" width={220} align="end">
                <Menu.Label>工作区工具</Menu.Label>
                <Menu.Item onPress={() => openGit()}>
                  <StyledIonicons name="git-branch-outline" size={18} className="text-foreground" />
                  <Menu.ItemTitle>Git 操作</Menu.ItemTitle>
                </Menu.Item>
                <Menu.Item onPress={openUsage}>
                  <StyledIonicons name="stats-chart-outline" size={18} className="text-foreground" />
                  <Menu.ItemTitle>使用统计</Menu.ItemTitle>
                </Menu.Item>
                <Menu.Item onPress={openAbout}>
                  <StyledIonicons name="information-circle-outline" size={18} className="text-foreground" />
                  <Menu.ItemTitle>关于</Menu.ItemTitle>
                </Menu.Item>
                <Menu.Item onPress={() => navigation.navigate('Settings')}>
                  <StyledIonicons name="settings-outline" size={18} className="text-foreground" />
                  <Menu.ItemTitle>设置</Menu.ItemTitle>
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        </HeaderActions>
      ),
    });
  }, [navigation, openAbout, openGit, openKanban, openUsage]);

  const openCreate = () => {
    setCreateError('');
    setCreateVisible(true);
  };

  const submit = () => {
    if (creatingWorkspace) {
      return;
    }
    const pathDraft = workspacePathDraft.trim();
    if (!pathDraft) {
      setCreateError('请输入要管理的目录路径。');
      return;
    }
    setCreateError('');
    setCreatingWorkspace(true);
    const selectedProfile = backendProfiles.find((profile) => profile.id === createBackendId);
    const directorySettings = selectedProfile ? profileSettings(selectedProfile, settings) : settings;
    void fetchWorkspaceDirectorySnapshot(directorySettings, pathDraft)
      .then((snapshot) => {
        const created = createWorkspace(workspaceNameDraft, snapshot.current, createBackendId || undefined);
        if (!created) {
          return;
        }
        setWorkspaceNameDraft('');
        setWorkspacePathDraft('');
        setCreateVisible(false);
        toast.success('工作区已创建', created.workspace.name);
        navigation.navigate('Conversations', { workspaceId: created.workspace.id });
      })
      .catch((error) => {
        setCreateError(error instanceof Error ? error.message : '后端拒绝使用该目录。');
      })
      .finally(() => {
        setCreatingWorkspace(false);
      });
  };

  const openWorkspace = (workspace: WorkspaceRecord) => {
    selectWorkspace(workspace.id);
    navigation.navigate('Conversations', { workspaceId: workspace.id });
  };

  return (
    <Screen>
      <ScreenScrollView contentContainerClassName="pb-32">
        <PageHeader
          title="TodeX"
          subtitle={`移动端工作区 · ${availableProviderCount}/${v2Providers.length} provider 可用 · ${v2ConversationCount} 个远端会话`}
          trailing={<ConnectionChip state={connectionState} />}
        />

        {orderedWorkspaces.length === 0 ? (
          <EmptyStateView
            icon="folder-open-outline"
            title="还没有工作区"
            description="添加一个后端可访问的目录，开始与 Agent 协作。"
            actionLabel="新建工作区"
            onAction={openCreate}
          />
        ) : (
          <View className="gap-2">
            <SectionHeader title="工作区" description={`${orderedWorkspaces.length} 个`} />
            <ListSection>
              {orderedWorkspaces.map((workspace) => {
                const count = conversationCountByWorkspace.get(workspace.id) ?? 0;
                return (
                  <ListRow
                    key={workspace.id}
                    title={workspace.name}
                    description={workspace.path}
                    prefix={
                      <Avatar size="md" color="accent" variant="soft">
                        <Avatar.Fallback>{workspace.name.slice(0, 1).toUpperCase() || 'W'}</Avatar.Fallback>
                      </Avatar>
                    }
                    suffix={
                      <View className="flex-row items-center gap-2">
                        <Chip size="sm" variant="soft">
                          <Chip.Label>{count} 对话</Chip.Label>
                        </Chip>
                        <StyledIonicons name="chevron-forward" size={16} className="text-muted" />
                      </View>
                    }
                    onPress={() => openWorkspace(workspace)}
                    onLongPress={() => setActionWorkspace(workspace)}
                    className="py-3.5"
                  />
                );
              })}
            </ListSection>
            <Text type="body-xs" color="muted" className="px-1">
              长按工作区可重命名、Fork 或删除。
            </Text>
          </View>
        )}
      </ScreenScrollView>

      <FAB className="absolute bottom-8 right-5">
        <FAB.Trigger accessibilityLabel="工作区操作">
          <StyledIonicons name="add" size={26} className="text-accent-foreground" />
        </FAB.Trigger>
        <FAB.Portal>
          <FAB.Overlay />
          <FAB.Content>
            <FAB.Item onPress={openCreate}>
              <StyledIonicons name="folder-open-outline" size={16} className="text-foreground" />
              <FAB.ItemLabel>新建工作区</FAB.ItemLabel>
            </FAB.Item>
            <FAB.Item onPress={() => openGit()}>
              <StyledIonicons name="git-branch-outline" size={16} className="text-foreground" />
              <FAB.ItemLabel>Git 操作</FAB.ItemLabel>
            </FAB.Item>
            <FAB.Item onPress={openKanban}>
              <StyledIonicons name="grid-outline" size={16} className="text-foreground" />
              <FAB.ItemLabel>看板</FAB.ItemLabel>
            </FAB.Item>
          </FAB.Content>
        </FAB.Portal>
      </FAB>

      <ActionSheet
        isOpen={Boolean(actionWorkspace)}
        onOpenChange={(open) => {
          if (!open) setActionWorkspace(null);
        }}
        title={actionWorkspace?.name}
        description={actionWorkspace?.path}
        actions={
          actionWorkspace
            ? [
                { id: 'rename', label: '重命名', icon: 'create-outline', onPress: () => setRenamingWorkspace(actionWorkspace) },
                {
                  id: 'fork',
                  label: 'Fork 工作区',
                  icon: 'git-branch-outline',
                  description: '复制工作区及其对话为新副本',
                  onPress: () => {
                    const forked = forkWorkspace(actionWorkspace.id);
                    if (forked) {
                      navigation.navigate('Conversations', { workspaceId: forked.workspace.id });
                    }
                  },
                },
                {
                  id: 'delete',
                  label: '删除工作区',
                  icon: 'trash-outline',
                  destructive: true,
                  onPress: () => setDeletingWorkspace(actionWorkspace),
                },
              ]
            : []
        }
      />

      <ConfirmDialog
        isOpen={Boolean(deletingWorkspace)}
        onOpenChange={(open) => {
          if (!open) setDeletingWorkspace(null);
        }}
        title="删除工作区"
        description={`确定删除「${deletingWorkspace?.name ?? ''}」及其所有本地对话记录？此操作不可撤销。`}
        confirmLabel="删除"
        destructive
        onConfirm={() => {
          if (deletingWorkspace) {
            removeWorkspace(deletingWorkspace.id);
            toast.info('工作区已删除', deletingWorkspace.name);
          }
        }}
      />

      <AppSheet
        isOpen={createVisible}
        onOpenChange={setCreateVisible}
        title="新建工作区"
        description="选择后端上可访问的目录作为 Agent 的工作根目录。"
        footer={
          <View className="flex-row gap-2">
            <Button
              variant="secondary"
              onPress={() => setWorkspacePathDraft(settings.defaultWorkspacePath)}
              className="rounded-xl"
            >
              <Button.Label>填入默认路径</Button.Label>
            </Button>
            <Button variant="primary" isDisabled={creatingWorkspace} onPress={submit} className="flex-1 rounded-xl">
              {creatingWorkspace ? <Spinner size="sm" color={accentForeground} /> : null}
              <Button.Label>{creatingWorkspace ? '验证目录中' : '创建工作区'}</Button.Label>
            </Button>
          </View>
        }
      >
        <View className="gap-4">
          <FormField label="工作区名称" value={workspaceNameDraft} onChangeText={setWorkspaceNameDraft} placeholder="可选，默认使用目录名" />
          <PathField
            label="目录路径"
            value={workspacePathDraft}
            onChangeText={setWorkspacePathDraft}
            placeholder={settings.defaultWorkspacePath}
            onBrowse={() => setPathPickerVisible(true)}
          />
          {backendProfiles.length > 1 ? (
            <View className="gap-2">
              <SectionHeader title="绑定后端" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
                {backendProfiles.map((profile) => {
                  const selected = createBackendId === profile.id;
                  return (
                    <Chip
                      key={profile.id}
                      size="md"
                      variant={selected ? 'primary' : 'soft'}
                      color={selected ? 'accent' : 'default'}
                      onPress={() => setCreateBackendId(profile.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Chip.Label numberOfLines={1}>{profile.name}</Chip.Label>
                    </Chip>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
          {createError ? <InlineNotice status="danger" title="目录不可用" description={createError} /> : null}
        </View>
      </AppSheet>

      <WorkspacePathPickerModal
        visible={pathPickerVisible}
        title="选择工作区目录"
        settings={settings}
        rootHint={serverVersion?.workspace_root ?? ''}
        onSelect={(path) => {
          setWorkspacePathDraft(path);
          setPathPickerVisible(false);
        }}
        onCancel={() => setPathPickerVisible(false)}
      />

      <PromptModal
        visible={Boolean(renamingWorkspace)}
        title="重命名工作区"
        initialValue={renamingWorkspace?.name ?? ''}
        placeholder="新的工作区名称"
        onCancel={() => setRenamingWorkspace(null)}
        onSubmit={(value) => {
          if (renamingWorkspace) {
            renameWorkspace(renamingWorkspace.id, value);
          }
          setRenamingWorkspace(null);
        }}
      />
    </Screen>
  );
}

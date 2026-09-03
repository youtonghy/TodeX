import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, Platform, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import { Avatar, Button, Chip, SearchField, Surface, Text } from 'heroui-native';
import { Badge } from 'heroui-native-pro';

import type { WorkspaceRecord } from '../lib/todex';
import { providerDisplayName, type ProviderDescriptor, type ProviderKind } from '../lib/v2';
import {
  isConversationHighlighted,
  nowLabel,
  type ConnectionState,
  type ConversationRecord,
  type RootStackParamList,
} from '../lib/appCore';
import { ProviderIcon } from '../components/ProviderIcon';
import { PromptModal } from '../components/modals';
import {
  ActionSheet,
  AppSheet,
  ConfirmDialog,
  EmptyStateView,
  FormField,
  HeaderActions,
  HeaderIconButton,
  InlineNotice,
  ListRow,
  ListSection,
  LoadingState,
  Screen,
  SectionHeader,
  StyledIonicons,
} from '../components/ui';

export function ConversationListScreen({
  navigation,
  route,
  workspaces,
  conversations,
  activeConversationId,
  activeTurns,
  connectionState,
  threadListStatus,
  threadListError,
  createConversation,
  v2Providers,
  refreshNativeThreads,
  selectWorkspace,
  selectConversation,
  renameConversation,
  forkConversation,
  removeConversation,
}: NativeStackScreenProps<RootStackParamList, 'Conversations'> & {
  workspaces: WorkspaceRecord[];
  conversations: ConversationRecord[];
  activeConversationId: string;
  activeTurns: Record<string, string>;
  connectionState: ConnectionState;
  threadListStatus: 'idle' | 'loading' | 'ready' | 'error';
  threadListError: string;
  createConversation: (workspaceId: string, options?: {
    provider?: ProviderKind;
    providerProfile?: string;
    title?: string;
    onCreated?: (conversation: ConversationRecord) => void;
  }) => ConversationRecord | null;
  v2Providers: ProviderDescriptor[];
  refreshNativeThreads: (workspaceId: string, includeArchived?: boolean) => Promise<boolean>;
  selectWorkspace: (workspaceId: string) => void;
  selectConversation: (workspaceId: string, conversationId: string) => void;
  renameConversation: (conversationId: string, title: string) => void;
  forkConversation: (conversationId: string) => ConversationRecord | null;
  removeConversation: (conversationId: string) => void;
}) {
  const isFocused = useIsFocused();
  const [renamingConversation, setRenamingConversation] = useState<ConversationRecord | null>(null);
  const [actionConversation, setActionConversation] = useState<ConversationRecord | null>(null);
  const [archivingConversation, setArchivingConversation] = useState<ConversationRecord | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [createProvider, setCreateProvider] = useState<ProviderKind | ''>('');
  const [createProfile, setCreateProfile] = useState('');
  const [createTitle, setCreateTitle] = useState('');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const workspace = workspaces.find((item) => item.id === route.params.workspaceId) ?? null;
  const workspaceConversations = useMemo(
    () => conversations
      .filter((conversation) => conversation.workspaceId === route.params.workspaceId && conversation.archived !== true)
      .sort((left, right) => right.updatedAt - left.updatedAt),
    [conversations, route.params.workspaceId],
  );
  const visibleConversations = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return workspaceConversations;
    return workspaceConversations.filter((conversation) =>
      [conversation.title, conversation.preview, conversation.provider, conversation.model]
        .some((value) => value?.toLowerCase().includes(needle)),
    );
  }, [query, workspaceConversations]);
  const selectedProvider = v2Providers.find((item) => item.id === createProvider) ?? null;
  const needsProfile = Boolean(selectedProvider && (selectedProvider.id === 'acp' || selectedProvider.profiles.length > 1));
  const runningCount = workspaceConversations.filter((conversation) => Boolean(activeTurns[conversation.id])).length;

  const openCreateConversation = useCallback(() => {
    const firstAvailable = v2Providers.find((item) => item.available);
    setCreateProvider(firstAvailable?.id || '');
    setCreateProfile(firstAvailable?.profiles[0] || '');
    setCreateTitle('');
    setCreateVisible(true);
  }, [v2Providers]);

  useEffect(() => {
    selectWorkspace(route.params.workspaceId);
  }, [route.params.workspaceId, selectWorkspace]);

  useEffect(() => {
    if (!isFocused || !workspace || connectionState !== 'open') {
      return;
    }
    let cancelled = false;
    const sync = () => {
      if (!cancelled) {
        void refreshNativeThreads(workspace.id);
      }
    };
    sync();
    const timer = setInterval(sync, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connectionState, isFocused, refreshNativeThreads, workspace?.id, workspace?.path]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: workspace?.name ?? '对话',
      headerRight: () => (
        <HeaderActions>
          <HeaderIconButton icon="add" label="新建对话" tone="accent" onPress={openCreateConversation} />
        </HeaderActions>
      ),
    });
  }, [navigation, openCreateConversation, workspace?.name]);

  const conversationTitle = (conversation: ConversationRecord) => conversation.title || conversation.preview || 'Untitled thread';

  const refresh = async () => {
    if (!workspace) return;
    setRefreshing(true);
    try {
      await refreshNativeThreads(workspace.id);
    } finally {
      setRefreshing(false);
    }
  };

  if (!workspace) {
    return (
      <Screen>
        <EmptyStateView
          icon="alert-circle-outline"
          title="工作区不存在"
          description="请返回工作区列表重新选择。"
          actionLabel="返回"
          onAction={() => navigation.goBack()}
          className="flex-1 justify-center"
        />
      </Screen>
    );
  }

  const header = (
    <View className="gap-4 pb-3">
      <Surface variant="secondary" className="gap-3 rounded-2xl p-4">
        <View className="flex-row items-center gap-3">
          <Avatar size="lg" color="accent" variant="soft">
            <Avatar.Fallback>{workspace.name.slice(0, 1).toUpperCase() || 'W'}</Avatar.Fallback>
          </Avatar>
          <View className="min-w-0 flex-1">
            <Text type="h4" numberOfLines={1} className="text-foreground">
              {workspace.name}
            </Text>
            <Text type="body-xs" color="muted" numberOfLines={2} className="mt-0.5 font-mono">
              {workspace.path}
            </Text>
          </View>
        </View>
        <View className="flex-row flex-wrap items-center gap-2">
          <Chip size="sm" variant="soft">
            <Chip.Label>{workspaceConversations.length} 个 thread</Chip.Label>
          </Chip>
          {runningCount > 0 ? (
            <Chip size="sm" variant="soft" color="success">
              <Chip.Label>{runningCount} 个运行中</Chip.Label>
            </Chip>
          ) : null}
          {threadListStatus === 'loading' ? (
            <Chip size="sm" variant="soft" color="accent">
              <Chip.Label>正在同步原生 threads</Chip.Label>
            </Chip>
          ) : null}
        </View>
      </Surface>
      {threadListError ? <InlineNotice status="warning" title="同步 threads 失败" description={threadListError} /> : null}
      {workspaceConversations.length > 4 ? (
        <SearchField value={query} onChange={setQuery}>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="搜索对话" containerClassName="min-h-11" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
      ) : null}
      {visibleConversations.length > 0 ? <SectionHeader title="对话" description="长按可重命名、Fork 或归档" /> : null}
    </View>
  );

  return (
    <Screen>
      <FlatList
        data={visibleConversations}
        keyExtractor={(conversation) => conversation.id}
        contentContainerClassName="px-4 pb-12 pt-3"
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={40}
        windowSize={7}
        removeClippedSubviews={Platform.OS !== 'web'}
        extraData={[activeConversationId, activeTurns]}
        refreshing={refreshing}
        onRefresh={connectionState === 'open' ? () => void refresh() : undefined}
        ListHeaderComponent={header}
        ListEmptyComponent={
          threadListStatus === 'loading' && workspaceConversations.length === 0 ? (
            <LoadingState label="正在同步 Codex 原生 threads" />
          ) : (
            <EmptyStateView
              icon="chatbubbles-outline"
              title={query ? '没有匹配的对话' : '还没有对话'}
              description={query ? '换个关键词再试试。' : '创建一个会话，开始与 Agent 协作。'}
              actionLabel={query ? undefined : '新建对话'}
              onAction={query ? undefined : openCreateConversation}
            />
          )
        }
        renderItem={({ item: conversation, index }) => {
          const preview = conversationTitle(conversation);
          const running = Boolean(activeTurns[conversation.id]);
          const highlighted = isConversationHighlighted(conversation, activeConversationId, activeTurns);
          const statusLabel = running ? '运行中' : conversation.nativeStatus || '';
          const isFirst = index === 0;
          const isLast = index === visibleConversations.length - 1;
          return (
            <View
              className={`overflow-hidden ${isFirst ? 'rounded-t-2xl' : ''} ${isLast ? 'rounded-b-2xl' : ''} ${!isFirst ? 'border-t border-separator' : ''}`}
            >
              <ListSection variant={highlighted ? 'secondary' : 'default'} className="rounded-none">
                <ListRow
                  title={preview}
                  description={`${conversation.provider ? providerDisplayName(conversation.provider) : '历史 Codex'}${conversation.model ? ` · ${conversation.model}` : ''} · ${running ? '正在处理当前对话' : nowLabel(conversation.updatedAt)}`}
                  prefix={
                    <Badge.Anchor>
                      {conversation.provider ? (
                        <ProviderIcon provider={conversation.provider} size={18} />
                      ) : (
                        <Avatar size="md" variant="soft">
                          <Avatar.Fallback>{preview.slice(0, 1).toUpperCase()}</Avatar.Fallback>
                        </Avatar>
                      )}
                      {running ? <Badge color="success" size="sm" placement="bottom-right" /> : null}
                    </Badge.Anchor>
                  }
                  suffix={
                    <View className="flex-row items-center gap-2">
                      {statusLabel ? (
                        <Chip size="sm" variant="soft" color={running ? 'success' : 'default'}>
                          <Chip.Label>{statusLabel}</Chip.Label>
                        </Chip>
                      ) : null}
                      <StyledIonicons name="chevron-forward" size={16} className="text-muted" />
                    </View>
                  }
                  onPress={() => {
                    selectConversation(workspace.id, conversation.id);
                    navigation.navigate('Chat', { workspaceId: workspace.id, conversationId: conversation.id });
                  }}
                  onLongPress={() => setActionConversation(conversation)}
                  className="py-3.5"
                />
              </ListSection>
            </View>
          );
        }}
      />

      <ActionSheet
        isOpen={Boolean(actionConversation)}
        onOpenChange={(open) => {
          if (!open) setActionConversation(null);
        }}
        title={actionConversation ? conversationTitle(actionConversation) : undefined}
        description={actionConversation?.provider ? providerDisplayName(actionConversation.provider) : undefined}
        actions={
          actionConversation
            ? [
                {
                  id: 'rename',
                  label: '重命名',
                  icon: 'create-outline',
                  onPress: () => setRenamingConversation({ ...actionConversation, title: conversationTitle(actionConversation) }),
                },
                {
                  id: 'fork',
                  label: 'Fork 对话',
                  icon: 'git-branch-outline',
                  description: '以当前对话为起点创建新分支',
                  onPress: () => {
                    const forked = forkConversation(actionConversation.id);
                    if (forked) {
                      navigation.navigate('Chat', { workspaceId: workspace.id, conversationId: forked.id });
                    }
                  },
                },
                {
                  id: 'archive',
                  label: '归档对话',
                  icon: 'archive-outline',
                  destructive: true,
                  description: '移除本地记录，可从后端重新同步',
                  onPress: () => setArchivingConversation(actionConversation),
                },
              ]
            : []
        }
      />

      <ConfirmDialog
        isOpen={Boolean(archivingConversation)}
        onOpenChange={(open) => {
          if (!open) setArchivingConversation(null);
        }}
        title="归档对话"
        description={`确定删除「${archivingConversation ? conversationTitle(archivingConversation) : ''}」的本地记录？`}
        confirmLabel="归档"
        destructive
        onConfirm={() => {
          if (archivingConversation) {
            removeConversation(archivingConversation.id);
          }
        }}
      />

      <PromptModal
        visible={Boolean(renamingConversation)}
        title="重命名对话"
        initialValue={renamingConversation?.title ?? ''}
        placeholder="新的对话标题"
        onCancel={() => setRenamingConversation(null)}
        onSubmit={(value) => {
          if (renamingConversation) {
            renameConversation(renamingConversation.id, value);
          }
          setRenamingConversation(null);
        }}
      />

      <AppSheet
        isOpen={createVisible}
        onOpenChange={setCreateVisible}
        title="新建对话"
        description={`${workspace.name} · ${workspace.path}`}
        snapPoints={['72%', '94%']}
        footer={
          <View className="flex-row gap-2">
            <Button variant="secondary" onPress={() => setCreateVisible(false)} className="rounded-xl">
              <Button.Label>取消</Button.Label>
            </Button>
            <Button
              variant="primary"
              className="flex-1 rounded-xl"
              isDisabled={!selectedProvider?.available || (needsProfile && !createProfile)}
              onPress={() => {
                if (!selectedProvider?.available) return;
                createConversation(route.params.workspaceId, {
                  provider: selectedProvider.id,
                  providerProfile: needsProfile ? createProfile || undefined : selectedProvider.profiles[0],
                  title: createTitle.trim() || undefined,
                  onCreated: (created) => {
                    navigation.navigate('Chat', {
                      workspaceId: route.params.workspaceId,
                      conversationId: created.id,
                    });
                  },
                });
                setCreateVisible(false);
                setCreateTitle('');
              }}
            >
              <StyledIonicons name="sparkles-outline" size={16} className="text-accent-foreground" />
              <Button.Label>创建会话</Button.Label>
            </Button>
          </View>
        }
      >
        <View className="gap-4">
          <FormField label="会话标题" value={createTitle} onChangeText={setCreateTitle} placeholder="可选" />
          <View className="gap-2">
            <SectionHeader title="Provider" />
            <ListSection variant="secondary">
              {v2Providers.map((item) => {
                const selected = createProvider === item.id;
                return (
                  <ListRow
                    key={item.id}
                    title={providerDisplayName(item.id, item.displayName)}
                    description={item.available ? `${item.profiles.length} 个 profile` : '未登录或不可用'}
                    prefix={<ProviderIcon provider={item.id} size={16} />}
                    isDisabled={!item.available}
                    onPress={() => {
                      setCreateProvider(item.id);
                      setCreateProfile(item.profiles[0] ?? '');
                    }}
                    suffix={
                      <StyledIonicons
                        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                        size={22}
                        className={selected ? 'text-accent' : 'text-muted'}
                      />
                    }
                  />
                );
              })}
            </ListSection>
          </View>
          {needsProfile && selectedProvider ? (
            <View className="gap-2">
              <SectionHeader title="Profile" />
              <View className="flex-row flex-wrap gap-2">
                {selectedProvider.profiles.map((item) => {
                  const selected = createProfile === item;
                  return (
                    <Chip
                      key={item}
                      size="md"
                      variant={selected ? 'primary' : 'soft'}
                      color={selected ? 'accent' : 'default'}
                      onPress={() => setCreateProfile(item)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Chip.Label>{item}</Chip.Label>
                    </Chip>
                  );
                })}
              </View>
            </View>
          ) : null}
        </View>
      </AppSheet>
    </Screen>
  );
}

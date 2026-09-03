import { memo, useCallback, useEffect, useMemo } from 'react';
import { FlatList, Platform, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button, Chip, Surface, Text } from 'heroui-native';

import type { WorkspaceRecord } from '../lib/todex';
import type { ConversationRecord, GitDiffState } from '../lib/appCore';
import { buildGitDiffViewModel, type GitDiffLine, type GitDiffLineKind } from '../lib/outputModels';
import { EmptyStateView, InlineNotice, LoadingState, Screen, StyledIonicons, useAppToast } from '../components/ui';

function diffLineClassName(kind: GitDiffLineKind): string {
  if (kind === 'meta') return 'font-semibold text-muted';
  if (kind === 'hunk') return 'text-accent';
  if (kind === 'addition') return 'text-success';
  if (kind === 'deletion') return 'text-danger';
  return 'text-foreground';
}

const GitDiffLineRow = memo(function GitDiffLineRow({ line }: { line: GitDiffLine }) {
  return (
    <Text selectable type="code" className={`bg-transparent px-0 text-[12px] leading-[18px] ${diffLineClassName(line.kind)}`}>
      {line.text || ' '}
    </Text>
  );
});

function renderGitDiffLine({ item }: { item: GitDiffLine }) {
  return <GitDiffLineRow line={item} />;
}

function keyGitDiffLine(item: GitDiffLine): string {
  return String(item.index);
}

export type GitDiffScreenProps = {
  workspace: WorkspaceRecord | null;
  conversation: ConversationRecord | null;
  diffState: GitDiffState | null;
  requestGitDiff: (conversationId?: string) => Promise<boolean>;
};

export function GitDiffScreen({
  workspace,
  conversation,
  diffState,
  requestGitDiff,
}: GitDiffScreenProps) {
  const toast = useAppToast();
  const status = diffState?.status ?? 'idle';
  const diff = diffState?.diff ?? '';
  const canRefresh = Boolean(conversation);
  const refresh = useCallback(() => {
    if (!conversation) {
      toast.warning('未选择对话', '请先回到一个 Codex 对话。');
      return;
    }
    void requestGitDiff(conversation.id);
  }, [conversation, requestGitDiff, toast]);
  const copyDiff = useCallback(async () => {
    await Clipboard.setStringAsync(diff);
    toast.success('已复制', 'Git diff 已复制到剪贴板');
  }, [diff, toast]);

  useEffect(() => {
    if (conversation && (!diffState || diffState.status === 'idle')) {
      void requestGitDiff(conversation.id);
    }
  }, [conversation?.id, diffState?.status, requestGitDiff]);

  const diffView = useMemo(() => buildGitDiffViewModel(diff), [diff]);
  const { additions, deletions } = diffView;

  return (
    <Screen>
      <View className="flex-row items-center gap-3 px-4 pb-3 pt-3">
        <View className="min-w-0 flex-1">
          <Text type="h5" numberOfLines={1} className="text-foreground">
            {workspace?.name || 'Git Diff'}
          </Text>
          <Text type="body-xs" color="muted" numberOfLines={1} className="font-mono">
            {diffState?.sha ? `sha ${diffState.sha}` : workspace?.path || '当前工作区'}
          </Text>
        </View>
        {diff ? (
          <View className="flex-row gap-1">
            <Chip size="sm" variant="soft" color="success">
              <Chip.Label>+{additions}</Chip.Label>
            </Chip>
            <Chip size="sm" variant="soft" color="danger">
              <Chip.Label>-{deletions}</Chip.Label>
            </Chip>
          </View>
        ) : null}
        <Button isIconOnly size="sm" variant="secondary" accessibilityLabel="刷新" isDisabled={!canRefresh || status === 'loading'} onPress={refresh} className="h-9 w-9 rounded-full">
          <StyledIonicons name="refresh-outline" size={16} className="text-foreground" />
        </Button>
        <Button isIconOnly size="sm" variant="secondary" accessibilityLabel="复制" isDisabled={!diff} onPress={() => void copyDiff()} className="h-9 w-9 rounded-full">
          <StyledIonicons name="copy-outline" size={16} className="text-foreground" />
        </Button>
      </View>
      <Surface className="mx-4 mb-4 min-h-0 flex-1 overflow-hidden rounded-3xl">
        {status === 'loading' ? (
          <LoadingState label="正在读取 git diff" className="flex-1" />
        ) : status === 'error' ? (
          <View className="p-4">
            <InlineNotice status="danger" title="读取失败" description={diffState?.error || 'gitDiffToRemote 请求失败'} />
          </View>
        ) : diff ? (
          <FlatList
            data={diffView.lines}
            renderItem={renderGitDiffLine}
            keyExtractor={keyGitDiffLine}
            className="flex-1"
            contentContainerClassName="px-4 py-3"
            initialNumToRender={24}
            maxToRenderPerBatch={16}
            updateCellsBatchingPeriod={40}
            windowSize={9}
            removeClippedSubviews={Platform.OS === 'android'}
            ListFooterComponent={diffView.truncated ? (
              <View className="py-4">
                <InlineNotice
                  status="warning"
                  title="差异过大，已限制显示"
                  description={`显示 ${diffView.lines.length} / ${diffView.totalLines} 行；复制仍包含完整 diff。`}
                />
              </View>
            ) : null}
          />
        ) : (
          <EmptyStateView
            icon="git-compare-outline"
            title="没有可显示的差异"
            description="当前工作区相对远端没有返回 git diff。"
            className="flex-1 justify-center"
          />
        )}
      </Surface>
    </Screen>
  );
}

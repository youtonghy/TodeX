import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Platform, ScrollView, useWindowDimensions, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button, Text } from 'heroui-native';

import type { WorkspaceRecord } from '../lib/todex';
import type { ConversationRecord, GitDiffState } from '../lib/appCore';
import { buildGitDiffViewModel, type GitDiffLine, type GitDiffLineKind } from '../lib/outputModels';
import { EmptyStateView, InlineNotice, LoadingState, StyledIonicons, useAppToast } from '../components/ui';

function diffLineClassName(kind: GitDiffLineKind): string {
  if (kind === 'meta') return 'font-semibold text-muted';
  if (kind === 'hunk') return 'text-accent';
  if (kind === 'addition') return 'text-success';
  if (kind === 'deletion') return 'text-danger';
  return 'text-foreground';
}

const GitDiffLineRow = memo(function GitDiffLineRow({ line }: { line: GitDiffLine }) {
  return (
    <Text selectable style={{ alignSelf: 'stretch', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, lineHeight: 20 }} className={`rounded-none px-4 py-0.5 font-mono text-[13px] leading-5 ${line.kind === 'addition' ? 'bg-success/10' : line.kind === 'deletion' ? 'bg-danger/10' : line.kind === 'hunk' ? 'bg-accent/5' : 'bg-transparent'} ${diffLineClassName(line.kind)}`}>
      {line.text.replace(/\t/g, '    ') || ' '}
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
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const { fontScale } = useWindowDimensions();
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
  const contentWidth = useMemo(() => diffView.lines.reduce((width, line) => {
    // Reserve two cells for wide glyphs and expand tabs consistently with display.
    const cells = Array.from(line.text.replace(/\t/g, '    ')).reduce((count, char) => count + (char.codePointAt(0)! >= 0x1100 ? 2 : 1), 0);
    return Math.max(width, cells * 8 * fontScale + 32);
  }, viewport.width), [diffView, fontScale, viewport.width]);

  return (
    <View className="flex-1 bg-background">
      <View className="h-14 flex-row items-center gap-2 border-b border-separator px-3">
        <View className="min-w-0 flex-1">
          <Text type="body-sm" weight="semibold" numberOfLines={1}>{workspace?.name || 'Git Diff'}</Text>
          <Text type="body-xs" color="muted" numberOfLines={1}>{diffState?.sha ? diffState.sha.slice(0, 12) : '工作区变更'}</Text>
        </View>
        {diff ? <View className="flex-row gap-2">
          <Text type="body-xs" className="font-mono text-success">+{additions}</Text>
          <Text type="body-xs" className="font-mono text-danger">−{deletions}</Text>
        </View> : null}
        <Button isIconOnly size="sm" variant="ghost" accessibilityLabel="刷新差异" isDisabled={!canRefresh || status === 'loading'} onPress={refresh} className="h-11 w-11 rounded-full">
          <StyledIonicons name="refresh-outline" size={18} className="text-foreground" />
        </Button>
        <Button isIconOnly size="sm" variant="ghost" accessibilityLabel="复制差异" isDisabled={!diff} onPress={() => void copyDiff()} className="h-11 w-11 rounded-full">
          <StyledIonicons name="copy-outline" size={18} className="text-foreground" />
        </Button>
      </View>
      <View className="min-h-0 flex-1" onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        setViewport(current => current.width === width && current.height === height ? current : { width, height });
      }}>
        {status === 'loading' ? (
          <LoadingState label="正在读取 git diff" className="flex-1" />
        ) : status === 'error' ? (
          <View className="p-4">
            <InlineNotice status="danger" title="读取失败" description={diffState?.error || 'gitDiffToRemote 请求失败'} />
          </View>
        ) : diff ? (
          <ScrollView horizontal nestedScrollEnabled style={{ flex: 1 }} contentContainerStyle={{ width: contentWidth, height: viewport.height }} showsHorizontalScrollIndicator>
          <FlatList
            data={diffView.lines}
            renderItem={renderGitDiffLine}
            keyExtractor={keyGitDiffLine}
            nestedScrollEnabled
            style={{ width: contentWidth, height: viewport.height }}
            contentContainerClassName="py-2"
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
          </ScrollView>
        ) : (
          <EmptyStateView
            icon="git-compare-outline"
            title="没有可显示的差异"
            description="当前工作区相对远端没有返回 git diff。"
            className="flex-1 justify-center"
          />
        )}
      </View>
    </View>
  );
}

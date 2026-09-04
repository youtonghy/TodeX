import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, View } from 'react-native';
import { Chip, Surface, Text } from 'heroui-native';
import { Badge, Segment } from 'heroui-native-pro';

import { ProviderIcon, providerLabel } from '../components/ProviderIcon';
import type { ProviderKind } from '../lib/v2';
import { EmptyStateView, Screen, ScreenIntro, StyledIonicons } from '../components/ui';

export type KanbanConversation = {
  id: string;
  workspaceId: string;
  workspaceName?: string;
  title?: string;
  preview?: string;
  provider?: ProviderKind | string;
  model?: string;
  status?: string;
  nativeStatus?: string;
  archived?: boolean;
  updatedAt: number;
};

export type KanbanScreenProps = {
  conversations?: readonly KanbanConversation[];
  onOpenConversation?: (conversation: KanbanConversation) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  now?: number;
};

type BoardSection = {
  workspaceId: string;
  title: string;
  data: KanbanConversation[];
};

function dayStart(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function timeLabel(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '--';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function statusLabel(item: KanbanConversation): string {
  return item.status || item.nativeStatus || '就绪';
}

function statusColor(item: KanbanConversation): 'success' | 'warning' | 'default' | 'danger' {
  const status = statusLabel(item).toLowerCase();
  if (/running|active|busy/.test(status)) return 'success';
  if (/closed|archived/.test(status)) return 'default';
  if (/error|failed/.test(status)) return 'danger';
  if (/pending|waiting|approval/.test(status)) return 'warning';
  return 'default';
}

function BoardCard({ item, onPress }: { item: KanbanConversation; onPress?: () => void }) {
  const title = item.title?.trim() || item.preview?.trim() || '未命名对话';
  const preview = item.preview?.trim() && item.preview.trim() !== title ? item.preview.trim() : '暂无消息预览';
  const color = statusColor(item);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`打开对话 ${title}`}
      onPress={onPress}
      className="mx-4 mb-2 active:opacity-80"
    >
      <Surface className="gap-2.5 rounded-3xl p-4">
        <View className="flex-row items-start gap-3">
          <Badge.Anchor>
            <ProviderIcon provider={item.provider} size={17} />
            {color === 'success' ? <Badge color="success" size="sm" placement="bottom-right" /> : null}
          </Badge.Anchor>
          <View className="min-w-0 flex-1 gap-1">
            <View className="flex-row items-start justify-between gap-2">
              <Text type="body" weight="semibold" className="min-w-0 flex-1 text-foreground" numberOfLines={2}>
                {title}
              </Text>
              <Text type="body-xs" color="muted" className="font-mono">
                {timeLabel(item.updatedAt)}
              </Text>
            </View>
            <Text type="body-sm" color="muted" numberOfLines={2}>
              {preview}
            </Text>
          </View>
        </View>
        <View className="flex-row flex-wrap items-center gap-1.5 pl-[42px]">
          <Chip size="sm" variant="soft">
            <Chip.Label>{providerLabel(item.provider)}</Chip.Label>
          </Chip>
          {item.model ? (
            <Chip size="sm" variant="soft">
              <Chip.Label numberOfLines={1} className="max-w-[140px]">
                {item.model}
              </Chip.Label>
            </Chip>
          ) : null}
          <View className="flex-1" />
          <Chip size="sm" variant="soft" color={color}>
            <Chip.Label>{statusLabel(item)}</Chip.Label>
          </Chip>
        </View>
      </Surface>
    </Pressable>
  );
}

export function KanbanScreen({ conversations = [], onOpenConversation, onRefresh, refreshing = false, now = Date.now() }: KanbanScreenProps) {
  const [filter, setFilter] = useState<'today' | 'all'>('today');
  const sections = useMemo<BoardSection[]>(() => {
    const cutoff = dayStart(now);
    const grouped = new Map<string, BoardSection>();
    conversations
      .filter((item) => item.archived !== true && (filter === 'all' || item.updatedAt >= cutoff))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .forEach((item) => {
        const title = item.workspaceName?.trim() || item.workspaceId || '未命名工作区';
        const section = grouped.get(item.workspaceId) || { workspaceId: item.workspaceId, title, data: [] };
        section.data.push(item);
        grouped.set(item.workspaceId, section);
      });
    return [...grouped.values()].sort((left, right) => left.title.localeCompare(right.title));
  }, [conversations, filter, now]);
  const totalCount = sections.reduce((total, section) => total + section.data.length, 0);

  return (
    <Screen>
      <SectionList<KanbanConversation, BoardSection>
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <BoardCard item={item} onPress={() => onOpenConversation?.(item)} />}
        renderSectionHeader={({ section }) => (
          <View className="mb-2 mt-3 flex-row items-center gap-2 px-5">
            <StyledIonicons name="folder-outline" size={15} className="text-muted" />
            <Text type="body-sm" weight="semibold" className="min-w-0 flex-1 uppercase tracking-wide text-muted" numberOfLines={1}>
              {section.title}
            </Text>
            <Chip size="sm" variant="soft">
              <Chip.Label>{section.data.length}</Chip.Label>
            </Chip>
          </View>
        )}
        stickySectionHeadersEnabled={false}
        contentContainerClassName="w-full max-w-5xl self-center pb-10 pt-3"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
        ListHeaderComponent={
          <View className="gap-3 px-4 pb-1">
            <ScreenIntro
              description="按工作区查看最近活跃的对话。"
              trailing={
                <Chip size="sm" variant="soft" color="accent">
                  <Chip.Label>{totalCount} 个对话</Chip.Label>
                </Chip>
              }
            />
            <Segment value={filter} onValueChange={(value) => setFilter(value as 'today' | 'all')} size="sm">
              <Segment.Group>
                <Segment.Indicator />
                <Segment.Item value="today" className="flex-1">
                  <Segment.Label>今天</Segment.Label>
                </Segment.Item>
                <Segment.Item value="all" className="flex-1">
                  <Segment.Label>全部</Segment.Label>
                </Segment.Item>
              </Segment.Group>
            </Segment>
          </View>
        }
        ListEmptyComponent={
          <EmptyStateView
            icon="albums-outline"
            title="没有可显示的对话"
            description={filter === 'today' ? '今天还没有更新过的对话。' : '创建工作区并开始一条对话后，这里会显示记录。'}
            actionLabel={filter === 'today' ? '查看全部' : undefined}
            onAction={filter === 'today' ? () => setFilter('all') : undefined}
          />
        }
      />
    </Screen>
  );
}

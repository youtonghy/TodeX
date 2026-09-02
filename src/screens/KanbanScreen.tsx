import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip, Surface, Text as HeroText } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';
import { ProviderIcon, providerLabel } from '../components/ProviderIcon';
import type { ProviderKind } from '../lib/v2';

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

function BoardCard({ item, onPress }: { item: KanbanConversation; onPress?: () => void }) {
  const title = item.title?.trim() || item.preview?.trim() || '未命名对话';
  const preview = item.preview?.trim() && item.preview.trim() !== title ? item.preview.trim() : '暂无消息预览';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`打开对话 ${title}`}
      onPress={onPress}
      style={({ pressed }) => [styles.cardPressable, pressed && styles.cardPressed]}
    >
      <Card variant="transparent" className="border border-separator bg-surface px-3 py-3">
        <View className="flex-row items-start gap-3">
          <ProviderIcon provider={item.provider} size={17} />
          <View className="min-w-0 flex-1">
            <View className="flex-row items-start justify-between gap-2">
              <HeroText className="min-w-0 flex-1 text-sm font-semibold text-foreground" numberOfLines={2}>{title}</HeroText>
              <HeroText className="text-[11px] text-muted">{timeLabel(item.updatedAt)}</HeroText>
            </View>
            <HeroText className="mt-1 text-xs text-muted" numberOfLines={2}>{preview}</HeroText>
            <View className="mt-2 flex-row flex-wrap items-center gap-2">
              <Chip size="sm" variant="secondary"><Text>{providerLabel(item.provider)}</Text></Chip>
              {item.model ? <HeroText className="text-[11px] text-muted" numberOfLines={1}>{item.model}</HeroText> : null}
              <HeroText className="ml-auto text-[11px] text-muted">{statusLabel(item)}</HeroText>
            </View>
          </View>
        </View>
      </Card>
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

  return (
    <Surface className="flex-1 bg-background">
      <SectionList<KanbanConversation, BoardSection>
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <BoardCard item={item} onPress={() => onOpenConversation?.(item)} />}
        renderSectionHeader={({ section }) => (
          <View className="mb-2 mt-4 flex-row items-center justify-between px-4">
            <View className="min-w-0 flex-1 flex-row items-center gap-2">
              <Ionicons name="folder-outline" size={16} color="#66717c" />
              <HeroText className="min-w-0 flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>{section.title}</HeroText>
              <Chip size="sm" variant="secondary"><Text>{section.data.length}</Text></Chip>
            </View>
          </View>
        )}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.listContent}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
        ListHeaderComponent={(
          <View className="px-4 pb-1 pt-4">
            <View className="flex-row items-center justify-between gap-3">
              <View className="min-w-0 flex-1">
                <HeroText className="text-xl font-semibold text-foreground">今日看板</HeroText>
                <HeroText className="mt-1 text-xs text-muted">按工作区查看最近活跃的对话。</HeroText>
              </View>
              <View className="flex-row rounded-lg bg-surface-secondary p-1">
                <Button size="sm" variant={filter === 'today' ? 'primary' : 'ghost'} onPress={() => setFilter('today')}><Button.Label>今天</Button.Label></Button>
                <Button size="sm" variant={filter === 'all' ? 'primary' : 'ghost'} onPress={() => setFilter('all')}><Button.Label>全部</Button.Label></Button>
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={(
          <View className="items-center px-8 py-14">
            <Ionicons name="albums-outline" size={30} color="#7a8391" />
            <HeroText className="mt-3 text-sm font-semibold text-foreground">没有可显示的对话</HeroText>
            <HeroText className="mt-1 text-center text-xs text-muted">{filter === 'today' ? '今天还没有更新过的对话。' : '创建工作区并开始一条对话后，这里会显示记录。'}</HeroText>
          </View>
        )}
      />
    </Surface>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 28 },
  cardPressable: { marginHorizontal: 12, marginBottom: 8, borderRadius: 10 },
  cardPressed: { opacity: 0.78 },
});


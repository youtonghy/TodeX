import { useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
  Pressable,
  type ListRenderItemInfo,
} from 'react-native';
import { Button, Card, Chip, Surface, Text as HeroText } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';

export type UsageRecord = {
  id?: string;
  conversationId?: string;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  updatedAt?: number;
};

export type UsageScreenProps = {
  records?: readonly UsageRecord[];
  onRefresh?: () => void;
  refreshing?: boolean;
};

type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
};

type UsageRow = {
  id: string;
  label: string;
  totals: UsageTotals;
};

type UsageSection = {
  title: string;
  data: UsageRow[];
};

const EMPTY_TOTALS: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
};

function numberOf(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function totalsOf(record: UsageRecord): UsageTotals {
  return {
    inputTokens: numberOf(record.inputTokens),
    outputTokens: numberOf(record.outputTokens),
    cachedInputTokens: numberOf(record.cachedInputTokens),
    cacheWriteTokens: numberOf(record.cacheWriteTokens),
  };
}

function addTotals(left: UsageTotals, right: UsageTotals): UsageTotals {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
  };
}

function totalTokens(totals: UsageTotals): number {
  return totals.inputTokens + totals.outputTokens + totals.cachedInputTokens + totals.cacheWriteTokens;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(value));
}

function displayName(value: string): string {
  return value === 'unknown' ? '未知' : value;
}

function FilterPill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.filterPill, selected && styles.filterPillSelected]}
    >
      <Text style={[styles.filterPillText, selected && styles.filterPillTextSelected]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function MetricCard({ label, value, detail, icon, tint }: {
  label: string;
  value: number;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
}) {
  return (
    <Card variant="transparent" className="min-w-0 flex-1 border border-separator bg-surface px-3 py-3">
      <View className="flex-row items-start justify-between gap-2">
        <View className="min-w-0 flex-1">
          <HeroText className="text-xs text-muted" numberOfLines={1}>{label}</HeroText>
          <HeroText className="mt-1 text-xl font-semibold text-foreground" numberOfLines={1}>{formatTokens(value)}</HeroText>
          <HeroText className="mt-1 text-[11px] text-muted" numberOfLines={1}>{detail}</HeroText>
        </View>
        <View style={[styles.metricIcon, { backgroundColor: `${tint}18` }]}>
          <Ionicons name={icon} size={16} color={tint} />
        </View>
      </View>
    </Card>
  );
}

function UsageBar({ totals, max }: { totals: UsageTotals; max: number }) {
  const total = totalTokens(totals);
  const width = max > 0 ? Math.max(4, Math.min(100, (total / max) * 100)) : 0;
  const segment = (value: number) => `${total > 0 ? (value / total) * 100 : 0}%` as `${number}%`;
  return (
    <View className="mt-2 h-2 overflow-hidden rounded-full bg-surface-tertiary" style={{ width: `${width}%` }}>
      <View className="h-full flex-row">
        <View className="h-full bg-success" style={{ width: segment(totals.inputTokens) }} />
        <View className="h-full bg-accent" style={{ width: segment(totals.outputTokens) }} />
        <View className="h-full bg-warning" style={{ width: segment(totals.cachedInputTokens) }} />
        <View className="h-full bg-muted" style={{ width: segment(totals.cacheWriteTokens) }} />
      </View>
    </View>
  );
}

export function UsageScreen({ records = [], onRefresh, refreshing = false }: UsageScreenProps) {
  const [provider, setProvider] = useState('all');
  const [model, setModel] = useState('all');
  const normalizedRecords = useMemo(
    () => records.filter((record) => totalTokens(totalsOf(record)) > 0),
    [records],
  );
  const providers = useMemo(
    () => [...new Set(normalizedRecords.map((record) => record.provider?.trim() || 'unknown'))].sort(),
    [normalizedRecords],
  );
  const providerRecords = useMemo(
    () => provider === 'all'
      ? normalizedRecords
      : normalizedRecords.filter((record) => (record.provider?.trim() || 'unknown') === provider),
    [normalizedRecords, provider],
  );
  const models = useMemo(
    () => [...new Set(providerRecords.map((record) => record.model?.trim() || 'unknown'))].sort(),
    [providerRecords],
  );
  const filteredRecords = useMemo(
    () => model === 'all' ? providerRecords : providerRecords.filter((record) => (record.model?.trim() || 'unknown') === model),
    [model, providerRecords],
  );
  const totals = useMemo(
    () => filteredRecords.reduce((sum, record) => addTotals(sum, totalsOf(record)), EMPTY_TOTALS),
    [filteredRecords],
  );
  const groupedRows = useMemo<UsageRow[]>(() => {
    const key = provider === 'all' ? 'provider' : 'model';
    const groups = new Map<string, UsageTotals>();
    filteredRecords.forEach((record) => {
      const name = (key === 'provider' ? record.provider : record.model)?.trim() || 'unknown';
      groups.set(name, addTotals(groups.get(name) || EMPTY_TOTALS, totalsOf(record)));
    });
    return [...groups.entries()]
      .map(([label, rowTotals]) => ({ id: `${key}:${label}`, label: displayName(label), totals: rowTotals }))
      .sort((left, right) => totalTokens(right.totals) - totalTokens(left.totals));
  }, [filteredRecords, provider]);
  const maxRowTotal = Math.max(0, ...groupedRows.map((row) => totalTokens(row.totals)));
  const cacheBase = totals.inputTokens + totals.cachedInputTokens;
  const cacheRate = cacheBase > 0 ? Math.round((totals.cachedInputTokens / cacheBase) * 100) : 0;
  const sections = useMemo<UsageSection[]>(() => [{
    title: provider === 'all' ? '按 Agent' : '按模型',
    data: groupedRows,
  }], [groupedRows, provider]);

  const renderRow = ({ item }: ListRenderItemInfo<UsageRow>) => (
    <Card variant="transparent" className="mb-2 border border-separator bg-surface-secondary px-3 py-3">
      <View className="flex-row items-center justify-between gap-3">
        <HeroText className="min-w-0 flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>{item.label}</HeroText>
        <Chip size="sm" variant="secondary"><Text>{formatTokens(totalTokens(item.totals))}</Text></Chip>
      </View>
      <UsageBar totals={item.totals} max={maxRowTotal} />
      <HeroText className="mt-2 text-[11px] text-muted" numberOfLines={1}>
        输入 {formatTokens(item.totals.inputTokens)} · 输出 {formatTokens(item.totals.outputTokens)} · 缓存 {formatTokens(item.totals.cachedInputTokens)}
      </HeroText>
    </Card>
  );

  return (
    <Surface className="flex-1 bg-background">
      <SectionList<UsageRow, UsageSection>
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        renderSectionHeader={({ section }) => <HeroText className="mb-2 mt-4 px-4 text-sm font-semibold text-foreground">{section.title}</HeroText>}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.listContent}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
        ListHeaderComponent={(
          <View>
            <View className="px-4 pb-1 pt-4">
              <HeroText className="text-xl font-semibold text-foreground">使用统计</HeroText>
              <HeroText className="mt-1 text-xs text-muted">按 Agent 和模型汇总收到的 token usage 事件。</HeroText>
            </View>
            <View className="mt-3 px-4">
              <HeroText className="mb-2 text-xs font-semibold text-muted">Agent</HeroText>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={['all', ...providers]}
                keyExtractor={(item) => `provider:${item}`}
                renderItem={({ item }) => <FilterPill label={item === 'all' ? '全部' : displayName(item)} selected={provider === item} onPress={() => { setProvider(item); setModel('all'); }} />}
                ItemSeparatorComponent={() => <View style={{ width: 8 }} />}
              />
              <HeroText className="mb-2 mt-3 text-xs font-semibold text-muted">模型</HeroText>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={['all', ...models]}
                keyExtractor={(item) => `model:${item}`}
                renderItem={({ item }) => <FilterPill label={item === 'all' ? '全部' : displayName(item)} selected={model === item} onPress={() => setModel(item)} />}
                ItemSeparatorComponent={() => <View style={{ width: 8 }} />}
              />
            </View>
            <View className="mt-4 flex-row gap-2 px-4">
              <MetricCard label="总用量" value={totalTokens(totals)} detail={`${filteredRecords.length} 条记录`} icon="bar-chart-outline" tint="#2b7a70" />
              <MetricCard label="输入" value={totals.inputTokens} detail="Input tokens" icon="download-outline" tint="#1e8e62" />
            </View>
            <View className="mt-2 flex-row gap-2 px-4">
              <MetricCard label="输出" value={totals.outputTokens} detail="Output tokens" icon="cloud-upload-outline" tint="#5477b5" />
              <MetricCard label="缓存命中" value={totals.cachedInputTokens} detail={`${cacheRate}% 命中率`} icon="flash-outline" tint="#b27b2b" />
            </View>
          </View>
        )}
        ListEmptyComponent={<HeroText className="px-4 py-10 text-center text-sm text-muted">还没有用量记录。</HeroText>}
      />
    </Surface>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 28 },
  filterPill: {
    minHeight: 36,
    maxWidth: 180,
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d7dce0',
    backgroundColor: '#f7f9fa',
    paddingHorizontal: 14,
  },
  filterPillSelected: { borderColor: '#2b7a70', backgroundColor: '#2b7a70' },
  filterPillText: { color: '#52606b', fontSize: 12, fontWeight: '700' },
  filterPillTextSelected: { color: '#ffffff' },
  metricIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
});


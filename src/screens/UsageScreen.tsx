import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Chip, Surface, Text } from 'heroui-native';
import { BarChart, NumberValue, ProgressBar, TrendChip, Widget } from 'heroui-native-pro';

import { EmptyStateView, ListRow, ListSection, PageHeader, Screen, ScreenScrollView, SectionHeader, StyledIonicons } from '../components/ui';

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

function FilterChips({
  items,
  value,
  onChange,
}: {
  items: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
      {items.map((item) => {
        const selected = value === item;
        return (
          <Chip
            key={item}
            size="md"
            variant={selected ? 'primary' : 'soft'}
            color={selected ? 'accent' : 'default'}
            onPress={() => onChange(item)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Chip.Label numberOfLines={1} className="max-w-[180px]">
              {item === 'all' ? '全部' : displayName(item)}
            </Chip.Label>
          </Chip>
        );
      })}
    </ScrollView>
  );
}

function MetricTile({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  icon: React.ComponentProps<typeof StyledIonicons>['name'];
  tone: 'accent' | 'success' | 'warning' | 'default';
}) {
  const iconBg = tone === 'accent' ? 'bg-accent/15' : tone === 'success' ? 'bg-success/15' : tone === 'warning' ? 'bg-warning/15' : 'bg-default';
  const iconColor = tone === 'accent' ? 'text-accent' : tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-foreground';
  return (
    <Surface className="min-w-0 flex-1 gap-2 rounded-3xl p-4">
      <View className="flex-row items-center justify-between gap-2">
        <Text type="body-xs" weight="semibold" className="uppercase tracking-wide text-muted" numberOfLines={1}>
          {label}
        </Text>
        <View className={`h-7 w-7 items-center justify-center rounded-full ${iconBg}`}>
          <StyledIonicons name={icon} size={14} className={iconColor} />
        </View>
      </View>
      <NumberValue value={value} classNames={{ value: 'text-2xl font-semibold text-foreground' }}>
        {(formatted) => (
          <Text type="h3" className="text-foreground" numberOfLines={1}>
            {value >= 1_000 ? formatTokens(value) : formatted}
          </Text>
        )}
      </NumberValue>
      <Text type="body-xs" color="muted" numberOfLines={1}>
        {detail}
      </Text>
    </Surface>
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
  const outputRatio = totalTokens(totals) > 0 ? Math.round((totals.outputTokens / totalTokens(totals)) * 100) : 0;
  const chartData = useMemo(
    () => groupedRows.slice(0, 6).map((row, index) => ({
      index,
      label: row.label,
      input: row.totals.inputTokens,
      output: row.totals.outputTokens,
    })),
    [groupedRows],
  );
  const groupTitle = provider === 'all' ? '按 Agent' : '按模型';

  return (
    <Screen>
      <ScreenScrollView refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}>
        <PageHeader title="使用统计" subtitle="按 Agent 和模型汇总收到的 token usage 事件。" />

        {normalizedRecords.length === 0 ? (
          <EmptyStateView icon="stats-chart-outline" title="还没有用量记录" description="与 Agent 对话后，这里会汇总每次回复的 token 用量。" />
        ) : (
          <>
            <View className="gap-2">
              <SectionHeader title="Agent" />
              <FilterChips
                items={['all', ...providers]}
                value={provider}
                onChange={(next) => {
                  setProvider(next);
                  setModel('all');
                }}
              />
              {models.length > 1 ? (
                <>
                  <SectionHeader title="模型" className="mt-1" />
                  <FilterChips items={['all', ...models]} value={model} onChange={setModel} />
                </>
              ) : null}
            </View>

            <View className="gap-2">
              <View className="flex-row gap-2">
                <MetricTile label="总用量" value={totalTokens(totals)} detail={`${filteredRecords.length} 条记录`} icon="bar-chart-outline" tone="accent" />
                <MetricTile label="输入" value={totals.inputTokens} detail="Input tokens" icon="download-outline" tone="success" />
              </View>
              <View className="flex-row gap-2">
                <MetricTile label="输出" value={totals.outputTokens} detail={`${outputRatio}% 占比`} icon="cloud-upload-outline" tone="default" />
                <MetricTile label="缓存命中" value={totals.cachedInputTokens} detail={`${cacheRate}% 命中率`} icon="flash-outline" tone="warning" />
              </View>
            </View>

            {chartData.length > 0 ? (
              <Widget>
                <Widget.Header>
                  <View>
                    <Widget.Title>{groupTitle}分布</Widget.Title>
                    <Widget.Description>输入与输出 token（前 {chartData.length} 项）</Widget.Description>
                  </View>
                  <Widget.Legend>
                    <Widget.LegendItem colorClassName="bg-chart-2">输入</Widget.LegendItem>
                    <Widget.LegendItem colorClassName="bg-chart-1">输出</Widget.LegendItem>
                  </Widget.Legend>
                </Widget.Header>
                <Widget.Content>
                  <BarChart data={chartData} xKey="index" yKeys={['input', 'output']} wrapperClassName="h-44">
                    {({ points, chartBounds }) => (
                      <BarChart.BarGroup chartBounds={chartBounds} barWidth={12}>
                        <BarChart.BarGroupItem points={points.input} colorClassName="accent-chart-2" />
                        <BarChart.BarGroupItem points={points.output} colorClassName="accent-chart-1" />
                      </BarChart.BarGroup>
                    )}
                  </BarChart>
                  <View className="mt-2 flex-row flex-wrap gap-1.5">
                    {chartData.map((item) => (
                      <Chip key={item.label} size="sm" variant="soft">
                        <Chip.Label numberOfLines={1} className="max-w-[140px]">
                          {item.index + 1}. {item.label}
                        </Chip.Label>
                      </Chip>
                    ))}
                  </View>
                </Widget.Content>
                <Widget.Footer>
                  <Widget.Description>缓存读取 {formatTokens(totals.cachedInputTokens)} · 缓存写入 {formatTokens(totals.cacheWriteTokens)}</Widget.Description>
                </Widget.Footer>
              </Widget>
            ) : null}

            <View className="gap-2">
              <SectionHeader title={groupTitle} description={`${groupedRows.length} 项`} />
              <ListSection>
                {groupedRows.map((row) => {
                  const total = totalTokens(row.totals);
                  const share = maxRowTotal > 0 ? Math.round((total / maxRowTotal) * 100) : 0;
                  const rowCacheBase = row.totals.inputTokens + row.totals.cachedInputTokens;
                  const rowCacheRate = rowCacheBase > 0 ? Math.round((row.totals.cachedInputTokens / rowCacheBase) * 100) : 0;
                  return (
                    <ListRow
                      key={row.id}
                      title={row.label}
                      description={
                        <View className="mt-1 gap-1.5">
                          <ProgressBar value={share} size="sm" color="accent">
                            <ProgressBar.Track className="h-1.5">
                              <ProgressBar.Fill />
                            </ProgressBar.Track>
                          </ProgressBar>
                          <Text type="body-xs" color="muted" numberOfLines={1}>
                            输入 {formatTokens(row.totals.inputTokens)} · 输出 {formatTokens(row.totals.outputTokens)} · 缓存 {formatTokens(row.totals.cachedInputTokens)}
                          </Text>
                        </View>
                      }
                      descriptionLines={3}
                      suffix={
                        <View className="items-end gap-1">
                          <Text type="body-sm" weight="semibold" className="font-mono text-foreground">
                            {formatTokens(total)}
                          </Text>
                          {rowCacheRate > 0 ? (
                            <TrendChip trend={rowCacheRate >= 50 ? 'up' : 'neutral'} size="sm">
                              <TrendChip.Value>{rowCacheRate}%</TrendChip.Value>
                              <TrendChip.Suffix> 缓存</TrendChip.Suffix>
                            </TrendChip>
                          ) : null}
                        </View>
                      }
                      className="py-3.5"
                    />
                  );
                })}
              </ListSection>
            </View>
          </>
        )}
      </ScreenScrollView>
    </Screen>
  );
}

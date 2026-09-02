import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Surface, Text as HeroText } from 'heroui-native';
import type { McpCatalog, McpServerCatalogDescriptor, ProviderDescriptor, ProviderKind, SkillCatalog, SkillCatalogDescriptor } from '../lib/v2';

export type CatalogState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  skills?: SkillCatalog;
  mcp?: McpCatalog;
  error?: string;
};

type Props = {
  workspacePath: string;
  providers: ProviderDescriptor[];
  catalogs: Partial<Record<ProviderKind, CatalogState>>;
  onRefresh: (provider: ProviderKind) => void;
  conversationId?: string;
  selectedSkills?: Array<{ name: string; resourceId?: string }>;
  canInvoke?: boolean;
  onToggleSkill?: (skill: SkillCatalogDescriptor, provider: ProviderKind) => void;
  onCallMcp?: (resourceId: string, toolName: string) => void;
};

type ViewMode = 'skills' | 'mcp';
type ProviderChoice = ProviderKind | 'common';

const PROVIDER_LABELS: Record<ProviderKind, string> = {
  acp: 'ACP',
  codex: 'Codex CLI',
  pi: 'Pi',
  'claude-code': 'Claude Code',
  'grok-build': 'Grok Build',
};

function isCommonSource(source: string): boolean {
  return source.toLowerCase().includes('shared') || source.toLowerCase().includes('common');
}

function providerStatus(provider: ProviderDescriptor | undefined): { label: string; color: string } {
  if (!provider) return { label: '未加载', color: '#7a8391' };
  return provider.available
    ? { label: '可用', color: '#1e8e62' }
    : { label: provider.unavailableReason || '不可用', color: '#b04a4a' };
}

function SkillRow({
  item,
  selected,
  canSelect,
  onToggle,
}: {
  item: SkillCatalogDescriptor;
  selected: boolean;
  canSelect: boolean;
  onToggle?: () => void;
}) {
  const status = selected ? '已附加' : item.active && item.valid ? '当前启用' : item.shadowedBy ? '被覆盖' : item.valid ? '未启用' : '无效';
  return (
    <Card variant="transparent" className="mb-2 border border-separator bg-surface-secondary px-3 py-3">
      <View className="flex-row items-start gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-lg bg-accent-soft">
          <Ionicons name="flash-outline" size={18} color="#2b7a70" />
        </View>
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center justify-between gap-2">
            <HeroText className="flex-1 font-semibold text-foreground" numberOfLines={1}>{item.name}</HeroText>
            <HeroText style={{ color: selected || (item.active && item.valid) ? '#1e8e62' : '#7a8391' }} className="text-xs font-semibold">{status}</HeroText>
          </View>
          {item.description ? <HeroText className="mt-1 text-xs text-muted" numberOfLines={3}>{item.description}</HeroText> : null}
          <HeroText className="mt-2 text-[11px] text-muted">{item.scope} · {item.source}</HeroText>
          {item.error ? <HeroText className="mt-1 text-xs text-danger" numberOfLines={2}>{item.error}</HeroText> : null}
          {canSelect ? (
            <Button size="sm" variant={selected ? 'secondary' : 'primary'} className="mt-2 self-start" onPress={onToggle}>
              <Button.Label>{selected ? '取消附加' : '附加到下一条消息'}</Button.Label>
            </Button>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

function McpRow({
  item,
  canInvoke,
  onCall,
}: {
  item: McpServerCatalogDescriptor;
  canInvoke: boolean;
  onCall?: (toolName: string) => void;
}) {
  const status = item.enabled && item.active ? '当前启用' : item.shadowedBy ? '被覆盖' : item.enabled ? '可用' : '已禁用';
  return (
    <Card variant="transparent" className="mb-2 border border-separator bg-surface-secondary px-3 py-3">
      <View className="flex-row items-start gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-lg bg-success-soft">
          <Ionicons name="git-network-outline" size={18} color="#1e8e62" />
        </View>
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center justify-between gap-2">
            <HeroText className="flex-1 font-semibold text-foreground" numberOfLines={1}>{item.name}</HeroText>
            <HeroText style={{ color: item.enabled && item.active ? '#1e8e62' : '#7a8391' }} className="text-xs font-semibold">{status}</HeroText>
          </View>
          <HeroText className="mt-2 text-[11px] text-muted">{item.transport} · {item.scope} · {item.source}</HeroText>
          {item.tools?.length && canInvoke ? item.tools.map((tool) => (
            <Button key={tool.name} size="sm" variant="secondary" className="mt-2 self-start" onPress={() => onCall?.(tool.name)}>
              <Button.Label>调用 {tool.name}</Button.Label>
            </Button>
          )) : null}
        </View>
      </View>
    </Card>
  );
}

export function CapabilitiesScreen({
  workspacePath,
  providers,
  catalogs,
  onRefresh,
  selectedSkills = [],
  canInvoke = false,
  onToggleSkill,
  onCallMcp,
}: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('skills');
  const [providerChoice, setProviderChoice] = useState<ProviderChoice>('common');
  const provider = providerChoice === 'common' ? undefined : providers.find((item) => item.id === providerChoice);
  const providerKeys = useMemo(() => providers.map((item) => item.id), [providers]);
  const selectedCatalogs = providerChoice === 'common'
    ? providerKeys.map((key) => catalogs[key]).filter(Boolean) as CatalogState[]
    : catalogs[providerChoice] ? [catalogs[providerChoice] as CatalogState] : [];
  const state = selectedCatalogs.find((item) => item.status === 'loading') ?? selectedCatalogs[0];
  const skills = useMemo(() => {
    const items = selectedCatalogs.flatMap((item) => (item.skills?.skills ?? []).map((skill) => ({
      skill,
      provider: (item.skills?.provider ?? providerChoice) as ProviderKind,
    })));
    return items.filter((item, index, list) => {
      const key = `${item.skill.resourceId}:${item.skill.name}`;
      return list.findIndex((candidate) => `${candidate.skill.resourceId}:${candidate.skill.name}` === key) === index;
    }).filter((item) => providerChoice !== 'common' || isCommonSource(item.skill.source));
  }, [providerChoice, selectedCatalogs]);
  const mcpServers = useMemo(() => {
    const items = selectedCatalogs.flatMap((item) => item.mcp?.servers ?? []);
    return items.filter((item, index, list) => {
      if (providerChoice !== 'common') return true;
      if (!isCommonSource(item.source)) return false;
      return list.findIndex((candidate) => candidate.name === item.name && candidate.source === item.source) === index;
    });
  }, [providerChoice, selectedCatalogs]);
  const isLoading = state?.status === 'loading';
  const error = state?.error;

  return (
    <Surface className="flex-1 bg-background">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.providerRail}>
        <Pressable onPress={() => setProviderChoice('common')} style={[styles.providerPill, providerChoice === 'common' && styles.providerPillActive]}>
          <Text style={[styles.providerPillText, providerChoice === 'common' && styles.providerPillTextActive]}>通用</Text>
        </Pressable>
        {providers.map((item) => {
          const status = providerStatus(item);
          const selected = providerChoice === item.id;
          return (
            <Pressable key={item.id} onPress={() => setProviderChoice(item.id)} style={[styles.providerPill, selected && styles.providerPillActive]}>
              <Text style={[styles.providerPillText, selected && styles.providerPillTextActive]}>{PROVIDER_LABELS[item.id]}</Text>
              <Text style={{ color: selected ? '#ffffff' : status.color, fontSize: 10 }}>{item.available ? '●' : '○'}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View className="px-4 pb-2 pt-3">
        <View className="flex-row items-center justify-between">
          <View className="min-w-0 flex-1">
            <HeroText className="text-xl font-semibold text-foreground">Skills 和 MCPs</HeroText>
            <HeroText className="mt-1 text-xs text-muted" numberOfLines={1}>{provider ? `${provider.displayName} · ${providerStatus(provider).label} · ${workspacePath}` : `通用能力 · ${workspacePath}`}</HeroText>
          </View>
          {providerChoice !== 'common' ? (
            <Button isIconOnly size="sm" variant="ghost" accessibilityLabel="刷新能力目录" onPress={() => onRefresh(providerChoice)}>
              <Ionicons name="refresh-outline" size={18} color="#52606b" />
            </Button>
          ) : null}
        </View>
        <View className="mt-3 flex-row rounded-lg bg-surface-secondary p-1">
          {(['skills', 'mcp'] as const).map((mode) => (
            <Button key={mode} variant={viewMode === mode ? 'primary' : 'ghost'} className="flex-1 rounded-md" onPress={() => setViewMode(mode)}>
              <Button.Label>{mode === 'skills' ? 'Skills' : 'MCPs'}</Button.Label>
            </Button>
          ))}
        </View>
      </View>
      {isLoading ? <View className="items-center py-10"><ActivityIndicator /><HeroText className="mt-2 text-xs text-muted">正在读取目录…</HeroText></View> : null}
      {error ? <View className="mx-4 rounded-lg border border-danger-soft bg-danger-soft px-3 py-3"><HeroText className="text-sm text-danger">{error}</HeroText></View> : null}
      {!isLoading && !error && viewMode === 'skills' ? (
        <FlatList data={skills} keyExtractor={(item) => `${item.skill.resourceId}:${item.skill.name}`} renderItem={({ item }) => (
          <SkillRow
            item={item.skill}
            selected={selectedSkills.some((skill) => skill.resourceId === item.skill.resourceId || skill.name === item.skill.name)}
            canSelect={Boolean(canInvoke && onToggleSkill)}
            onToggle={() => onToggleSkill?.(item.skill, item.provider)}
          />
        )} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={false} onRefresh={() => providerChoice !== 'common' && onRefresh(providerChoice)} />} ListEmptyComponent={<HeroText className="px-4 py-10 text-center text-sm text-muted">没有找到 Skill。</HeroText>} />
      ) : null}
      {!isLoading && !error && viewMode === 'mcp' ? (
        <FlatList data={mcpServers} keyExtractor={(item) => `${item.resourceId}:${item.name}`} renderItem={({ item }) => (
          <McpRow item={item} canInvoke={canInvoke} onCall={(toolName) => onCallMcp?.(item.resourceId, toolName)} />
        )} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={false} onRefresh={() => providerChoice !== 'common' && onRefresh(providerChoice)} />} ListEmptyComponent={<HeroText className="px-4 py-10 text-center text-sm text-muted">没有找到 MCP Server。</HeroText>} />
      ) : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  providerRail: { gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  providerPill: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, backgroundColor: '#eef0f2', paddingHorizontal: 12 },
  providerPillActive: { backgroundColor: '#2b7a70' },
  providerPillText: { color: '#52606b', fontSize: 12, fontWeight: '700' },
  providerPillTextActive: { color: '#ffffff' },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28 },
});

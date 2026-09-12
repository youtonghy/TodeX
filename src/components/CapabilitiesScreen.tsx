import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, View } from 'react-native';
import { Button, Chip, Surface, Switch, Text } from 'heroui-native';
import { Segment } from 'heroui-native-pro/segment';

import type { McpServerCatalogDescriptor, ProviderDescriptor, ProviderKind, SkillCatalogDescriptor } from '../lib/v2';
import type { CatalogState } from '../lib/capabilityCatalog';
import { ProviderIcon } from './ProviderIcon';
import { AppDialog, EmptyStateView, InlineNotice, LoadingState, Screen, StyledIonicons } from './ui';

export type CapabilitiesScreenProps = {
  workspacePath: string;
  providers: ProviderDescriptor[];
  catalogs: Partial<Record<ProviderKind, CatalogState>>;
  onRefresh: (provider: ProviderKind) => void;
  conversationId?: string;
  selectedSkills?: Array<{ name: string; resourceId?: string }>;
  canInvoke?: boolean;
  onToggleSkill?: (skill: SkillCatalogDescriptor, provider: ProviderKind) => void;
  onCallMcp?: (resourceId: string, toolName: string) => void;
  onReadSkill?: (provider: ProviderKind, resourceId: string) => Promise<string>;
  onRefreshMcp?: (resourceId: string) => Promise<void>;
};

type ViewMode = 'skills' | 'mcp';
type ProviderChoice = ProviderKind | 'common';

const PROVIDER_LABELS: Record<ProviderKind, string> = {
  acp: 'ACP',
  codex: 'Codex CLI',
  pi: 'Pi',
  'claude-code': 'Claude Code',
  'grok-build': 'Grok Build',
  devin: 'Devin',
  opencode: 'OpenCode',
};

function isCommonSource(source: string): boolean {
  return source.toLowerCase().includes('shared') || source.toLowerCase().includes('common');
}

function providerStatus(provider: ProviderDescriptor | undefined): { label: string; color: 'default' | 'success' | 'danger' } {
  if (!provider) return { label: '未加载', color: 'default' };
  return provider.available
    ? { label: '可用', color: 'success' }
    : { label: provider.unavailableReason || '不可用', color: 'danger' };
}

function SkillRow({
  item,
  selected,
  canSelect,
  onToggle,
  onPreview,
}: {
  item: SkillCatalogDescriptor;
  selected: boolean;
  canSelect: boolean;
  onToggle?: () => void;
  onPreview?: () => void;
}) {
  const enabled = item.active && item.valid;
  const status = selected ? '已附加' : enabled ? '当前启用' : item.shadowedBy ? '被覆盖' : item.valid ? '未启用' : '无效';
  const statusColor: 'accent' | 'success' | 'default' | 'danger' = selected ? 'accent' : enabled ? 'success' : item.valid ? 'default' : 'danger';
  return (
    <Surface className="mb-2 gap-2.5 rounded-3xl p-4">
      <View className="flex-row items-start gap-3">
        <View className={`h-10 w-10 items-center justify-center rounded-2xl ${selected ? 'bg-accent' : 'bg-accent/15'}`}>
          <StyledIonicons name="flash" size={18} className={selected ? 'text-accent-foreground' : 'text-accent'} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row items-center justify-between gap-2">
            <Text type="body" weight="semibold" className="min-w-0 flex-1 text-foreground" numberOfLines={1}>
              {item.name}
            </Text>
            <Chip size="sm" variant="soft" color={statusColor}>
              <Chip.Label>{status}</Chip.Label>
            </Chip>
          </View>
          {item.description ? (
            <Text type="body-sm" color="muted" numberOfLines={3}>
              {item.description}
            </Text>
          ) : null}
          <Text type="body-xs" color="muted" numberOfLines={1} className="font-mono">
            {item.scope} · {item.source}
          </Text>
          {item.error ? <InlineNotice status="danger" title={item.error} className="mt-1" /> : null}
        </View>
      </View>
      {onPreview ? <Button variant="secondary" onPress={onPreview}><Button.Label>查看完整指令</Button.Label></Button> : null}
      {canSelect ? (
        <View className="flex-row items-center justify-between gap-3 rounded-2xl bg-surface-secondary px-3 py-2 pl-[52px]">
          <Text type="body-sm" className="text-foreground">
            附加到下一条消息
          </Text>
          <Switch isSelected={selected} onSelectedChange={() => onToggle?.()} isDisabled={!item.valid} />
        </View>
      ) : null}
    </Surface>
  );
}

function McpRow({
  item,
  canInvoke,
  onCall,
  onRefresh,
}: {
  item: McpServerCatalogDescriptor;
  canInvoke: boolean;
  onCall?: (toolName: string) => void;
  onRefresh?: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const refreshLock = useRef(false);
  const refresh = async () => {
    if (!onRefresh || refreshLock.current) return;
    refreshLock.current = true; setRefreshing(true); setRefreshError('');
    try { await onRefresh(); } catch (cause) { setRefreshError(cause instanceof Error ? cause.message : '工具刷新失败'); }
    finally { refreshLock.current = false; setRefreshing(false); }
  };
  const active = item.enabled && item.active;
  const status = active ? '当前启用' : item.shadowedBy ? '被覆盖' : item.enabled ? '可用' : '已禁用';
  return (
    <Surface className="mb-2 gap-2.5 rounded-3xl p-4">
      <View className="flex-row items-start gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-2xl bg-success/15">
          <StyledIonicons name="git-network-outline" size={18} className="text-success" />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row items-center justify-between gap-2">
            <Text type="body" weight="semibold" className="min-w-0 flex-1 text-foreground" numberOfLines={1}>
              {item.name}
            </Text>
            <Chip size="sm" variant="soft" color={active ? 'success' : 'default'}>
              <Chip.Label>{status}</Chip.Label>
            </Chip>
          </View>
          <Text type="body-xs" color="muted" numberOfLines={1} className="font-mono">
            {item.transport} · {item.scope} · {item.source}
          </Text>
        </View>
      </View>
      {item.error || refreshError ? <InlineNotice status="danger" title="MCP 读取失败" description={refreshError || item.error} /> : null}
      {canInvoke && onRefresh ? <Button variant="secondary" isDisabled={refreshing} onPress={() => void refresh()}><Button.Label>{refreshing ? '正在刷新…' : '刷新工具'}</Button.Label></Button> : null}
      {!item.tools?.length ? <Text type="body-xs" color="muted">尚未列出工具，刷新后由后端发现。</Text> : null}
      {item.tools?.length ? (
        <View className="flex-row flex-wrap gap-2 pl-[52px]">
          {item.tools.map((tool) => (
            <Button key={tool.name} size="md" variant="secondary" isDisabled={!canInvoke || !onCall || refreshing} onPress={() => onCall?.(tool.name)}>
              <StyledIonicons name="play-outline" size={13} className="text-foreground" />
              <Button.Label>{tool.name}</Button.Label>
            </Button>
          ))}
        </View>
      ) : null}
    </Surface>
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
  onReadSkill, onRefreshMcp,
}: CapabilitiesScreenProps) {
  const [preview, setPreview] = useState<{ title: string; content: string; loading: boolean; error: string }>();
  const previewGeneration = useRef(0);
  useEffect(() => { previewGeneration.current++; setPreview(undefined); return () => { previewGeneration.current++; }; }, [workspacePath, onReadSkill]);
  const readSkill = async (item: SkillCatalogDescriptor, provider: ProviderKind) => {
    if (!onReadSkill) return;
    const revision = ++previewGeneration.current;
    setPreview({ title: item.name, content: '', loading: true, error: '' });
    try {
      const content = await onReadSkill(provider, item.resourceId);
      if (revision === previewGeneration.current) setPreview({ title: item.name, content, loading: false, error: '' });
    } catch (cause) {
      if (revision === previewGeneration.current) setPreview({ title: item.name, content: '', loading: false, error: cause instanceof Error ? cause.message : '无法读取 Skill' });
    }
  };
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
  const refreshControl = (
    <RefreshControl refreshing={Boolean(isLoading)} onRefresh={() => providerChoice === 'common' ? providerKeys.forEach(onRefresh) : onRefresh(providerChoice)} />
  );

  return (
    <Screen>
      <View className="gap-3 px-4 pb-2 pt-3">
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text type="h4" className="text-foreground">
              Skills 和 MCPs
            </Text>
            <Text type="body-xs" color="muted" numberOfLines={1}>
              {provider ? `${provider.displayName} · ${providerStatus(provider).label}` : '通用能力'} · {workspacePath}
            </Text>
          </View>
          {(
            <Button isIconOnly size="sm" variant="secondary" accessibilityLabel="刷新能力目录" onPress={() => providerChoice === 'common' ? providerKeys.forEach(onRefresh) : onRefresh(providerChoice)} className="h-11 w-11 rounded-full">
              <StyledIonicons name="refresh-outline" size={16} className="text-foreground" />
            </Button>
          )}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          <Chip
            size="md"
            variant={providerChoice === 'common' ? 'primary' : 'soft'}
            color={providerChoice === 'common' ? 'accent' : 'default'}
            onPress={() => setProviderChoice('common')}
            accessibilityRole="button"
            accessibilityState={{ selected: providerChoice === 'common' }}
          >
            <StyledIonicons name="layers-outline" size={13} className={providerChoice === 'common' ? 'text-accent-foreground' : 'text-foreground'} />
            <Chip.Label>通用</Chip.Label>
          </Chip>
          {providers.map((item) => {
            const status = providerStatus(item);
            const selected = providerChoice === item.id;
            return (
              <Chip
                key={item.id}
                size="md"
                variant={selected ? 'primary' : 'soft'}
                color={selected ? 'accent' : 'default'}
                onPress={() => setProviderChoice(item.id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <ProviderIcon provider={item.id} size={10} />
                <Chip.Label>{PROVIDER_LABELS[item.id]}</Chip.Label>
                <View className={`h-1.5 w-1.5 rounded-full ${status.color === 'success' ? 'bg-success' : status.color === 'danger' ? 'bg-danger' : 'bg-muted'}`} />
              </Chip>
            );
          })}
        </ScrollView>
        <Segment value={viewMode} onValueChange={(value) => setViewMode(value as ViewMode)} size="sm">
          <Segment.Group>
            <Segment.Indicator />
            <Segment.Item value="skills" className="flex-1">
              <Segment.Label>Skills{skills.length ? ` · ${skills.length}` : ''}</Segment.Label>
            </Segment.Item>
            <Segment.Item value="mcp" className="flex-1">
              <Segment.Label>MCPs{mcpServers.length ? ` · ${mcpServers.length}` : ''}</Segment.Label>
            </Segment.Item>
          </Segment.Group>
        </Segment>
      </View>
      {isLoading ? <LoadingState label="正在读取目录…" /> : null}
      {error ? (
        <View className="px-4">
          <InlineNotice status="danger" title="目录读取失败" description={error} />
        </View>
      ) : null}
      {!isLoading && !error && viewMode === 'skills' ? (
        <FlatList
          data={skills}
          keyExtractor={(item) => `${item.skill.resourceId}:${item.skill.name}`}
          renderItem={({ item }) => (
            <SkillRow
              item={item.skill}
              selected={selectedSkills.some((skill) => skill.resourceId === item.skill.resourceId || skill.name === item.skill.name)}
              canSelect={Boolean(canInvoke && onToggleSkill)}
              onToggle={() => onToggleSkill?.(item.skill, item.provider)}
              onPreview={onReadSkill ? () => void readSkill(item.skill, item.provider) : undefined}
            />
          )}
          contentContainerClassName="px-4 pb-10 pt-2"
          refreshControl={refreshControl}
          ListEmptyComponent={<EmptyStateView icon="flash-outline" title="没有找到 Skill" description="切换 Provider 或刷新目录后再试。" />}
        />
      ) : null}
      {!isLoading && !error && viewMode === 'mcp' ? (
        <FlatList
          data={mcpServers}
          keyExtractor={(item) => `${item.resourceId}:${item.name}`}
          renderItem={({ item }) => (
            <McpRow item={item} canInvoke={canInvoke} onRefresh={onRefreshMcp ? () => onRefreshMcp(item.resourceId) : undefined} onCall={onCallMcp ? (toolName) => onCallMcp(item.resourceId, toolName) : undefined} />
          )}
          contentContainerClassName="px-4 pb-10 pt-2"
          refreshControl={refreshControl}
          ListEmptyComponent={<EmptyStateView icon="git-network-outline" title="没有找到 MCP Server" description="切换 Provider 或刷新目录后再试。" />}
        />
      ) : null}
      <AppDialog isOpen={Boolean(preview)} onOpenChange={open => { if (!open) { previewGeneration.current++; setPreview(undefined); } }} title={preview?.title || 'Skill 指令'} actions={<Button variant="secondary" onPress={() => { previewGeneration.current++; setPreview(undefined); }}><Button.Label>关闭</Button.Label></Button>}>
        {preview?.loading ? <LoadingState label="正在读取完整指令…" /> : null}
        {preview?.error ? <InlineNotice status="danger" title="读取失败" description={preview.error} /> : null}
        <ScrollView style={{ maxHeight: 420 }}><Text selectable type="body-sm" className="font-mono">{preview?.content || (!preview?.loading && !preview?.error ? '内容为空' : '')}</Text></ScrollView>
      </AppDialog>
    </Screen>
  );
}

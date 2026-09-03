import { memo, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button, Chip, Surface, Text } from 'heroui-native';

import { permissionActions, type PendingRequest, type PermissionOption } from '../../lib/todex';
import {
  compactTokenCount,
  extractMessageLinks,
  nowLabel,
  type MobileContextUsage,
  type TimelineEntry,
} from '../../lib/appCore';
import { AppDialog, StyledIonicons, useAppToast } from '../../components/ui';

function ApprovalActions({
  request,
  onApprovalResponse,
}: {
  request: PendingRequest;
  onApprovalResponse?: (selection: boolean | PermissionOption, request: PendingRequest) => void;
}) {
  return (
    <View className="mt-3 flex-row flex-wrap gap-2">
      {permissionActions(request).map((option) => {
        const isBoolean = typeof option === 'boolean';
        const title = isBoolean ? (option ? '同意' : '拒绝') : option.name;
        const variant = isBoolean ? (option ? 'primary' : 'danger-soft') : 'secondary';
        return (
          <Button
            key={isBoolean ? String(option) : option.optionId}
            size="sm"
            variant={variant}
            onPress={() => onApprovalResponse?.(option, request)}
            className="rounded-full"
          >
            <StyledIonicons
              name={isBoolean ? (option ? 'checkmark' : 'close') : 'shield-checkmark-outline'}
              size={14}
              className={variant === 'primary' ? 'text-accent-foreground' : variant === 'danger-soft' ? 'text-danger' : 'text-foreground'}
            />
            <Button.Label>{title}</Button.Label>
          </Button>
        );
      })}
    </View>
  );
}

function UsageDialog({
  entry,
  usage,
  isOpen,
  onOpenChange,
}: {
  entry: TimelineEntry;
  usage: MobileContextUsage | null | undefined;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const total = usage ? usage.inputTokens + usage.outputTokens + usage.cachedInputTokens + usage.cacheWriteTokens : 0;
  const elapsedSeconds = usage ? Math.max(0.001, (usage.updatedAt - entry.at) / 1000) : 0;
  const outputTps = usage ? usage.outputTokens / elapsedSeconds : 0;
  const rows = usage
    ? [
        ['模型', usage.model || 'unknown'],
        ['输入', compactTokenCount(usage.inputTokens)],
        ['输出', compactTokenCount(usage.outputTokens)],
        ['缓存读取', compactTokenCount(usage.cachedInputTokens)],
        ['缓存写入', compactTokenCount(usage.cacheWriteTokens)],
        ['总计', `${compactTokenCount(total)} tokens`],
        ['输出 TPS', outputTps.toFixed(1)],
      ]
    : [];
  return (
    <AppDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="回复统计"
      description={usage ? undefined : '暂无该回复的 usage 数据。'}
      actions={
        <Button variant="primary" size="sm" onPress={() => onOpenChange(false)}>
          <Button.Label>关闭</Button.Label>
        </Button>
      }
    >
      {usage ? (
        <Surface variant="secondary" className="overflow-hidden rounded-2xl">
          {rows.map(([label, value], index) => (
            <View key={label} className={`flex-row items-center justify-between gap-3 px-4 py-2.5 ${index > 0 ? 'border-t border-separator' : ''}`}>
              <Text type="body-sm" color="muted">
                {label}
              </Text>
              <Text type="body-sm" weight="medium" className="min-w-0 flex-1 text-right font-mono text-foreground" numberOfLines={1}>
                {value}
              </Text>
            </View>
          ))}
        </Surface>
      ) : null}
    </AppDialog>
  );
}

export const MessageBubble = memo(function MessageBubble({
  entry,
  collapsed = false,
  collapsible = false,
  hideTitle = false,
  pendingRequest,
  onToggleProgress,
  onApprovalResponse,
  onOpenLink,
  onFork,
  usage,
  streaming = false,
}: {
  entry: TimelineEntry;
  collapsed?: boolean;
  collapsible?: boolean;
  hideTitle?: boolean;
  pendingRequest?: PendingRequest;
  onToggleProgress?: (entry: TimelineEntry, collapsed: boolean) => void;
  onApprovalResponse?: (selection: boolean | PermissionOption, request: PendingRequest) => void;
  onOpenLink?: (href: string) => void;
  onFork?: () => void;
  usage?: MobileContextUsage | null;
  streaming?: boolean;
}) {
  const toast = useAppToast();
  const [usageVisible, setUsageVisible] = useState(false);
  const outgoing = entry.kind === 'outgoing';
  const system = entry.kind === 'system';
  const copyText = async () => {
    const text = entry.subtitle || entry.title || entry.raw;
    if (!text) {
      return;
    }
    await Clipboard.setStringAsync(text);
    toast.success('已复制', '消息内容已复制到剪贴板');
  };
  const links = useMemo(
    () => !streaming && !collapsed && !system && entry.subtitle ? extractMessageLinks(entry.subtitle) : [],
    [collapsed, entry.subtitle, streaming, system],
  );
  const timeLabel = nowLabel(entry.at);

  // Compact progress / system rows (steps, thinking, tool calls).
  if (system) {
    const isWarning = pendingRequest !== undefined || /异常|失败|停止/.test(entry.title);
    return (
      <View className="mb-2 items-stretch px-1">
        <Pressable
          onPress={collapsible ? () => onToggleProgress?.(entry, collapsed) : undefined}
          onLongPress={copyText}
          delayLongPress={360}
          accessibilityRole={collapsible ? 'button' : undefined}
          className={`gap-1 rounded-2xl px-3 py-2.5 ${
            pendingRequest ? 'border border-warning/40 bg-warning/10' : isWarning ? 'bg-danger/10' : collapsible ? 'bg-surface-secondary' : 'bg-transparent'
          }`}
        >
          <View className="flex-row items-center gap-2">
            {collapsible ? (
              <StyledIonicons name={collapsed ? 'chevron-forward' : 'chevron-down'} size={13} className="text-muted" />
            ) : (
              <StyledIonicons
                name={pendingRequest ? 'shield-half-outline' : isWarning ? 'alert-circle-outline' : 'information-circle-outline'}
                size={14}
                className={pendingRequest ? 'text-warning' : isWarning ? 'text-danger' : 'text-muted'}
              />
            )}
            {!hideTitle ? (
              <Text type="body-xs" weight="semibold" className="min-w-0 flex-1 text-foreground" numberOfLines={1}>
                {entry.title}
              </Text>
            ) : (
              <View className="flex-1" />
            )}
            <Text type="body-xs" color="muted" numberOfLines={1}>
              {timeLabel}
            </Text>
          </View>
          {entry.subtitle ? (
            <Text
              selectable={!collapsed}
              type="body-xs"
              className={`${collapsed ? 'text-muted' : 'leading-5 text-foreground'} ${hideTitle ? '' : 'pl-5'}`}
              numberOfLines={collapsed ? 1 : undefined}
            >
              {entry.subtitle}
            </Text>
          ) : null}
          {pendingRequest ? <ApprovalActions request={pendingRequest} onApprovalResponse={onApprovalResponse} /> : null}
        </Pressable>
      </View>
    );
  }

  return (
    <View className={`mb-3 px-1 ${outgoing ? 'items-end' : 'items-start'}`}>
      <Pressable onLongPress={copyText} delayLongPress={360} className="max-w-[88%]">
        {outgoing ? (
          <View className="gap-1 rounded-3xl rounded-br-lg bg-accent px-4 py-2.5">
            <Text selectable type="body" className="leading-6 text-accent-foreground">
              {entry.subtitle}
            </Text>
            <Text type="body-xs" className="self-end text-accent-foreground/70">
              {timeLabel}
            </Text>
          </View>
        ) : (
          <Surface className="gap-1.5 rounded-3xl rounded-bl-lg px-4 py-3">
            {!hideTitle ? (
              <View className="flex-row items-center gap-2">
                <View className="h-5 w-5 items-center justify-center rounded-full bg-accent/15">
                  <StyledIonicons name="sparkles" size={11} className="text-accent" />
                </View>
                <Text type="body-xs" weight="semibold" className="min-w-0 flex-1 text-muted" numberOfLines={1}>
                  {entry.title}
                </Text>
                <Text type="body-xs" color="muted" numberOfLines={1}>
                  {timeLabel}
                </Text>
              </View>
            ) : null}
            {entry.subtitle ? (
              <Text selectable type="body" className="leading-6 text-foreground">
                {entry.subtitle}
              </Text>
            ) : null}
            {links.length > 0 ? (
              <View className="mt-1 flex-row flex-wrap gap-2">
                {links.map((href) => (
                  <Chip key={href} size="sm" variant="soft" color="accent" onPress={() => onOpenLink?.(href)} accessibilityLabel={`打开链接 ${href}`}>
                    <StyledIonicons name="open-outline" size={12} className="text-accent" />
                    <Chip.Label numberOfLines={1} className="max-w-[220px]">
                      {href}
                    </Chip.Label>
                  </Chip>
                ))}
              </View>
            ) : null}
          </Surface>
        )}
      </Pressable>
      {!outgoing ? (
        <View className="mt-1 flex-row items-center gap-0.5 pl-1">
          <Button isIconOnly size="sm" variant="ghost" onPress={() => void copyText()} accessibilityLabel="复制回复" className="h-8 w-8 rounded-full">
            <StyledIonicons name="copy-outline" size={14} className="text-muted" />
          </Button>
          {onFork ? (
            <Button isIconOnly size="sm" variant="ghost" onPress={onFork} accessibilityLabel="Fork 对话" className="h-8 w-8 rounded-full">
              <StyledIonicons name="git-branch-outline" size={14} className="text-muted" />
            </Button>
          ) : null}
          <Button isIconOnly size="sm" variant="ghost" onPress={() => setUsageVisible(true)} accessibilityLabel="查看回复统计" className="h-8 w-8 rounded-full">
            <StyledIonicons name="stats-chart-outline" size={14} className="text-muted" />
          </Button>
          <UsageDialog entry={entry} usage={usage} isOpen={usageVisible} onOpenChange={setUsageVisible} />
        </View>
      ) : null}
    </View>
  );
});

export const ExecutionGroupBubble = memo(function ExecutionGroupBubble({
  id,
  entries,
  collapsed,
  compactItems,
  expandedProgressIds,
  pendingRequestById,
  onToggleGroup,
  onToggleProgress,
  onApprovalResponse,
  onOpenLink,
}: {
  id: string;
  entries: TimelineEntry[];
  collapsed: boolean;
  compactItems: boolean;
  expandedProgressIds: Set<string>;
  pendingRequestById: Map<string, PendingRequest>;
  onToggleGroup: (id: string, collapsed: boolean) => void;
  onToggleProgress: (entry: TimelineEntry, collapsed: boolean) => void;
  onApprovalResponse?: (selection: boolean | PermissionOption, request: PendingRequest) => void;
  onOpenLink?: (href: string) => void;
}) {
  const latestEntry = entries[entries.length - 1];
  const summary = entries
    .map((entry) => entry.subtitle)
    .find(Boolean) ?? `${entries.length} 个执行`;
  const pendingCount = entries.filter((entry) => entry.requestId && pendingRequestById.has(entry.requestId)).length;

  return (
    <View className="mb-3 items-stretch px-1">
      <Surface variant="secondary" className="overflow-hidden rounded-2xl">
        <Pressable
          onPress={() => onToggleGroup(id, collapsed)}
          accessibilityRole="button"
          accessibilityState={{ expanded: !collapsed }}
          className="flex-row items-center gap-2.5 px-3 py-2.5"
        >
          <View className="h-7 w-7 items-center justify-center rounded-full bg-accent/15">
            <StyledIonicons name="terminal-outline" size={14} className="text-accent" />
          </View>
          <View className="min-w-0 flex-1">
            <Text type="body-sm" weight="semibold" className="text-foreground" numberOfLines={1}>
              {summary}
            </Text>
            <Text type="body-xs" color="muted" numberOfLines={1}>
              {entries.length} 个步骤{pendingCount > 0 ? ` · ${pendingCount} 个待审批` : ''}{latestEntry ? ` · ${nowLabel(latestEntry.at)}` : ''}
            </Text>
          </View>
          {pendingCount > 0 ? (
            <Chip size="sm" variant="soft" color="warning">
              <Chip.Label>待审批</Chip.Label>
            </Chip>
          ) : null}
          <StyledIonicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={16} className="text-muted" />
        </Pressable>
        {!collapsed ? (
          <View className="border-t border-separator px-2 pb-1 pt-2">
            <View className="border-l-2 border-separator pl-1">
              {entries.map((entry) => {
                const manuallyExpanded = expandedProgressIds.has(entry.id);
                const entryCollapsed = compactItems && !manuallyExpanded;
                return (
                  <MessageBubble
                    key={entry.id}
                    entry={entry}
                    collapsed={entryCollapsed}
                    collapsible
                    hideTitle
                    pendingRequest={entry.requestId ? pendingRequestById.get(entry.requestId) : undefined}
                    onToggleProgress={onToggleProgress}
                    onApprovalResponse={onApprovalResponse}
                    onOpenLink={onOpenLink}
                  />
                );
              })}
            </View>
          </View>
        ) : null}
      </Surface>
    </View>
  );
});

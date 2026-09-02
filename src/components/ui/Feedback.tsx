import type { ComponentProps, ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { Alert, Button, Chip, Spinner, Text, useToast } from 'heroui-native';
import { EmptyState } from 'heroui-native-pro';

import { StyledIonicons } from './StyledIonicons';

type IoniconName = ComponentProps<typeof StyledIonicons>['name'];
type NoticeStatus = 'default' | 'accent' | 'success' | 'warning' | 'danger';

/** Inline notice for errors, warnings and hints. */
export function InlineNotice({
  status = 'default',
  title,
  description,
  action,
  className = '',
}: {
  status?: NoticeStatus;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Alert status={status} className={`rounded-2xl ${className}`}>
      <Alert.Indicator />
      <Alert.Content className="min-w-0 flex-1">
        <Alert.Title>{title}</Alert.Title>
        {description ? <Alert.Description selectable>{description}</Alert.Description> : null}
        {action ? <View className="mt-2 flex-row">{action}</View> : null}
      </Alert.Content>
    </Alert>
  );
}

/** Centered empty state with optional icon and action. */
export function EmptyStateView({
  icon = 'file-tray-outline',
  title,
  description,
  actionLabel,
  onAction,
  className = '',
}: {
  icon?: IoniconName;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <EmptyState className={`py-10 ${className}`}>
      <EmptyState.Header>
        <EmptyState.Media variant="icon">
          <StyledIonicons name={icon} size={22} className="text-muted" />
        </EmptyState.Media>
        <EmptyState.Title>{title}</EmptyState.Title>
        {description ? <EmptyState.Description>{description}</EmptyState.Description> : null}
      </EmptyState.Header>
      {actionLabel && onAction ? (
        <EmptyState.Content>
          <Button variant="secondary" size="sm" onPress={onAction}>
            <Button.Label>{actionLabel}</Button.Label>
          </Button>
        </EmptyState.Content>
      ) : null}
    </EmptyState>
  );
}

/** Centered loading indicator with caption. */
export function LoadingState({ label = '加载中…', className = '' }: { label?: string; className?: string }) {
  return (
    <View className={`items-center justify-center gap-3 py-10 ${className}`}>
      <Spinner size="md" />
      <Text type="body-sm" color="muted">
        {label}
      </Text>
    </View>
  );
}

const CONNECTION_STATE_META: Record<string, { label: string; color: 'accent' | 'default' | 'success' | 'warning' | 'danger' }> = {
  open: { label: '已连接', color: 'success' },
  connecting: { label: '连接中', color: 'warning' },
  closed: { label: '已断开', color: 'default' },
  error: { label: '连接错误', color: 'danger' },
  idle: { label: '未连接', color: 'default' },
};

/** Compact chip describing the socket connection state. */
export function ConnectionChip({ state, size = 'sm' }: { state: string; size?: 'sm' | 'md' }) {
  const meta = CONNECTION_STATE_META[state] ?? { label: state, color: 'default' as const };
  return (
    <Chip size={size} variant="soft" color={meta.color}>
      <View className={`h-1.5 w-1.5 rounded-full ${meta.color === 'success' ? 'bg-success' : meta.color === 'warning' ? 'bg-warning' : meta.color === 'danger' ? 'bg-danger' : 'bg-muted'}`} />
      <Chip.Label>{meta.label}</Chip.Label>
    </Chip>
  );
}

/** Small typed helpers around the HeroUI toast manager. */
export function useAppToast() {
  const { toast } = useToast();
  const show = useCallback(
    (variant: 'default' | 'accent' | 'success' | 'warning' | 'danger', label: string, description?: string) => {
      toast.show({ variant, label, description, placement: 'bottom', duration: 2600 });
    },
    [toast],
  );
  return useMemo(
    () => ({
      info: (label: string, description?: string) => show('default', label, description),
      success: (label: string, description?: string) => show('success', label, description),
      warning: (label: string, description?: string) => show('warning', label, description),
      error: (label: string, description?: string) => show('danger', label, description),
    }),
    [show],
  );
}

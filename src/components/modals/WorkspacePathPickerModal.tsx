import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Surface, Text } from 'heroui-native';

import type { ConnectionSettings } from '../../lib/todex';
import { fetchWorkspaceDirectorySnapshot, type WorkspaceDirectorySnapshot } from '../../lib/appCore';
import { AppSheet, EmptyStateView, InlineNotice, ListRow, ListSection, LoadingState, StyledIonicons } from '../ui';

export function WorkspacePathPickerModal({
  visible,
  title,
  settings,
  rootHint,
  onSelect,
  onCancel,
}: {
  visible: boolean;
  title: string;
  settings: ConnectionSettings;
  rootHint: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
}) {
  const [snapshot, setSnapshot] = useState<WorkspaceDirectorySnapshot>({
    root: rootHint,
    current: rootHint,
    parent: null,
    entries: [],
  });
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const requestSeqRef = useRef(0);

  const loadPath = useCallback(
    async (path?: string) => {
      const requestSeq = requestSeqRef.current + 1;
      requestSeqRef.current = requestSeq;
      setStatus('loading');
      setError('');
      try {
        const next = await fetchWorkspaceDirectorySnapshot(settings, path);
        if (requestSeqRef.current !== requestSeq) {
          return;
        }
        setSnapshot(next);
        setStatus('ready');
      } catch (loadError) {
        if (requestSeqRef.current !== requestSeq) {
          return;
        }
        setStatus('error');
        setError(loadError instanceof Error ? loadError.message : '目录读取失败');
      }
    },
    [settings],
  );

  useEffect(() => {
    if (visible) {
      setSnapshot({
        root: rootHint,
        current: rootHint,
        parent: null,
        entries: [],
      });
      void loadPath();
    }
  }, [loadPath, rootHint, visible]);

  const isLoading = status === 'loading';
  const canUseParent = Boolean(snapshot.parent) && !isLoading;

  return (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={title}
      description={snapshot.root || rootHint || 'workspace root'}
      snapPoints={['70%', '92%']}
      footer={
        <Button
          variant="primary"
          size="lg"
          isDisabled={!snapshot.current || isLoading}
          onPress={() => snapshot.current && onSelect(snapshot.current)}
          className="rounded-xl"
        >
          <StyledIonicons name="checkmark" size={18} className="text-accent-foreground" />
          <Button.Label>选择当前目录</Button.Label>
        </Button>
      }
    >
      <View className="gap-3">
        <Surface variant="secondary" className="flex-row items-center gap-3 rounded-2xl px-4 py-3">
          <StyledIonicons name="folder-open" size={20} className="text-accent" />
          <Text selectable type="body-sm" weight="medium" className="min-w-0 flex-1 font-mono text-foreground" numberOfLines={2}>
            {snapshot.current || rootHint || '正在读取...'}
          </Text>
        </Surface>
        <View className="flex-row gap-2">
          <Button size="sm" variant="secondary" isDisabled={!canUseParent} onPress={() => snapshot.parent && void loadPath(snapshot.parent)} className="rounded-xl">
            <StyledIonicons name="arrow-up-outline" size={15} className="text-foreground" />
            <Button.Label>上级目录</Button.Label>
          </Button>
          <Button size="sm" variant="ghost" isDisabled={isLoading} onPress={() => void loadPath(snapshot.current || undefined)} className="rounded-xl">
            <StyledIonicons name="refresh-outline" size={15} className="text-foreground" />
            <Button.Label>刷新</Button.Label>
          </Button>
        </View>
        {isLoading ? <LoadingState label="正在读取目录" className="py-6" /> : null}
        {error ? <InlineNotice status="danger" title="目录读取失败" description={error} /> : null}
        {!isLoading && snapshot.entries.length === 0 ? (
          <EmptyStateView icon="folder-outline" title="没有子目录" description="当前目录下没有可选择的子目录。" />
        ) : null}
        {snapshot.entries.length > 0 ? (
          <ListSection variant="secondary">
            {snapshot.entries.map((entry) => (
              <ListRow
                key={entry.path}
                icon="folder-outline"
                iconClassName="bg-accent/15"
                iconColorClassName="text-accent"
                title={entry.name}
                description={entry.path}
                showChevron
                onPress={() => void loadPath(entry.path)}
              />
            ))}
          </ListSection>
        ) : null}
      </View>
    </AppSheet>
  );
}

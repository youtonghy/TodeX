import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, View, type ListRenderItemInfo } from 'react-native';
import { Button, Spinner, Surface, Text } from 'heroui-native';
import type { V2ApiClient } from '../lib/v2';
import { EmptyStateView, InlineNotice, LoadingState, StyledIonicons } from '../components/ui';

export type FilesClient = Pick<V2ApiClient, 'listWorkspaceEntries' | 'readWorkspaceFile'>;

export type FilesScreenProps = {
  client: FilesClient;
  rootPath: string;
  initialFilePath?: string;
  onFileSelected?: (path: string) => void;
  onPreview?: (path: string) => void;
};

type FileTreeEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file';
};

type FileTreeRow = {
  entry: FileTreeEntry;
  depth: number;
  expanded: boolean;
};

function normalizePath(value: string): string {
  const raw = value.trim().replace(/\\/g, '/');
  const prefix = raw.startsWith('/') ? '/' : '';
  const parts = raw.split('/').filter(Boolean);
  const normalized: string[] = [];
  parts.forEach((part) => {
    if (part === '.') return;
    if (part === '..') {
      normalized.pop();
      return;
    }
    normalized.push(part);
  });
  return `${prefix}${normalized.join('/')}` || prefix || '.';
}

function isWithinRoot(path: string, root: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(root).replace(/\/$/, '');
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function resolveEntryPath(root: string, entryPath: string): string {
  const normalizedRoot = normalizePath(root).replace(/\/$/, '');
  const raw = entryPath.trim().replace(/\\/g, '/');
  const candidate = raw === normalizedRoot || raw.startsWith(`${normalizedRoot}/`)
    ? normalizePath(raw)
    : normalizePath(`${normalizedRoot}/${raw.replace(/^\/+/, '')}`);
  return isWithinRoot(candidate, normalizedRoot) ? candidate : '';
}

function flattenRows(root: string, childrenByDirectory: Record<string, FileTreeEntry[]>, expanded: Set<string>): FileTreeRow[] {
  const rows: FileTreeRow[] = [];
  const visit = (directory: string, depth: number, ancestors: Set<string>) => {
    const children = childrenByDirectory[directory] || [];
    children.forEach((entry) => {
      const isExpanded = entry.kind === 'directory' && expanded.has(entry.path);
      rows.push({ entry, depth, expanded: isExpanded });
      if (isExpanded && !ancestors.has(entry.path)) {
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(entry.path);
        visit(entry.path, depth + 1, nextAncestors);
      }
    });
  };
  visit(root, 0, new Set([root]));
  return rows;
}

export function FilesScreen({ client, rootPath, initialFilePath, onFileSelected, onPreview }: FilesScreenProps) {
  const normalizedRoot = useMemo(() => normalizePath(rootPath), [rootPath]);
  const [childrenByDirectory, setChildrenByDirectory] = useState<Record<string, FileTreeEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([normalizedRoot]));
  const selectedPath = initialFilePath || '';
  const [loadingPath, setLoadingPath] = useState('');
  const [error, setError] = useState('');
  const requestSeqRef = useRef(0);
  useEffect(() => () => { requestSeqRef.current += 1; }, []);
  const childrenByDirectoryRef = useRef<Record<string, FileTreeEntry[]>>({});

  const loadDirectory = useCallback(async (directory: string, force = false) => {
    if (!normalizedRoot || normalizedRoot === '.') return;
    if (!force && Object.prototype.hasOwnProperty.call(childrenByDirectoryRef.current, directory)) {
      setExpanded(current => new Set([...current, directory]));
      return;
    }
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    setLoadingPath(directory);
    setError('');
    try {
      const snapshot = await client.listWorkspaceEntries(directory, '', 100);
      if (requestSeqRef.current !== requestSeq) return;
      const entries = snapshot.entries
        .map((entry) => {
          const kind = entry.kind === 'directory' || entry.kind === 'file' ? entry.kind : null;
          if (!kind) return null;
          return {
            name: entry.name,
            path: resolveEntryPath(directory, entry.path),
            kind,
          } satisfies FileTreeEntry;
        })
        .filter((entry): entry is FileTreeEntry => Boolean(entry))
        .sort((left, right) => Number(right.kind === 'directory') - Number(left.kind === 'directory') || left.name.localeCompare(right.name));
      setChildrenByDirectory((current) => {
        const next = { ...current, [directory]: entries };
        childrenByDirectoryRef.current = next;
        return next;
      });
      setExpanded((current) => new Set([...current, directory]));
    } catch (reason) {
      if (requestSeqRef.current === requestSeq) setError(reason instanceof Error ? reason.message : '目录读取失败');
    } finally {
      if (requestSeqRef.current === requestSeq) setLoadingPath('');
    }
  }, [client, normalizedRoot]);

  useEffect(() => {
    requestSeqRef.current += 1;

    childrenByDirectoryRef.current = {};
    setChildrenByDirectory({});
    setExpanded(new Set([normalizedRoot]));
    setError('');
    void loadDirectory(normalizedRoot, true);
  }, [loadDirectory, normalizedRoot]);

  const toggleDirectory = (directory: string) => {
    if (expanded.has(directory)) {
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(directory);
        return next;
      });
      return;
    }
    void loadDirectory(directory);
  };

  const rows = useMemo(
    () => flattenRows(normalizedRoot, childrenByDirectory, expanded),
    [childrenByDirectory, expanded, normalizedRoot],
  );

  const renderRow = ({ item }: ListRenderItemInfo<FileTreeRow>) => {
    const isDirectory = item.entry.kind === 'directory';
    const isSelected = item.entry.path === selectedPath;
    const isLoading = loadingPath === item.entry.path;
    return (
      <View className="flex-row items-center">
        <Button variant="ghost"
          accessibilityRole="button"
          accessibilityLabel={`${isDirectory ? '目录' : '文件'} ${item.entry.name}`}
          accessibilityState={{ selected: isSelected, expanded: isDirectory ? item.expanded : undefined }}
          onPress={() => (isDirectory ? toggleDirectory(item.entry.path) : onFileSelected?.(item.entry.path))}
          className={`min-h-11 flex-row items-center gap-2 rounded-xl pr-3 active:opacity-70 ${isSelected ? 'bg-accent/15' : ''} flex-1 justify-start`}
          style={{ paddingLeft: 10 + item.depth * 18 }}
        >
          <StyledIonicons
            name={isDirectory ? (item.expanded ? 'folder-open' : 'folder') : 'document-text-outline'}
            size={17}
            className={isDirectory ? 'text-warning' : isSelected ? 'text-accent' : 'text-muted'}
          />
          <Text type="body-sm" weight={isSelected ? 'semibold' : 'medium'} className={`flex-1 ${isSelected ? 'text-accent' : 'text-foreground'}`} numberOfLines={1}>
            {item.entry.name}
          </Text>
          {isLoading ? (
            <Spinner size="sm" />
          ) : isDirectory ? (
            <StyledIonicons name={item.expanded ? 'chevron-down' : 'chevron-forward'} size={14} className="text-muted" />
          ) : null}
        </Button>
        {!isDirectory && onPreview ? <Button isIconOnly size="sm" variant="ghost" accessibilityLabel={`预览 ${item.entry.name}`} onPress={() => onPreview(item.entry.path)}><StyledIonicons name="eye-outline" size={18} className="text-muted" /></Button> : null}
      </View>
    );
  };

  const treeSurface = (
    <Surface
      variant="secondary"
      className="mx-4 mb-4 flex-1 overflow-hidden rounded-3xl"
    >
      <FlatList
        data={rows}
        keyExtractor={(item) => item.entry.path}
        renderItem={renderRow}
        refreshControl={<RefreshControl refreshing={Boolean(loadingPath === normalizedRoot)} onRefresh={() => void loadDirectory(normalizedRoot, true)} />}
        ListEmptyComponent={
          loadingPath ? (
            <LoadingState label="正在读取目录…" className="py-6" />
          ) : (
            <EmptyStateView icon="folder-outline" title="目录为空" description="当前目录没有可显示的文件。" className="py-6" />
          )
        }
        contentContainerClassName="p-2"
      />
    </Surface>
  );

  return (
    <View className="flex-1 bg-background">
      <View className="gap-2 px-4 pb-2 pt-3">
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text type="h4" className="text-foreground">
              查看
            </Text>
            <Text type="body-xs" color="muted" numberOfLines={2} className="font-mono">
              {normalizedRoot || '未选择工作区'}
            </Text>
          </View>
          <Button
            isIconOnly
            size="sm"
            variant="secondary"
            accessibilityLabel="刷新文件树"
            isDisabled={!normalizedRoot || Boolean(loadingPath)}
            onPress={() => void loadDirectory(normalizedRoot, true)}
            className="h-9 w-9 rounded-full"
          >
            <StyledIonicons name="refresh-outline" size={16} className="text-foreground" />
          </Button>
        </View>
        {error ? <InlineNotice status="danger" title="读取失败" description={error} /> : null}
      </View>

      <View className="min-h-0 flex-1">
        {treeSurface}
      </View>
    </View>
  );
}

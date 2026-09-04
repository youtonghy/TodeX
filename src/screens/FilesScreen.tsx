import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View, type ListRenderItemInfo } from 'react-native';
import { Button, Chip, Spinner, Surface, Text } from 'heroui-native';
import type { V2ApiClient } from '../lib/v2';
import { EmptyStateView, InlineNotice, LoadingState, Screen, StyledIonicons, useResponsive } from '../components/ui';

export type FilesClient = Pick<V2ApiClient, 'listWorkspaceEntries' | 'readWorkspaceFile'>;

export type FilesScreenProps = {
  client: FilesClient;
  rootPath: string;
  initialFilePath?: string;
  onFileSelected?: (path: string) => void;
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

type LoadedFile = {
  name: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  text?: string;
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

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 1024) return `${Math.max(0, Math.round(value || 0))} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function fileLanguage(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() || '';
  const aliases: Record<string, string> = {
    js: 'JavaScript',
    jsx: 'JSX',
    ts: 'TypeScript',
    tsx: 'TSX',
    md: 'Markdown',
    mdx: 'MDX',
    json: 'JSON',
    yaml: 'YAML',
    yml: 'YAML',
    rs: 'Rust',
    py: 'Python',
    go: 'Go',
    sh: 'Shell',
  };
  return aliases[extension] || extension.toUpperCase() || 'TEXT';
}

export function FilesScreen({ client, rootPath, initialFilePath, onFileSelected }: FilesScreenProps) {
  const { isLandscapeOrWide } = useResponsive();
  const normalizedRoot = useMemo(() => normalizePath(rootPath), [rootPath]);
  const [childrenByDirectory, setChildrenByDirectory] = useState<Record<string, FileTreeEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([normalizedRoot]));
  const [selectedPath, setSelectedPath] = useState('');
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [loadingPath, setLoadingPath] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState('');
  const requestSeqRef = useRef(0);
  const appliedTargetRef = useRef('');
  const childrenByDirectoryRef = useRef<Record<string, FileTreeEntry[]>>({});
  const onFileSelectedRef = useRef(onFileSelected);
  onFileSelectedRef.current = onFileSelected;

  const loadDirectory = useCallback(async (directory: string, force = false) => {
    if (!normalizedRoot || normalizedRoot === '.') return;
    if (!force && Object.prototype.hasOwnProperty.call(childrenByDirectoryRef.current, directory)) return;
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
    appliedTargetRef.current = '';
    childrenByDirectoryRef.current = {};
    setChildrenByDirectory({});
    setExpanded(new Set([normalizedRoot]));
    setSelectedPath('');
    setFile(null);
    setError('');
    void loadDirectory(normalizedRoot, true);
  }, [loadDirectory, normalizedRoot]);

  const readFile = useCallback(async (path: string) => {
    if (!isWithinRoot(path, normalizedRoot)) {
      setError('文件路径不在当前工作区内');
      return;
    }
    setSelectedPath(path);
    setFileLoading(true);
    setError('');
    try {
      const loaded = await client.readWorkspaceFile(path);
      setFile(loaded);
      onFileSelectedRef.current?.(path);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '文件读取失败');
    } finally {
      setFileLoading(false);
    }
  }, [client, normalizedRoot]);

  useEffect(() => {
    if (!initialFilePath || appliedTargetRef.current === initialFilePath) return;
    appliedTargetRef.current = initialFilePath;
    void readFile(initialFilePath);
  }, [initialFilePath, readFile]);

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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${isDirectory ? '目录' : '文件'} ${item.entry.name}`}
        accessibilityState={{ selected: isSelected, expanded: isDirectory ? item.expanded : undefined }}
        onPress={() => (isDirectory ? toggleDirectory(item.entry.path) : void readFile(item.entry.path))}
        className={`min-h-11 flex-row items-center gap-2 rounded-xl pr-3 active:opacity-70 ${isSelected ? 'bg-accent/15' : ''}`}
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
      </Pressable>
    );
  };

  const treeSurface = (
    <Surface
      variant="secondary"
      className={`${isLandscapeOrWide ? 'w-80 lg:w-96 h-full' : 'mx-4 max-h-[300px]'} overflow-hidden rounded-3xl`}
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

  const previewSurface = (
    <Surface
      className={`${isLandscapeOrWide ? 'flex-1 h-full mb-0 mt-0 mx-0' : 'mx-4 mb-4 mt-3 min-h-[160px] flex-1'} overflow-hidden rounded-3xl`}
    >
      <View className="flex-row items-center justify-between gap-3 border-b border-separator px-4 py-2.5">
        <View className="min-w-0 flex-1 flex-row items-center gap-2">
          <StyledIonicons name="document-text-outline" size={16} className="text-muted" />
          <Text type="body-sm" weight="semibold" className="min-w-0 flex-1 text-foreground" numberOfLines={1}>
            {file?.name || '选择文件预览'}
          </Text>
        </View>
        {file ? (
          <Chip size="sm" variant="soft" color="accent">
            <Chip.Label>{fileLanguage(file.path)}</Chip.Label>
          </Chip>
        ) : null}
      </View>
      {fileLoading ? (
        <LoadingState label="正在读取文件" className="flex-1" />
      ) : file ? (
        <ScrollView contentContainerClassName="p-4 pb-8">
          <Text type="body-xs" color="muted" numberOfLines={2} className="mb-3 font-mono">
            {file.path} · {formatBytes(file.sizeBytes)} · {file.mimeType}
          </Text>
          {file.text ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text selectable type="code" className="bg-transparent px-0 text-[12px] leading-[18px] text-foreground">
                {file.text}
              </Text>
            </ScrollView>
          ) : (
            <InlineNotice status="default" title="该文件不可作为文本预览。" />
          )}
        </ScrollView>
      ) : (
        <EmptyStateView icon="document-text-outline" title="选择一个文件查看内容" className="flex-1 justify-center" />
      )}
    </Surface>
  );

  return (
    <Screen>
      <View className="gap-2 px-4 pb-2 pt-3">
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text type="h4" className="text-foreground">
              文件
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

      {isLandscapeOrWide ? (
        <View className="flex-1 flex-row gap-4 px-4 pb-4">
          {treeSurface}
          {previewSurface}
        </View>
      ) : (
        <>
          {treeSurface}
          {previewSurface}
        </>
      )}
    </Screen>
  );
}

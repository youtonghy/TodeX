import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { Button, Card, Chip, Surface, Text as HeroText } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';
import type { V2ApiClient } from '../lib/v2';

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
          const path = resolveEntryPath(normalizedRoot, entry.path);
          return path ? { name: entry.name, path, kind: entry.kind } : null;
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
      setFile(null);
      setError(reason instanceof Error ? reason.message : '文件读取失败');
    } finally {
      setFileLoading(false);
    }
  }, [client, normalizedRoot]);

  useEffect(() => {
    if (!initialFilePath || initialFilePath === appliedTargetRef.current) return;
    const path = normalizePath(initialFilePath);
    if (!isWithinRoot(path, normalizedRoot)) {
      setError('目标文件不在当前工作区内');
      appliedTargetRef.current = initialFilePath;
      return;
    }
    appliedTargetRef.current = initialFilePath;
    void readFile(path);
  }, [initialFilePath, normalizedRoot, readFile]);

  const rows = useMemo(() => flattenRows(normalizedRoot, childrenByDirectory, expanded), [childrenByDirectory, expanded, normalizedRoot]);

  const toggleDirectory = (path: string) => {
    if (expanded.has(path)) {
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
      return;
    }
    setExpanded((current) => new Set([...current, path]));
    if (!Object.prototype.hasOwnProperty.call(childrenByDirectoryRef.current, path)) void loadDirectory(path);
  };

  const renderRow = ({ item }: ListRenderItemInfo<FileTreeRow>) => {
    const isSelected = item.entry.path === selectedPath;
    const isLoading = loadingPath === item.entry.path;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.entry.kind === 'directory' ? '目录' : '文件'} ${item.entry.name}`}
        onPress={() => item.entry.kind === 'directory' ? toggleDirectory(item.entry.path) : void readFile(item.entry.path)}
        style={({ pressed }) => [styles.treeRow, { paddingLeft: 12 + item.depth * 18 }, isSelected && styles.treeRowSelected, pressed && styles.treeRowPressed]}
      >
        <Ionicons name={item.entry.kind === 'directory' ? (item.expanded ? 'folder-open-outline' : 'folder-outline') : 'document-text-outline'} size={17} color={item.entry.kind === 'directory' ? '#b27b2b' : '#66717c'} />
        <Text style={styles.treeName} numberOfLines={1}>{item.entry.name}</Text>
        {isLoading ? <ActivityIndicator size="small" /> : item.entry.kind === 'directory' ? <Ionicons name={item.expanded ? 'chevron-down' : 'chevron-forward'} size={15} color="#7a8391" /> : null}
      </Pressable>
    );
  };

  return (
    <Surface className="flex-1 bg-background">
      <View className="px-4 pb-2 pt-4">
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <HeroText className="text-xl font-semibold text-foreground">文件</HeroText>
            <HeroText className="mt-1 text-xs text-muted" numberOfLines={2}>{normalizedRoot || '未选择工作区'}</HeroText>
          </View>
          <Button isIconOnly size="sm" variant="ghost" accessibilityLabel="刷新文件树" isDisabled={!normalizedRoot || Boolean(loadingPath)} onPress={() => void loadDirectory(normalizedRoot, true)}>
            <Ionicons name="refresh-outline" size={18} color="#52606b" />
          </Button>
        </View>
        {error ? <HeroText className="mt-2 text-xs text-danger" numberOfLines={3}>{error}</HeroText> : null}
      </View>
      <View style={styles.treePane}>
        <FlatList
          data={rows}
          keyExtractor={(item) => item.entry.path}
          renderItem={renderRow}
          refreshControl={<RefreshControl refreshing={Boolean(loadingPath === normalizedRoot)} onRefresh={() => void loadDirectory(normalizedRoot, true)} />}
          ListEmptyComponent={<HeroText className="px-4 py-8 text-center text-xs text-muted">{loadingPath ? '正在读取目录…' : '当前目录没有可显示的文件。'}</HeroText>}
          contentContainerStyle={styles.treeContent}
        />
      </View>
      <View style={styles.previewPane}>
        <View className="flex-row items-center justify-between gap-3 border-b border-separator px-4 py-3">
          <HeroText className="min-w-0 flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>{file?.name || '选择文件预览'}</HeroText>
          {file ? <Chip size="sm" variant="secondary"><Text>{fileLanguage(file.path)}</Text></Chip> : null}
        </View>
        {fileLoading ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator /><HeroText className="mt-2 text-xs text-muted">正在读取文件</HeroText></View>
        ) : file ? (
          <ScrollView contentContainerStyle={styles.previewContent}>
            <HeroText className="mb-3 text-[11px] text-muted" numberOfLines={2}>{file.path} · {formatBytes(file.sizeBytes)} · {file.mimeType}</HeroText>
            {file.text ? <Text selectable style={styles.previewText}>{file.text}</Text> : <HeroText className="text-sm text-muted">该文件不可作为文本预览。</HeroText>}
          </ScrollView>
        ) : (
          <View className="flex-1 items-center justify-center px-8"><Ionicons name="document-text-outline" size={28} color="#7a8391" /><HeroText className="mt-3 text-center text-sm text-muted">选择一个文件查看内容</HeroText></View>
        )}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  treePane: { maxHeight: 300, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#d8e0e7', backgroundColor: '#f7f9fa' },
  treeContent: { paddingVertical: 6 },
  treeRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 12 },
  treeRowSelected: { backgroundColor: '#e2f4ef' },
  treeRowPressed: { opacity: 0.72 },
  treeName: { flex: 1, color: '#26323d', fontSize: 13, fontWeight: '600' },
  previewPane: { flex: 1, minHeight: 160 },
  previewContent: { padding: 16, paddingBottom: 32 },
  previewText: { color: '#26323d', fontFamily: 'Courier', fontSize: 12, lineHeight: 18 },
});

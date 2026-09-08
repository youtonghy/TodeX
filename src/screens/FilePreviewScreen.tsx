import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Text } from 'heroui-native';
import { MarkdownViewer } from '../components/MarkdownViewer';
import { EmptyStateView, InlineNotice, LoadingState, StyledIonicons } from '../components/ui';
import type { FilesClient } from './FilesScreen';

export function FilePreviewScreen({ client, path, visible = true, onEdit }: { client: FilesClient; path?: string; visible?: boolean; onEdit: (path: string) => void }) {
  const [file, setFile] = useState<Awaited<ReturnType<FilesClient['readWorkspaceFile']>> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setFile(null); setError('');
    if (!path) { setLoading(false); return; }
    setLoading(true);
    void client.readWorkspaceFile(path).then(value => { if (!cancelled) setFile(value); })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '文件读取失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, path, visible, revision]);
  return <View className="flex-1 bg-background">
    <View className="flex-row items-center gap-2 border-b border-separator px-3 py-2">
      <Text className="min-w-0 flex-1" numberOfLines={2}>{path || '文件预览'}</Text>
      <Button isIconOnly variant="ghost" accessibilityLabel="刷新文件预览" isDisabled={!path || loading} onPress={() => setRevision(value => value + 1)}><StyledIonicons name="refresh-outline" size={18} /></Button>
      <Button size="sm" variant="secondary" isDisabled={!path} onPress={() => path && onEdit(path)}><Button.Label>编辑</Button.Label></Button>
    </View>
    {loading ? <LoadingState label="正在读取文件…" /> : error ? <InlineNotice status="danger" title="读取失败" description={error} /> : !file ? <EmptyStateView icon="document-text-outline" title="选择文件预览" description="在查看标签中点击文件旁的预览按钮。" className="flex-1 justify-center" /> : typeof file.text !== 'string' ? <EmptyStateView icon="document-outline" title="此文件暂不支持预览" /> : /\.(md|markdown)$/i.test(file.path) ? <MarkdownViewer content={file.text} /> : <ScrollView contentContainerClassName="p-4"><ScrollView horizontal><Text selectable type="code" className="bg-transparent text-xs">{file.text}</Text></ScrollView></ScrollView>}
  </View>;
}

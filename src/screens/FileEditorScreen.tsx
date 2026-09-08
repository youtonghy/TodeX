import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { Button, Input, Text, useToast } from 'heroui-native';
import { EmptyStateView, InlineNotice, LoadingState } from '../components/ui';
import type { V2ApiClient } from '../lib/v2';

export function FileEditorScreen({ client, path, onDirtyChange }: { client: Pick<V2ApiClient, 'readWorkspaceFile' | 'saveWorkspaceFile'>; path: string; onDirtyChange: (dirty: boolean) => void }) {
  const [original, setOriginal] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useToast();
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setOriginal(null); setDraft(''); setError('');
    void client.readWorkspaceFile(path).then(file => {
      if (cancelled) return;
      setOriginal(file.text ?? null); setDraft(file.text ?? '');
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '文件读取失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, path]);
  const dirty = original !== null && draft !== original;
  useEffect(() => { onDirtyChange(dirty || saving); }, [dirty, saving, onDirtyChange]);
  const save = async () => {
    if (original === null || saving) return;
    setSaving(true);
    const content = draft;
    try {
      await client.saveWorkspaceFile(path, content, original);
      setOriginal(content);
      toast.show({ variant: 'success', label: '文件已保存', placement: 'top', duration: 2500 });
    } catch (reason) {
      toast.show({ variant: 'danger', label: '保存失败', description: reason instanceof Error ? reason.message : '请稍后重试', placement: 'top', duration: 4000 });
    } finally { setSaving(false); }
  };
  return <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View className="flex-row items-center gap-3 border-b border-separator p-3">
      <View className="min-w-0 flex-1"><Text numberOfLines={2} type="body-sm">{path}</Text><Text type="body-xs" color="muted">{dirty ? '尚未保存' : '文件编辑器'}</Text></View>
      <Button size="sm" isDisabled={!dirty || saving || loading} onPress={() => void save()}><Button.Label>{saving ? '保存中…' : '保存'}</Button.Label></Button>
    </View>
    {loading ? <LoadingState label="正在读取文件…" /> : error ? <InlineNotice status="danger" title="读取失败" description={error} /> : original === null ? <EmptyStateView icon="document-outline" title="此文件暂不支持文本编辑" /> : <Input multiline value={draft} onChangeText={setDraft} editable={!saving} accessibilityLabel="文件内容" autoCapitalize="none" autoCorrect={false} spellCheck={false} textAlignVertical="top" containerClassName="flex-1" className="flex-1 rounded-none bg-background p-4 font-mono text-sm" />}
  </KeyboardAvoidingView>;
}

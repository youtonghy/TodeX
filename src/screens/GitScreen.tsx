import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Button, Card, Chip, Surface, Text as HeroText } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';
import type { GitAction, GitRepositorySummary, V2ApiClient } from '../lib/v2';

export type GitClient = Pick<V2ApiClient, 'scanGit' | 'runGit'>;

export type GitScreenProps = {
  client: GitClient;
  workspacePath: string;
  repositories: GitRepositorySummary[];
  status?: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  output?: string;
  actionBusy?: boolean;
  onRefresh: (workspacePath?: string) => Promise<boolean>;
  onRun: (workspacePath: string, action: GitAction, message?: string, includeUnstaged?: boolean) => Promise<boolean>;
};

function formatChangeCount(value: number): string {
  return Number.isFinite(value) ? String(Math.max(0, Math.round(value))) : '0';
}

function actionLabel(action: GitAction): string {
  switch (action) {
    case 'initial': return '初始化仓库';
    case 'commit-push': return '提交并推送';
    case 'push': return '推送';
    default: return '创建提交';
  }
}

export function GitScreen({
  client: _client,
  workspacePath,
  repositories,
  status = 'idle',
  error = '',
  output = '',
  actionBusy = false,
  onRefresh,
  onRun,
}: GitScreenProps) {
  const [activeRepoPath, setActiveRepoPath] = useState('');
  const [message, setMessage] = useState('');
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [localActionBusy, setLocalActionBusy] = useState(false);
  const localActionBusyRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const activeRepo = useMemo(
    () => repositories.find((repository) => repository.path === activeRepoPath)
      ?? repositories.find((repository) => repository.files.length > 0)
      ?? repositories[0]
      ?? null,
    [activeRepoPath, repositories],
  );
  const busy = status === 'loading' || actionBusy || localActionBusy;

  useEffect(() => {
    setActiveRepoPath((current) => repositories.some((repository) => repository.path === current)
      ? current
      : repositories.find((repository) => repository.files.length > 0)?.path ?? repositories[0]?.path ?? '');
  }, [repositories]);

  useEffect(() => {
    if (workspacePath) void onRefreshRef.current(workspacePath);
  }, [workspacePath]);

  const refresh = () => {
    if (busy || localActionBusyRef.current) return;
    void onRefresh(workspacePath);
  };

  const run = (action: GitAction) => {
    if (!activeRepo || busy || localActionBusyRef.current) return;
    localActionBusyRef.current = true;
    setLocalActionBusy(true);
    void onRun(activeRepo.path, action, message, includeUnstaged)
      .then((ok) => {
        if (ok && action !== 'push') setMessage('');
      })
      .finally(() => {
        localActionBusyRef.current = false;
        setLocalActionBusy(false);
      });
  };

  return (
    <Surface className="flex-1 bg-background">
      <View className="px-4 pb-2 pt-4">
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <View className="flex-row items-center gap-2">
              <Ionicons name="logo-github" size={20} color="#52606b" />
              <HeroText className="text-xl font-semibold text-foreground">Git 操作</HeroText>
            </View>
            <HeroText className="mt-1 text-xs text-muted" numberOfLines={2}>{workspacePath || '未选择工作区'}</HeroText>
          </View>
          <Button isIconOnly size="sm" variant="ghost" accessibilityLabel="刷新 Git 状态" isDisabled={busy} onPress={refresh}>
            {busy ? <ActivityIndicator size="small" /> : <Ionicons name="refresh-outline" size={18} color="#52606b" />}
          </Button>
        </View>
        {error ? <HeroText className="mt-2 text-xs text-danger" numberOfLines={4}>{error}</HeroText> : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} />}
        keyboardShouldPersistTaps="handled"
      >
        {repositories.length > 1 ? (
          <View className="mb-3">
            <HeroText className="mb-2 px-1 text-xs font-semibold text-muted">仓库</HeroText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.repoRail}>
              {repositories.map((repository) => (
                <Button
                  key={repository.path}
                  size="sm"
                  variant={activeRepo?.path === repository.path ? 'primary' : 'secondary'}
                  isDisabled={busy}
                  onPress={() => setActiveRepoPath(repository.path)}
                  className="min-h-11 max-w-[240px] rounded-lg"
                >
                  <Button.Label numberOfLines={1}>{repository.name} · {repository.branch || '未初始化'}</Button.Label>
                </Button>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {activeRepo ? (
          <>
            <Card variant="transparent" className="mb-3 border border-separator bg-surface px-3 py-3">
              <View className="flex-row items-center justify-between gap-3">
                <View className="min-w-0 flex-1">
                  <HeroText className="text-base font-semibold text-foreground" numberOfLines={1}>{activeRepo.name}</HeroText>
                  <HeroText className="mt-1 text-xs text-muted" numberOfLines={1}>{activeRepo.branch || 'UNINITIALIZED'}</HeroText>
                </View>
                <Chip size="sm" variant={activeRepo.initialEligible ? 'primary' : 'secondary'}>
                  {activeRepo.initialEligible ? '未初始化' : `${activeRepo.files.length} 个文件`}
                </Chip>
              </View>
              <View className="mt-3 flex-row gap-3">
                <Surface variant="secondary" className="flex-1 rounded-lg px-3 py-2">
                  <HeroText className="text-xs text-muted">新增</HeroText>
                  <HeroText className="mt-1 text-lg font-semibold text-success">+{formatChangeCount(activeRepo.additions)}</HeroText>
                </Surface>
                <Surface variant="secondary" className="flex-1 rounded-lg px-3 py-2">
                  <HeroText className="text-xs text-muted">删除</HeroText>
                  <HeroText className="mt-1 text-lg font-semibold text-danger">-{formatChangeCount(activeRepo.deletions)}</HeroText>
                </Surface>
              </View>
            </Card>

            {activeRepo.files.length > 0 ? (
              <Card variant="transparent" className="mb-3 border border-separator bg-surface-secondary px-3 py-2">
                <HeroText className="mb-2 text-xs font-semibold text-muted">变更文件</HeroText>
                {activeRepo.files.slice(0, 80).map((file) => (
                  <View key={file.path} style={styles.fileRow}>
                    <Ionicons name="document-text-outline" size={16} color="#66717c" />
                    <Text style={styles.filePath} numberOfLines={1}>{file.path}</Text>
                    <Text style={styles.fileStatus}>{file.status.trim() || '--'}</Text>
                  </View>
                ))}
                {activeRepo.files.length > 80 ? <HeroText className="px-1 py-2 text-[11px] text-muted">还有 {activeRepo.files.length - 80} 个文件未显示</HeroText> : null}
              </Card>
            ) : null}

            <Card variant="transparent" className="mb-3 border border-separator bg-surface px-3 py-3">
              <HeroText className="mb-2 text-sm font-semibold text-foreground">提交</HeroText>
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder="提交信息（留空将自动生成）"
                placeholderTextColor="#7a8391"
                multiline
                editable={!busy}
                style={styles.messageInput}
              />
              <View className="mt-3 min-h-11 flex-row items-center justify-between rounded-lg bg-surface-secondary px-3">
                <View className="flex-row items-center gap-2">
                  <Ionicons name="layers-outline" size={17} color="#52606b" />
                  <HeroText className="text-sm text-foreground">包含未暂存的更改</HeroText>
                </View>
                <Switch disabled={busy} value={includeUnstaged} onValueChange={setIncludeUnstaged} />
              </View>
              <View className="mt-3 gap-2">
                <Button size="lg" variant="primary" isDisabled={busy} onPress={() => run(activeRepo.initialEligible ? 'initial' : 'commit')} className="min-h-12 justify-start rounded-lg">
                  <Ionicons name="git-commit-outline" size={18} color="#ffffff" />
                  <Button.Label>{actionLabel(activeRepo.initialEligible ? 'initial' : 'commit')}</Button.Label>
                </Button>
                <Button size="lg" variant="secondary" isDisabled={busy || activeRepo.initialEligible} onPress={() => run('commit-push')} className="min-h-12 justify-start rounded-lg">
                  <Ionicons name="cloud-upload-outline" size={18} color="#52606b" />
                  <Button.Label>{actionLabel('commit-push')}</Button.Label>
                </Button>
                <Button size="lg" variant="ghost" isDisabled={busy || activeRepo.initialEligible} onPress={() => run('push')} className="min-h-12 justify-start rounded-lg">
                  <Ionicons name="arrow-up-circle-outline" size={18} color="#52606b" />
                  <Button.Label>{actionLabel('push')}</Button.Label>
                </Button>
              </View>
            </Card>
          </>
        ) : (
          <View className="items-center px-8 py-12">
            <Ionicons name="git-branch-outline" size={34} color="#7a8391" />
            <HeroText className="mt-3 text-sm font-semibold text-foreground">没有检测到 Git 仓库</HeroText>
            <HeroText className="mt-1 text-center text-xs text-muted">请确认工作区路径可访问，或下拉刷新。</HeroText>
          </View>
        )}
        {output ? (
          <Card variant="transparent" className="border border-separator bg-surface-secondary px-3 py-3">
            <HeroText className="text-xs font-semibold text-muted">最近一次 Git 输出</HeroText>
            <Text selectable style={styles.output}>{output}</Text>
          </Card>
        ) : null}
      </ScrollView>
    </Surface>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  repoRail: { gap: 8, paddingBottom: 2 },
  fileRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#d8e0e7' },
  filePath: { flex: 1, minWidth: 0, color: '#26323d', fontSize: 12 },
  fileStatus: { minWidth: 24, color: '#66717c', fontSize: 11, fontVariant: ['tabular-nums'], textAlign: 'right' },
  messageInput: { minHeight: 88, maxHeight: 150, borderWidth: 1, borderColor: '#d7dce0', borderRadius: 8, backgroundColor: '#ffffff', paddingHorizontal: 12, paddingVertical: 10, color: '#17202a', fontSize: 14, textAlignVertical: 'top' },
  output: { marginTop: 8, color: '#26323d', fontFamily: 'Courier', fontSize: 11, lineHeight: 17 },
});

import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Button, Chip, Spinner, Surface, Switch, Text } from 'heroui-native';
import { NumberValue } from 'heroui-native-pro';

import type { GitAction, GitRepositorySummary, V2ApiClient } from '../lib/v2';
import {
  EmptyStateView,
  FormTextArea,
  InlineNotice,
  ListRow,
  ListSection,
  Screen,
  ScreenScrollView,
  SectionHeader,
  StyledIonicons,
} from '../components/ui';

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

function formatChangeCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function actionLabel(action: GitAction): string {
  switch (action) {
    case 'initial': return '初始化仓库';
    case 'commit-push': return '提交并推送';
    case 'push': return '推送';
    default: return '创建提交';
  }
}

function fileStatusColor(status: string): 'success' | 'warning' | 'danger' | 'default' {
  const code = status.trim().toUpperCase();
  if (code.startsWith('A') || code.startsWith('??')) return 'success';
  if (code.startsWith('D')) return 'danger';
  if (code.startsWith('M') || code.startsWith('R')) return 'warning';
  return 'default';
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
    <Screen>
      <View className="gap-2 px-4 pb-1 pt-3">
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text type="h4" className="text-foreground">
              Git 操作
            </Text>
            <Text type="body-xs" color="muted" numberOfLines={2} className="font-mono">
              {workspacePath || '未选择工作区'}
            </Text>
          </View>
          <Button isIconOnly size="sm" variant="secondary" accessibilityLabel="刷新 Git 状态" isDisabled={busy} onPress={refresh} className="h-9 w-9 rounded-full">
            {busy ? <Spinner size="sm" /> : <StyledIonicons name="refresh-outline" size={16} className="text-foreground" />}
          </Button>
        </View>
        {error ? <InlineNotice status="danger" title="Git 读取失败" description={error} /> : null}
      </View>

      <ScreenScrollView
        refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} />}
      >
        {repositories.length > 1 ? (
          <View className="gap-2">
            <SectionHeader title="仓库" description={`${repositories.length} 个`} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
              {repositories.map((repository) => {
                const selected = activeRepo?.path === repository.path;
                return (
                  <Chip
                    key={repository.path}
                    size="md"
                    variant={selected ? 'primary' : 'soft'}
                    color={selected ? 'accent' : 'default'}
                    onPress={() => setActiveRepoPath(repository.path)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Chip.Label numberOfLines={1} className="max-w-[220px]">
                      {repository.name} · {repository.branch || '未初始化'}
                    </Chip.Label>
                  </Chip>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {activeRepo ? (
          <>
            <Surface className="gap-4 rounded-3xl p-4">
              <View className="flex-row items-center gap-3">
                <View className="h-11 w-11 items-center justify-center rounded-2xl bg-default">
                  <StyledIonicons name="git-branch-outline" size={22} className="text-foreground" />
                </View>
                <View className="min-w-0 flex-1">
                  <Text type="h5" className="text-foreground" numberOfLines={1}>
                    {activeRepo.name}
                  </Text>
                  <Text type="body-xs" color="muted" numberOfLines={1} className="font-mono">
                    {activeRepo.branch || 'UNINITIALIZED'}
                  </Text>
                </View>
                <Chip size="sm" variant="soft" color={activeRepo.initialEligible ? 'warning' : 'default'}>
                  <Chip.Label>{activeRepo.initialEligible ? '未初始化' : `${activeRepo.files.length} 个文件`}</Chip.Label>
                </Chip>
              </View>
              <View className="flex-row gap-3">
                <Surface variant="secondary" className="flex-1 gap-1 rounded-2xl px-4 py-3">
                  <Text type="body-xs" weight="semibold" className="uppercase tracking-wide text-muted">
                    新增
                  </Text>
                  <View className="flex-row items-baseline gap-0.5">
                    <Text type="h4" className="text-success">
                      +
                    </Text>
                    <NumberValue value={formatChangeCount(activeRepo.additions)} classNames={{ value: 'text-2xl font-semibold text-success' }} />
                  </View>
                </Surface>
                <Surface variant="secondary" className="flex-1 gap-1 rounded-2xl px-4 py-3">
                  <Text type="body-xs" weight="semibold" className="uppercase tracking-wide text-muted">
                    删除
                  </Text>
                  <View className="flex-row items-baseline gap-0.5">
                    <Text type="h4" className="text-danger">
                      -
                    </Text>
                    <NumberValue value={formatChangeCount(activeRepo.deletions)} classNames={{ value: 'text-2xl font-semibold text-danger' }} />
                  </View>
                </Surface>
              </View>
            </Surface>

            {activeRepo.files.length > 0 ? (
              <View className="gap-2">
                <SectionHeader title="变更文件" description={`${activeRepo.files.length} 个`} />
                <ListSection>
                  {activeRepo.files.slice(0, 80).map((file) => (
                    <ListRow
                      key={file.path}
                      title={file.path}
                      description={`+${formatChangeCount(file.additions)} / -${formatChangeCount(file.deletions)}`}
                      icon="document-text-outline"
                      className="min-h-12 py-2"
                      suffix={
                        <Chip size="sm" variant="soft" color={fileStatusColor(file.status)}>
                          <Chip.Label className="font-mono">{file.status.trim() || '--'}</Chip.Label>
                        </Chip>
                      }
                    />
                  ))}
                </ListSection>
                {activeRepo.files.length > 80 ? (
                  <Text type="body-xs" color="muted" className="px-1">
                    还有 {activeRepo.files.length - 80} 个文件未显示
                  </Text>
                ) : null}
              </View>
            ) : null}

            <View className="gap-2">
              <SectionHeader title="提交" />
              <Surface className="gap-4 rounded-3xl p-4">
                <FormTextArea
                  value={message}
                  onChangeText={setMessage}
                  placeholder="提交信息（留空将自动生成）"
                  editable={!busy}
                  minHeightClassName="min-h-24"
                />
                <ListSection variant="secondary">
                  <ListRow
                    title="包含未暂存的更改"
                    description="提交前自动 git add 工作区改动"
                    icon="layers-outline"
                    suffix={<Switch isDisabled={busy} isSelected={includeUnstaged} onSelectedChange={setIncludeUnstaged} />}
                  />
                </ListSection>
                <View className="gap-2">
                  <Button size="lg" variant="primary" isDisabled={busy} onPress={() => run(activeRepo.initialEligible ? 'initial' : 'commit')} className="rounded-2xl">
                    <StyledIonicons name="git-commit-outline" size={18} className="text-accent-foreground" />
                    <Button.Label>{actionLabel(activeRepo.initialEligible ? 'initial' : 'commit')}</Button.Label>
                  </Button>
                  <View className="flex-row gap-2">
                    <Button size="md" variant="secondary" isDisabled={busy || activeRepo.initialEligible} onPress={() => run('commit-push')} className="flex-1 rounded-2xl">
                      <StyledIonicons name="cloud-upload-outline" size={16} className="text-foreground" />
                      <Button.Label>{actionLabel('commit-push')}</Button.Label>
                    </Button>
                    <Button size="md" variant="ghost" isDisabled={busy || activeRepo.initialEligible} onPress={() => run('push')} className="flex-1 rounded-2xl">
                      <StyledIonicons name="arrow-up-circle-outline" size={16} className="text-foreground" />
                      <Button.Label>{actionLabel('push')}</Button.Label>
                    </Button>
                  </View>
                </View>
              </Surface>
            </View>
          </>
        ) : (
          <EmptyStateView
            icon="git-branch-outline"
            title="没有检测到 Git 仓库"
            description="请确认工作区路径可访问，或下拉刷新。"
            actionLabel="重新扫描"
            onAction={refresh}
          />
        )}
        {output ? (
          <View className="gap-2">
            <SectionHeader title="最近一次 Git 输出" />
            <Surface variant="secondary" className="rounded-3xl p-4">
              <Text selectable type="code" className="bg-transparent px-0 text-[11px] leading-[17px] text-foreground">
                {output}
              </Text>
            </Surface>
          </View>
        ) : null}
      </ScreenScrollView>
    </Screen>
  );
}

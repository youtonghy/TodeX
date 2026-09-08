import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, Spinner, Surface, Text } from 'heroui-native';
import type { CliUpgradeOperation, CliVersionInfo, CliVersionStatus, ManagedCliProvider, V2ApiClient } from '../lib/v2';
import { InlineNotice, Screen, ScreenScrollView } from '../components/ui';

export type CliManagerScreenProps = {
  client: Pick<V2ApiClient, 'listCliVersions' | 'upgradeCli' | 'getCliUpgrade'>;
  backendLabel?: string;
};
const labels: Record<CliVersionStatus, string> = {
  upToDate: '已是最新', updateAvailable: '可升级', ahead: '领先最新版', unknown: '最新版未知', notInstalled: '未安装', external: '外部管理',
};

export function CliManagerScreen({ client, backendLabel = '当前后端' }: CliManagerScreenProps) {
  const [clis, setClis] = useState<CliVersionInfo[]>([]);
  const [operation, setOperation] = useState<CliUpgradeOperation>();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [unknown, setUnknown] = useState(false);
  const generation = useRef(0);
  const request = useRef(0);
  const submitLock = useRef(false);
  const refresh = useCallback(async () => {
    const revision = ++request.current;
    const backend = generation.current;
    setLoading(true); setError('');
    try {
      const response = await client.listCliVersions();
      if (revision !== request.current || backend !== generation.current) return;
      setClis(response.clis);
      setOperation(current => response.activeOperation ?? (current?.status === 'running' ? current : undefined));
      setUnknown(false);
    } catch (cause) {
      if (revision === request.current && backend === generation.current) setError(cause instanceof Error ? cause.message : '无法读取 CLI 版本');
    } finally {
      if (revision === request.current && backend === generation.current) setLoading(false);
    }
  }, [client]);
  useEffect(() => {
    generation.current++; submitLock.current = false;
    setClis([]); setOperation(undefined); setSubmitting(false); setUnknown(false);
    void refresh();
    return () => { generation.current++; request.current++; };
  }, [refresh]);
  useEffect(() => {
    if (!operation || operation.status !== 'running') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await client.getCliUpgrade(operation.id);
        if (cancelled) return;
        setError('');
        if (next.status === 'succeeded') {
          const versions = await client.listCliVersions();
          if (cancelled) return;
          setClis(versions.clis);
        }
        setOperation(next);
        if (next.status === 'running') timer = setTimeout(() => void poll(), 1500);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : '无法读取升级进度');
        timer = setTimeout(() => void poll(), 3000);
      }
    };
    timer = setTimeout(() => void poll(), 1200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [client, operation?.id, operation?.status]);
  const upgrade = async (provider: ManagedCliProvider) => {
    if (submitLock.current || operation?.status === 'running' || unknown || loading) return;
    const current = generation.current;
    submitLock.current = true; setSubmitting(true); setError('');
    try {
      const result = await client.upgradeCli(provider);
      if (current === generation.current) setOperation(result);
    } catch (cause) {
      if (current !== generation.current) return;
      setUnknown(true);
      setError(cause instanceof Error ? cause.message : '无法确认升级请求，请刷新版本及操作状态。');
    } finally {
      if (current === generation.current) { submitLock.current = false; setSubmitting(false); }
    }
  };
  return <Screen><ScreenScrollView>
    <View className="flex-row items-center gap-3"><View className="flex-1"><Text type="h4">CLI 管理</Text><Text type="body-sm" color="muted">{backendLabel}</Text></View><Button variant="secondary" isDisabled={loading || submitting} onPress={() => void refresh()}><Button.Label>刷新版本</Button.Label></Button></View>
    {loading ? <Spinner /> : null}
    {error ? <InlineNotice status="danger" title="CLI 请求失败" description={error} /> : null}
    {unknown ? <InlineNotice status="warning" title="升级请求尚未确认" description="请先刷新并核对操作状态，避免重复发起升级。" /> : null}
    {operation ? <InlineNotice status={operation.status === 'failed' ? 'danger' : operation.status === 'succeeded' ? 'success' : 'accent'} title={operation.status === 'running' ? `${operation.provider} 正在升级` : operation.status === 'succeeded' ? 'CLI 升级成功' : 'CLI 升级失败'} description={operation.error || (operation.currentVersion ? `当前版本 ${operation.currentVersion}` : undefined)} /> : null}
    {clis.map(cli => <Surface key={cli.id} className="gap-3 rounded-3xl p-4">
      <View className="flex-row flex-wrap items-center gap-2"><Text type="h5">{cli.name}</Text><Chip variant="soft" color={cli.status === 'updateAvailable' ? 'warning' : cli.status === 'upToDate' ? 'success' : 'default'}><Chip.Label>{labels[cli.status] || '状态未知'}</Chip.Label></Chip></View>
      <Text type="body-sm">当前版本：{cli.currentVersion || '不可用'}</Text><Text type="body-sm">最新版本：{cli.latestVersion || '未获取'}</Text>
      {cli.error ? <InlineNotice status="warning" title={cli.error} /> : null}
      {cli.kind === 'managed' ? <Button variant={cli.status === 'updateAvailable' ? 'primary' : 'secondary'} isDisabled={!cli.upgradeSupported || submitting || loading || unknown || operation?.status === 'running'} onPress={() => void upgrade(cli.id)}><Button.Label>{operation?.provider === cli.id && operation.status === 'running' ? '正在升级' : '升级到最新版'}</Button.Label></Button> : <Text type="body-xs" color="muted">由外部环境管理版本。</Text>}
    </Surface>)}
  </ScreenScrollView></Screen>;
}

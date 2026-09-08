import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Spinner, Surface, Text } from 'heroui-native';
import type { ConnectionSettings } from '../lib/todex';
import { buildGitAgentPrompt, type GitAgentActionId } from '../lib/gitAgentActions';
import { GitWorkspaceError, readGitWorkspace, runGitWorkspaceOperation, type GitWorkspaceOperation, type GitWorkspaceSnapshot } from '../lib/gitWorkspace';
import { FormField, InlineNotice, SectionHeader } from '../components/ui';

export type GitWorkspacePanelProps = {
  settings: ConnectionSettings;
  workspacePath: string;
  writingBlocked?: boolean;
  agentUnavailableReason?: string;
  onSendAgentPrompt?: (text: string) => Promise<boolean>;
  onOpenWorktree?: (path: string) => void;
  onChanged?: () => void;
  onBusyChange?: (busy: boolean) => void;
};

export function GitWorkspacePanel({ settings, workspacePath, writingBlocked = false, agentUnavailableReason, onSendAgentPrompt, onOpenWorktree, onChanged, onBusyChange }: GitWorkspacePanelProps) {
  const [snapshot, setSnapshot] = useState<GitWorkspaceSnapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState('');
  const [unknown, setUnknown] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [startPoint, setStartPoint] = useState('');
  const [path, setPath] = useState('');
  const [removePath, setRemovePath] = useState('');
  const [mode, setMode] = useState<'branches' | 'worktrees'>('branches');
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  useEffect(() => { busyCallback.current?.(busy); }, [busy]);
  useEffect(() => () => { busyCallback.current?.(false); }, []);
  const generation = useRef(0);
  const lock = useRef(false);
  const unknownRef = useRef(false);
  const contextKey = `${settings.serverUrl}\n${settings.authToken}\n${workspacePath}`;
  const run = async (operation?: GitWorkspaceOperation) => {
    if (lock.current || !workspacePath || (operation && (writingBlocked || unknownRef.current))) return;
    const current = generation.current;
    lock.current = true; setBusy(true); setError(''); setOutput('');
    try {
      if (operation) {
        const result = await runGitWorkspaceOperation(settings, workspacePath, operation);
        if (current !== generation.current) return;
        setOutput(result.output || '操作已完成'); setRemovePath(''); onChanged?.();
      }
      const result = await readGitWorkspace(settings, workspacePath);
      if (current !== generation.current) return;
      setSnapshot(result); unknownRef.current = false; setUnknown(false);
    } catch (cause) {
      if (current !== generation.current) return;
      if (cause instanceof GitWorkspaceError && cause.unknownOutcome) { unknownRef.current = true; setUnknown(true); }
      setError(cause instanceof Error ? cause.message : '无法读取 Git 状态');
    } finally {
      if (current === generation.current) { lock.current = false; setBusy(false); }
    }
  };
  useEffect(() => {
    generation.current++; lock.current = false; unknownRef.current = false;
    setSnapshot(undefined); setUnknown(false); setBranchName(''); setStartPoint(''); setPath(''); setRemovePath('');
    void run();
    return () => { generation.current++; };
  }, [contextKey]);
  const send = async (action: GitAgentActionId) => {
    if (!onSendAgentPrompt || agentUnavailableReason || lock.current) return;
    const current = generation.current;
    lock.current = true; setBusy(true); setError('');
    try {
      const accepted = await onSendAgentPrompt(buildGitAgentPrompt(action, { workspacePath }));
      if (current === generation.current) setOutput(accepted ? '已发送到当前 Agent，请在对话查看进度。' : '请求尚未确认，请在对话核对发送状态。');
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : '发送失败');
    } finally {
      if (current === generation.current) { lock.current = false; setBusy(false); }
    }
  };
  const blocked = busy || writingBlocked || unknown || !snapshot?.initialized;
  return <View className="gap-3">
    <SectionHeader title="分支与工作树" />
    <Surface className="gap-3 rounded-3xl p-4">
      <View className="flex-row flex-wrap gap-2">
        <Button variant={mode === 'branches' ? 'primary' : 'secondary'} onPress={() => setMode('branches')}><Button.Label>分支</Button.Label></Button>
        <Button variant={mode === 'worktrees' ? 'primary' : 'secondary'} onPress={() => setMode('worktrees')}><Button.Label>工作树</Button.Label></Button>
        <Button variant="ghost" isDisabled={busy} onPress={() => void run()}>{busy ? <Spinner size="sm" /> : <Button.Label>刷新状态</Button.Label>}</Button>
      </View>
      {writingBlocked ? <InlineNotice status="warning" title="当前任务正在运行或等待确认，暂时不能修改 Git 状态。" /> : null}
      {unknown ? <InlineNotice status="warning" title="操作结果未知" description="请刷新并核对实际分支、工作树及远端状态，避免重复执行。" /> : null}
      {error ? <InlineNotice status="danger" title="Git 操作失败" description={error} /> : null}
      {output ? <Text selectable type="body-sm">{output}</Text> : null}
      {snapshot && !snapshot.initialized ? <Text>请先初始化仓库。</Text> : null}
      <ScrollView style={{ maxHeight: 320 }} nestedScrollEnabled>
        <View className="gap-3">
          {mode === 'branches' ? snapshot?.branches.map(branch => <Surface variant="secondary" className="gap-2 p-3" key={branch.name}>
            <Text selectable>{branch.name}{branch.current ? ' · 当前' : ''}{branch.remote ? ' · 远端' : ''}</Text>
            {branch.worktreePath ? <Text type="body-xs" color="muted">{branch.worktreePath}</Text> : null}
            {!branch.remote ? <Button variant="secondary" isDisabled={blocked || snapshot.dirty || branch.current || Boolean(branch.worktreePath)} onPress={() => void run({ action: 'switch-branch', branchName: branch.name })}><Button.Label>切换分支</Button.Label></Button> : null}
          </Surface>) : snapshot?.worktrees.map(tree => <Surface variant="secondary" className="gap-2 p-3" key={tree.path}>
            <Text>{tree.branch || '分离 HEAD'}{tree.current ? ' · 当前' : ''}{tree.main ? ' · 主工作树' : ''}</Text>
            <Text selectable type="body-xs" color="muted">{tree.path}</Text>
            <Text type="body-xs">{!tree.accessible ? '不可访问' : tree.dirty ? '有未提交更改' : '干净'}{tree.locked ? ' · 已锁定' : ''}</Text>
            <Button variant="secondary" isDisabled={busy || tree.current || !tree.accessible || !onOpenWorktree} onPress={() => onOpenWorktree?.(tree.path)}><Button.Label>打开工作区</Button.Label></Button>
            {removePath === tree.path ? <View className="gap-2"><Text>移除此目录？分支将保留。</Text><Button variant="danger" isDisabled={blocked} onPress={() => void run({ action: 'remove-worktree', path: tree.path })}><Button.Label>确认移除</Button.Label></Button><Button variant="ghost" onPress={() => setRemovePath('')}><Button.Label>取消</Button.Label></Button></View> : <Button variant="ghost" isDisabled={blocked || tree.main || tree.current || tree.dirty || tree.locked || !tree.accessible} onPress={() => setRemovePath(tree.path)}><Button.Label>移除工作树</Button.Label></Button>}
          </Surface>)}
        </View>
      </ScrollView>
      {mode === 'branches' && snapshot?.dirty ? <Text type="body-xs" color="muted">有未提交更改，请先处理后再切换分支。</Text> : null}
      {mode === 'worktrees' ? <Text type="body-xs" color="muted">打开工作区不会迁移当前对话；迁移任务请使用 Handoff。</Text> : null}
      <FormField label="新分支名称" value={branchName} onChangeText={setBranchName} placeholder="codex/my-task" editable={!blocked} />
      <FormField label="起点（可选）" value={startPoint} onChangeText={setStartPoint} placeholder="HEAD" editable={!blocked} />
      {mode === 'worktrees' ? <FormField label="新工作树绝对路径" value={path} onChangeText={setPath} placeholder="后端允许目录内的新路径" editable={!blocked} /> : <Text type="body-xs" color="muted">创建后仍停留在当前分支。</Text>}
      <Button isDisabled={blocked || !branchName.trim() || (mode === 'worktrees' && !path.trim())} onPress={() => void run(mode === 'branches' ? { action: 'create-branch', branchName: branchName.trim(), ...(startPoint.trim() ? { startPoint: startPoint.trim() } : {}) } : { action: 'create-worktree', branchName: branchName.trim(), path: path.trim(), ...(startPoint.trim() ? { startPoint: startPoint.trim() } : {}) })}><Button.Label>{mode === 'branches' ? '创建分支' : '创建工作树'}</Button.Label></Button>
    </Surface>
    <SectionHeader title="交接与 PR" />
    <Surface className="gap-3 rounded-3xl p-4">
      <Text type="body-sm" color="muted">交由当前 Agent 检查状态并处理，进度显示在对话中。</Text>
      {agentUnavailableReason ? <InlineNotice status="warning" title={agentUnavailableReason} /> : null}
      <View className="flex-row flex-wrap gap-2">{(['handoff', 'create-pr'] as const).map(action => <Button key={action} variant="secondary" isDisabled={busy || !onSendAgentPrompt || Boolean(agentUnavailableReason)} onPress={() => void send(action)}><Button.Label>{action === 'handoff' ? 'Handoff' : '创建 PR'}</Button.Label></Button>)}</View>
    </Surface>
  </View>;
}

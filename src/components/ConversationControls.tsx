import { createContext, memo, useContext, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, InputGroup, Surface, Text } from 'heroui-native';
import { createRequestId } from '../lib/todex';
import type { ProviderCapabilities } from '../lib/v2';
import type { ConversationRuntime } from '../lib/conversationRuntime';
import type { QueuedChatSubmission } from '../lib/appCore';

/** Chat keeps keystrokes local; flush before restoring a queue item into its draft. */
export const ComposerDraftFlushContext = createContext<(() => void) | null>(null);

export type LiveConversationControl =
  | { action: 'steer'; text: string }
  | { action: 'configure'; model?: string; reasoningEffort?: string }
  | { action: 'queueAdd'; itemId: string; text: string }
  | { action: 'queueRemove'; itemId: string }
  | { action: 'queueList' | 'queueClear' };

export type ConversationControlsProps = {
  running: boolean;
  capabilities?: ProviderCapabilities;
  state?: ConversationRuntime | null;
  controlStatus?: 'pending' | 'unknown' | null;
  localQueue: readonly QueuedChatSubmission[];
  nextModel: string;
  nextEffort?: string | null;
  onControl: (control: LiveConversationControl) => Promise<boolean>;
  onRecover: () => Promise<void>;
  onRemoveLocal: (id: string) => void;
  onRestoreLocal: (id: string) => void;
  onResumeLocal: () => void;
  onRetryUnknown?: (id: string) => Promise<boolean>;
};

const queueStatusLabel = (status?: string): string => status === 'unknown' ? '结果待核对'
  : status === 'failed' || status === 'error' ? '发送失败' : status === 'running' ? '执行中'
  : status === 'paused' ? '已暂停' : '等待发送';

export const ConversationControls = memo(function ConversationControls({
  running, capabilities, state, controlStatus, localQueue, nextModel, nextEffort,
  onControl, onRecover, onRemoveLocal, onRestoreLocal, onResumeLocal, onRetryUnknown,
}: ConversationControlsProps) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const flushComposerDraft = useContext(ComposerDraftFlushContext);
  const canSteer = capabilities?.steering === true || capabilities?.interjection === true;
  const canConfigure = capabilities?.liveConfiguration === true;
  const canQueue = capabilities?.followUpQueue === true;
  const nativeQueue = state?.queueItems ?? [];
  const uncertainControl = controlStatus === 'unknown' || state?.pendingControl?.status === 'unknown';
  const pending = busy || controlStatus === 'pending' || state?.pendingControl?.status === 'pending';
  const hasUnknownLocal = localQueue.some(item => item.status === 'unknown');
  const hasQueueError = localQueue.some(item => item.status === 'failed' || item.status === 'unknown')
    || nativeQueue.some(item => ['failed', 'unknown', 'error'].includes(item.status));
  const showDetails = expanded || Boolean(error) || hasQueueError || uncertainControl || Boolean(state?.configurationError);
  const mutationDisabled = pending || uncertainControl;
  const total = localQueue.length + nativeQueue.length;

  async function send(control: LiveConversationControl): Promise<boolean> {
    if (lock.current || (control.action !== 'queueList' && (!running || mutationDisabled))) return false;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const accepted = await onControl(control);
      if (!accepted) setError('操作未确认成功，输入已保留。请核对状态后再操作。');
      return accepted;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '操作失败，输入已保留。');
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function submitText(action: 'steer' | 'queueAdd'): Promise<void> {
    const submitted = text;
    if (!submitted.trim()) return;
    const accepted = await send(action === 'steer'
      ? { action, text: submitted.trim() }
      : { action, itemId: createRequestId('queue'), text: submitted.trim() });
    // Preserve any edits made while the request was in flight.
    if (accepted) setText(current => current === submitted ? '' : current);
  }

  async function recover(): Promise<void> {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await onRecover();
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '状态核对失败，请稍后再试。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function retryUnknown(id: string): Promise<void> {
    if (lock.current || pending || !onRetryUnknown) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await onRecover();
      // The action must reuse the original request identity and payload.
      const accepted = await onRetryUnknown(id);
      if (!accepted) setError('尚未确认送达，原待发项已保留，请核对状态。');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '核对或重试失败，原待发项已保留。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  if (!running && !total && !showDetails && !state?.queuePaused) return null;

  return <Surface variant="secondary" className="min-w-0 overflow-hidden rounded-2xl border border-separator">
    <Button size="sm" variant="ghost" onPress={() => setExpanded(current => !current)}
      accessibilityLabel="运行控制与待发消息" accessibilityState={{ expanded: showDetails }} className="justify-start rounded-none px-3">
      <Button.Label>{running ? '运行控制' : '待发消息'}{total ? ` · ${total}` : ''}{pending ? ' · 处理中' : ''}{hasQueueError ? ' · 需要处理' : ''}{showDetails ? ' ▴' : ' ▾'}</Button.Label>
    </Button>
    {showDetails ? <ScrollView nestedScrollEnabled style={{ maxHeight: 300 }} contentContainerClassName="gap-3 px-3 pb-3">
      {uncertainControl ? <Text accessibilityRole="alert" className="text-sm text-warning">上次操作结果尚未确认。请先核对状态；不会自动重新发送。</Text> : null}
      {error ? <Text accessibilityRole="alert" className="text-sm text-danger">{error}</Text> : null}
      {state?.configurationError ? <Text accessibilityRole="alert" className="text-sm text-danger">{state.configurationError}</Text> : null}
      {(uncertainControl || hasQueueError || Boolean(error)) ? <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => void recover()}>
        <Button.Label>核对会话状态</Button.Label>
      </Button> : null}

      {running && (canSteer || canQueue) ? <View className="gap-2">
        <InputGroup>
          <InputGroup.Input value={text} onChangeText={setText} multiline accessibilityLabel="运行中的补充指令"
            placeholder="输入纠偏指令或下一条消息" className="min-h-11 max-h-28 py-2" />
        </InputGroup>
        <View className="flex-row flex-wrap gap-2">
          {canSteer ? <Button size="sm" variant="secondary" isDisabled={mutationDisabled || !text.trim()} onPress={() => void submitText('steer')}>
            <Button.Label>纠偏当前任务</Button.Label>
          </Button> : null}
          {canQueue ? <Button size="sm" variant="secondary" isDisabled={mutationDisabled || !text.trim()} onPress={() => void submitText('queueAdd')}>
            <Button.Label>加入 Agent 队列</Button.Label>
          </Button> : null}
        </View>
      </View> : null}

      {running && canConfigure ? <View className="gap-1.5">
        <Text className="text-xs text-muted">已选配置：{nextModel || '默认模型'}{nextEffort ? ` · ${nextEffort}` : ''}</Text>
        <Button size="sm" variant="secondary" isDisabled={mutationDisabled || (!nextModel.trim() && !nextEffort)} onPress={() => void send({
          action: 'configure', ...(nextModel.trim() ? { model: nextModel.trim() } : {}), ...(nextEffort ? { reasoningEffort: nextEffort } : {}),
        })}><Button.Label>应用到本轮</Button.Label></Button>
        <Text className="text-xs text-muted">{state?.configurationStatus === 'provider-confirmed' ? 'Agent 已确认本轮配置。'
          : state?.configurationStatus === 'pending' ? '正在等待 Agent 确认配置。' : '以 Agent 回报为准；未确认时不视为生效。'}</Text>
      </View> : null}
      {running && !canSteer && !canQueue && !canConfigure ? <Text className="text-xs text-muted">此 Agent 未提供运行中纠偏或配置能力。</Text> : null}

      {canQueue || nativeQueue.length > 0 ? <View className="gap-2">
        <Text weight="semibold" className="text-sm text-foreground">Agent 队列 · {nativeQueue.length}{state?.queuePaused ? ' · 已暂停' : ''}</Text>
        {!running && nativeQueue.length > 0 ? <Text className="text-xs text-muted">任务结束后可核对队列；运行中可修改待发项。</Text> : null}
        {nativeQueue.map(item => <View key={item.id} className="gap-1 border-t border-separator pt-2">
          <Text className="text-sm text-foreground" numberOfLines={3}>{item.text}</Text>
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className={['failed', 'unknown', 'error'].includes(item.status) ? 'text-xs text-warning' : 'text-xs text-muted'}>{queueStatusLabel(item.status)}</Text>
            <Button size="sm" variant="ghost" isDisabled={!canQueue || !running || mutationDisabled || item.status === 'unknown' || item.status === 'running'}
              onPress={() => void send({ action: 'queueRemove', itemId: item.id })}><Button.Label>移除</Button.Label></Button>
          </View>
        </View>)}
        {canQueue ? <View className="flex-row flex-wrap gap-2">
          <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => { if (running && !uncertainControl && !pending) void send({ action: 'queueList' }); else void recover(); }}><Button.Label>刷新队列</Button.Label></Button>
          <Button size="sm" variant="ghost" isDisabled={!running || mutationDisabled || !nativeQueue.length || nativeQueue.some(item => item.status === 'unknown')}
            onPress={() => void send({ action: 'queueClear' })}><Button.Label>清空待发项</Button.Label></Button>
        </View> : null}
      </View> : null}

      {localQueue.length > 0 ? <View className="gap-2">
        <Text weight="semibold" className="text-sm text-foreground">本机待发 · {localQueue.length}</Text>
        {localQueue.map(item => <View key={item.id} className="gap-1 border-t border-separator pt-2">
          <Text className="text-sm text-foreground" numberOfLines={3}>{item.text || '附件消息'}{item.attachments.length ? ` · ${item.attachments.length} 个附件` : ''}{item.skills.length ? ` · ${item.skills.length} 个 Skill` : ''}</Text>
          <Text className={item.status === 'failed' || item.status === 'unknown' ? 'text-xs text-warning' : 'text-xs text-muted'}>{queueStatusLabel(item.status)}</Text>
          {item.status === 'unknown' ? <View className="gap-1.5">
            <Text className="text-xs text-muted">{onRetryUnknown ? '使用原请求标识核对并重试，避免重复执行。' : '先核对是否已送达，避免重复发送。'}</Text>
            {onRetryUnknown ? <Button size="sm" variant="secondary" isDisabled={pending} onPress={() => void retryUnknown(item.id)}>
              <Button.Label>核对后重试</Button.Label>
            </Button> : null}
          </View> : <View className="flex-row flex-wrap gap-2">
            <Button size="sm" variant="ghost" isDisabled={pending} onPress={() => { flushComposerDraft?.(); onRestoreLocal(item.id); }}><Button.Label>恢复到输入框</Button.Label></Button>
            <Button size="sm" variant="ghost" isDisabled={pending} onPress={() => onRemoveLocal(item.id)}><Button.Label>移除</Button.Label></Button>
          </View>}
        </View>)}
        <Button size="sm" variant="secondary" isDisabled={running || mutationDisabled || hasUnknownLocal} onPress={onResumeLocal}>
          <Button.Label>继续发送待发项</Button.Label>
        </Button>
      </View> : null}
    </ScrollView> : null}
  </Surface>;
});

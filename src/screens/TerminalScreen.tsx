import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Platform,
  ScrollView,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Chip, Input, Surface, Text } from 'heroui-native';

import type { WorkspaceRecord } from '../lib/todex';
import {
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  terminalIdForConversation,
  terminalStatusLabel,
  type ConnectionState,
  type ConversationRecord,
  type TerminalClientState,
  type TerminalOutputEntry,
} from '../lib/appCore';
import { EmptyStateView, FormField, InlineNotice, Screen, SectionHeader, StyledIonicons, useAppToast } from '../components/ui';

const EMPTY_TERMINAL_OUTPUT: TerminalOutputEntry[] = [];
const TERMINAL_BOTTOM_FOLLOW_THRESHOLD = 72;

function terminalEntryDisplayText(entry: TerminalOutputEntry): string {
  if (entry.kind === 'input') {
    return `$ ${entry.text.replace(/\n$/, '')}\n`;
  }
  if (entry.kind === 'system') {
    return `# ${entry.text.replace(/\n$/, '')}\n`;
  }
  if (entry.kind === 'error') {
    return `! ${entry.text.replace(/\n$/, '')}\n`;
  }
  return entry.text;
}

function terminalEntryClassName(entry: TerminalOutputEntry): string {
  switch (entry.kind) {
    case 'stderr':
    case 'error':
      return 'text-danger';
    case 'input':
      return 'text-accent';
    case 'system':
      return 'text-muted';
    default:
      return 'text-foreground';
  }
}

const TerminalOutputRow = memo(function TerminalOutputRow({ entry }: { entry: TerminalOutputEntry }) {
  return (
    <Text selectable type="code" className={`bg-transparent px-0 text-[12px] leading-[18px] ${terminalEntryClassName(entry)}`}>
      {terminalEntryDisplayText(entry)}
    </Text>
  );
});

function renderTerminalOutput({ item }: { item: TerminalOutputEntry }) {
  return <TerminalOutputRow entry={item} />;
}

function keyTerminalOutput(item: TerminalOutputEntry): string {
  return item.id;
}

export type TerminalScreenProps = {
  workspace: WorkspaceRecord | null;
  conversation: ConversationRecord | null;
  terminal: TerminalClientState | null;
  connectionState: ConnectionState;
  startTerminalSession: (workspace: WorkspaceRecord, conversation: ConversationRecord, options: { cwd: string; shell: string; rows: number; cols: number }) => boolean;
  stopTerminalSession: (terminalId: string, tenantId: string, force?: boolean) => boolean;
  sendTerminalInput: (terminalId: string, tenantId: string, data: string) => boolean;
  resizeTerminalSession: (terminalId: string, tenantId: string, rows: number, cols: number) => boolean;
  requestTerminalStatus: (workspace: WorkspaceRecord, conversation: ConversationRecord) => boolean;
  clearTerminalOutput: (terminalId: string) => void;
};

export function TerminalScreen({
  workspace,
  conversation,
  terminal,
  connectionState,
  startTerminalSession,
  stopTerminalSession,
  sendTerminalInput,
  resizeTerminalSession,
  requestTerminalStatus,
  clearTerminalOutput,
}: TerminalScreenProps) {
  const toast = useAppToast();
  const terminalId = conversation ? terminalIdForConversation(conversation.id) : terminal?.terminalId ?? '';
  const effectiveTenantId = terminal?.tenantId || workspace?.tenantId || 'local';
  const [cwd, setCwd] = useState(terminal?.cwd || workspace?.path || '');
  const [shell, setShell] = useState(terminal?.shell || '');
  const [rowsDraft, setRowsDraft] = useState(String(terminal?.rows ?? DEFAULT_TERMINAL_ROWS));
  const [colsDraft, setColsDraft] = useState(String(terminal?.cols ?? DEFAULT_TERMINAL_COLS));
  const [inputDraft, setInputDraft] = useState('');
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [showJumpToLatestOutput, setShowJumpToLatestOutput] = useState(false);
  const outputListRef = useRef<FlatList<TerminalOutputEntry> | null>(null);
  const shouldFollowOutputRef = useRef(true);
  const pendingOutputScrollFrameRef = useRef<number | null>(null);
  const terminalStateRef = useRef(terminal);
  const autoStartKeyRef = useRef('');
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualStopRef = useRef(false);
  const insets = useSafeAreaInsets();
  const isRunning = terminal?.status === 'running';
  const isBusy = terminal?.status === 'starting' || terminal?.status === 'stopping';
  const canControl = Boolean(workspace && conversation && terminalId && connectionState === 'open');
  const rows = Math.max(8, Math.min(200, Number.parseInt(rowsDraft, 10) || DEFAULT_TERMINAL_ROWS));
  const cols = Math.max(20, Math.min(400, Number.parseInt(colsDraft, 10) || DEFAULT_TERMINAL_COLS));
  const statusColor = isRunning ? 'success' : terminal?.status === 'error' ? 'danger' : isBusy ? 'warning' : 'default';
  const output = terminal?.output ?? EMPTY_TERMINAL_OUTPUT;
  const latestOutputId = output.at(-1)?.id ?? '';

  useEffect(() => {
    terminalStateRef.current = terminal;
  }, [terminal]);

  useEffect(() => {
    manualStopRef.current = false;
  }, [conversation?.id]);

  useEffect(() => {
    autoStartKeyRef.current = '';
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, [connectionState, conversation?.id]);

  useEffect(() => {
    if (workspace?.path && !cwd) {
      setCwd(workspace.path);
    }
  }, [cwd, workspace?.path]);

  useEffect(() => {
    if (!terminal) {
      return;
    }
    setCwd(terminal.cwd || workspace?.path || '');
    setShell(terminal.shell || '');
    setRowsDraft(String(terminal.rows || DEFAULT_TERMINAL_ROWS));
    setColsDraft(String(terminal.cols || DEFAULT_TERMINAL_COLS));
  }, [terminal?.terminalId, terminal?.cwd, terminal?.shell, terminal?.rows, terminal?.cols, workspace?.path]);

  useEffect(() => {
    if (workspace && conversation && connectionState === 'open') {
      requestTerminalStatus(workspace, conversation);
    }
  }, [connectionState, conversation?.id, requestTerminalStatus, workspace?.id]);

  useEffect(() => {
    if (!workspace || !conversation || !terminalId || connectionState !== 'open' || manualStopRef.current) return;
    const attemptKey = `${conversation.id}:${terminalId}`;
    if (autoStartKeyRef.current === attemptKey) return;
    autoStartKeyRef.current = attemptKey;
    requestTerminalStatus(workspace, conversation);
    const timer = setTimeout(() => {
      if (manualStopRef.current) return;
      const latest = terminalStateRef.current;
      if (!latest || latest.status === 'idle') {
        startTerminalSession(workspace, conversation, {
          cwd: latest?.cwd || workspace.path,
          shell: latest?.shell || '',
          rows: latest?.rows || DEFAULT_TERMINAL_ROWS,
          cols: latest?.cols || DEFAULT_TERMINAL_COLS,
        });
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [
    connectionState,
    conversation?.id,
    requestTerminalStatus,
    startTerminalSession,
    terminalId,
    workspace?.id,
    workspace?.path,
  ]);

  useEffect(() => {
    if (!workspace || !conversation || !terminalId || connectionState !== 'open' || manualStopRef.current) return;
    if (terminal?.status === 'running') {
      reconnectAttemptRef.current = 0;
      return;
    }
    if (terminal?.status !== 'error' && terminal?.status !== 'exited') return;
    if (reconnectTimerRef.current) return;
    const delay = Math.min(10_000, 1000 * 2 ** reconnectAttemptRef.current);
    reconnectAttemptRef.current += 1;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      const latest = terminalStateRef.current;
      startTerminalSession(workspace, conversation, {
        cwd: latest?.cwd || workspace.path,
        shell: latest?.shell || '',
        rows: latest?.rows || DEFAULT_TERMINAL_ROWS,
        cols: latest?.cols || DEFAULT_TERMINAL_COLS,
      });
    }, delay);
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [
    connectionState,
    conversation?.id,
    startTerminalSession,
    terminal?.status,
    terminalId,
    workspace?.id,
    workspace?.path,
  ]);

  const scrollToLatestOutput = useCallback((animated: boolean) => {
    if (pendingOutputScrollFrameRef.current !== null) return;
    pendingOutputScrollFrameRef.current = requestAnimationFrame(() => {
      pendingOutputScrollFrameRef.current = null;
      outputListRef.current?.scrollToEnd({ animated });
    });
  }, []);

  useEffect(() => () => {
    if (pendingOutputScrollFrameRef.current !== null) {
      cancelAnimationFrame(pendingOutputScrollFrameRef.current);
      pendingOutputScrollFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    shouldFollowOutputRef.current = true;
    setShowJumpToLatestOutput(false);
  }, [terminalId]);

  useEffect(() => {
    if (latestOutputId && shouldFollowOutputRef.current) scrollToLatestOutput(false);
  }, [latestOutputId, scrollToLatestOutput]);

  const handleOutputScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const isAtBottom = distanceFromBottom <= TERMINAL_BOTTOM_FOLLOW_THRESHOLD;
    shouldFollowOutputRef.current = isAtBottom;
    setShowJumpToLatestOutput(!isAtBottom && output.length > 0);
  }, [output.length]);

  const jumpToLatestOutput = useCallback(() => {
    shouldFollowOutputRef.current = true;
    setShowJumpToLatestOutput(false);
    scrollToLatestOutput(true);
  }, [scrollToLatestOutput]);

  const start = useCallback(() => {
    if (!workspace || !conversation) {
      toast.warning('未选择工作区', '请从一个对话中打开终端。');
      return;
    }
    if (connectionState !== 'open') {
      toast.warning('后端未连接', '请先在设置里连接后端。');
      return;
    }
    manualStopRef.current = false;
    reconnectAttemptRef.current = 0;
    startTerminalSession(workspace, conversation, {
      cwd: cwd.trim() || workspace.path,
      shell,
      rows,
      cols,
    });
  }, [cols, connectionState, conversation, cwd, rows, shell, startTerminalSession, toast, workspace]);

  const stop = useCallback((force = false) => {
    if (!terminalId) {
      return;
    }
    manualStopRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    stopTerminalSession(terminalId, effectiveTenantId, force);
  }, [effectiveTenantId, stopTerminalSession, terminalId]);

  const refresh = useCallback(() => {
    if (!workspace || !conversation) {
      return;
    }
    requestTerminalStatus(workspace, conversation);
  }, [conversation, requestTerminalStatus, workspace]);

  const applySize = useCallback(() => {
    if (!terminalId) {
      return;
    }
    resizeTerminalSession(terminalId, effectiveTenantId, rows, cols);
  }, [cols, effectiveTenantId, resizeTerminalSession, rows, terminalId]);

  const submitInput = useCallback(() => {
    const command = inputDraft;
    if (!command.trim() || !terminalId) {
      return;
    }
    if (!isRunning) {
      toast.warning('终端未运行', '请先启动终端。');
      return;
    }
    const data = command.endsWith('\n') ? command : `${command}\n`;
    if (sendTerminalInput(terminalId, effectiveTenantId, data)) {
      setInputDraft('');
    }
  }, [effectiveTenantId, inputDraft, isRunning, sendTerminalInput, terminalId, toast]);

  const copyOutput = useCallback(async () => {
    const output = terminal?.output.map((entry) => terminalEntryDisplayText(entry)).join('');
    if (!output) {
      return;
    }
    await Clipboard.setStringAsync(output);
    toast.success('已复制', '终端输出已复制到剪贴板');
  }, [terminal?.output, toast]);

  if (!workspace || !conversation) {
    return (
      <Screen>
        <EmptyStateView icon="terminal-outline" title="终端目标不存在" description="请返回后重新选择对话。" className="flex-1 justify-center" />
      </Screen>
    );
  }

  return (
    <Screen>
      <View className="gap-3 px-4 pt-3">
        <View className="flex-row items-center gap-3">
          <View className="min-w-0 flex-1">
            <Text type="h5" numberOfLines={1} className="text-foreground">
              {workspace.name}
            </Text>
            <Text type="body-xs" color="muted" numberOfLines={1} className="font-mono">
              {cwd || workspace.path}
            </Text>
          </View>
          <Chip size="sm" variant="soft" color={statusColor}>
            <View className={`h-1.5 w-1.5 rounded-full ${isRunning ? 'bg-success' : terminal?.status === 'error' ? 'bg-danger' : isBusy ? 'bg-warning' : 'bg-muted'}`} />
            <Chip.Label>{terminalStatusLabel(terminal?.status ?? 'idle')}</Chip.Label>
          </Chip>
          {terminal?.pid ? (
            <Chip size="sm" variant="soft">
              <Chip.Label>pid {terminal.pid}</Chip.Label>
            </Chip>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="items-center gap-2 pr-2">
          <Button size="sm" variant="primary" isDisabled={!canControl || isRunning || isBusy} onPress={start} className="h-9 rounded-full">
            <StyledIonicons name="play" size={14} className="text-accent-foreground" />
            <Button.Label>启动</Button.Label>
          </Button>
          <Button size="sm" variant="secondary" isDisabled={!canControl} onPress={refresh} className="h-9 rounded-full">
            <StyledIonicons name="refresh-outline" size={14} className="text-foreground" />
            <Button.Label>状态</Button.Label>
          </Button>
          <Button size="sm" variant="danger-soft" isDisabled={!isRunning && terminal?.status !== 'starting'} onPress={() => stop(false)} className="h-9 rounded-full">
            <StyledIonicons name="stop" size={14} className="text-danger" />
            <Button.Label>停止</Button.Label>
          </Button>
          <Button size="sm" variant="danger-soft" isDisabled={!isRunning && terminal?.status !== 'starting'} onPress={() => stop(true)} className="h-9 rounded-full">
            <StyledIonicons name="close-circle-outline" size={14} className="text-danger" />
            <Button.Label>强停</Button.Label>
          </Button>
          <Button size="sm" variant={settingsExpanded ? 'secondary' : 'ghost'} onPress={() => setSettingsExpanded((value) => !value)} className="h-9 rounded-full">
            <StyledIonicons name="options-outline" size={14} className="text-foreground" />
            <Button.Label>会话参数</Button.Label>
          </Button>
        </ScrollView>

        {settingsExpanded ? (
          <Surface variant="secondary" className="gap-3 rounded-2xl p-3">
            <SectionHeader title="会话参数" description="协议 todex-terminal.v1" />
            <FormField label="路径" value={cwd} onChangeText={setCwd} placeholder={workspace.path} editable={!isRunning && !isBusy} monospace />
            <FormField label="Shell" value={shell} onChangeText={setShell} placeholder="默认使用后端 SHELL" editable={!isRunning && !isBusy} monospace />
            <View className="flex-row items-end gap-2">
              <View className="flex-1">
                <FormField label="Rows" value={rowsDraft} onChangeText={setRowsDraft} placeholder="24" editable={!isBusy} keyboardType="number-pad" />
              </View>
              <View className="flex-1">
                <FormField label="Cols" value={colsDraft} onChangeText={setColsDraft} placeholder="80" editable={!isBusy} keyboardType="number-pad" />
              </View>
              <Button size="md" variant="secondary" isDisabled={!isRunning} onPress={applySize} className="h-12 rounded-xl">
                <Button.Label>应用尺寸</Button.Label>
              </Button>
            </View>
          </Surface>
        ) : null}

        {terminal?.error ? <InlineNotice status="danger" title="终端错误" description={terminal.error} /> : null}
      </View>

      <Surface className="mx-4 mt-3 min-h-0 flex-1 overflow-hidden rounded-3xl">
        <View className="flex-row items-center justify-between border-b border-separator px-4 py-2">
          <View className="flex-row items-center gap-2">
            <View className="flex-row gap-1.5">
              <View className="h-2.5 w-2.5 rounded-full bg-danger/70" />
              <View className="h-2.5 w-2.5 rounded-full bg-warning/70" />
              <View className="h-2.5 w-2.5 rounded-full bg-success/70" />
            </View>
            <Text type="body-xs" weight="semibold" className="uppercase tracking-wide text-muted">
              Session
            </Text>
            {terminal?.outputTruncated ? (
              <Chip size="sm" variant="soft" color="warning">
                <Chip.Label>已截断</Chip.Label>
              </Chip>
            ) : null}
          </View>
          <View className="flex-row gap-0.5">
            <Button isIconOnly size="sm" variant="ghost" accessibilityLabel="复制输出" isDisabled={!terminal?.output.length} onPress={() => void copyOutput()} className="h-8 w-8 rounded-full">
              <StyledIonicons name="copy-outline" size={14} className="text-muted" />
            </Button>
            <Button isIconOnly size="sm" variant="ghost" accessibilityLabel="清空输出" isDisabled={!terminalId} onPress={() => clearTerminalOutput(terminalId)} className="h-8 w-8 rounded-full">
              <StyledIonicons name="trash-outline" size={14} className="text-muted" />
            </Button>
          </View>
        </View>
        <FlatList
          ref={outputListRef}
          data={output}
          renderItem={renderTerminalOutput}
          keyExtractor={keyTerminalOutput}
          className="flex-1"
          contentContainerClassName="px-4 py-3"
          ListEmptyComponent={(
            <Text type="code" className="bg-transparent px-0 text-[12px] leading-[18px] text-muted">
              {connectionState === 'open' ? 'terminal idle\n' : 'backend disconnected\n'}
            </Text>
          )}
          initialNumToRender={18}
          maxToRenderPerBatch={12}
          updateCellsBatchingPeriod={40}
          windowSize={9}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          removeClippedSubviews={Platform.OS === 'android'}
          onScroll={handleOutputScroll}
          scrollEventThrottle={80}
        />
        {showJumpToLatestOutput ? (
          <View className="absolute bottom-3 right-3">
            <Button size="sm" variant="secondary" accessibilityLabel="跳到最新输出" onPress={jumpToLatestOutput} className="h-9 rounded-full px-3 shadow-sm">
              <StyledIonicons name="arrow-down" size={14} className="text-foreground" />
              <Button.Label>最新输出</Button.Label>
            </Button>
          </View>
        ) : null}
      </Surface>

      <View className="flex-row items-center gap-2 px-4 pt-3" style={{ paddingBottom: 12 + insets.bottom }}>
        <Text type="code" className="bg-transparent px-0 text-accent">
          $
        </Text>
        <Input
          containerClassName="flex-1"
          value={inputDraft}
          onChangeText={setInputDraft}
          placeholder={isRunning ? '输入命令' : '启动终端后输入命令'}
          isDisabled={!isRunning}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          onSubmitEditing={submitInput}
          className="min-h-11 flex-1 rounded-2xl font-mono text-sm"
        />
        <Button isIconOnly size="md" variant="primary" accessibilityLabel="发送命令" isDisabled={!isRunning || !inputDraft.trim()} onPress={submitInput} className="h-11 w-11 rounded-full">
          <StyledIonicons name="return-down-forward" size={18} className="text-accent-foreground" />
        </Button>
      </View>
    </Screen>
  );
}

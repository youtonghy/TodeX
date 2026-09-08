import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Chip, Text } from 'heroui-native';

import { InteractiveTerminal, type InteractiveTerminalHandle } from '../components/terminal/InteractiveTerminal';
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
import { ActionSheet, AppSheet, EmptyStateView, FormField, InlineNotice, Screen, StyledIonicons, useAppToast } from '../components/ui';

const EMPTY_TERMINAL_OUTPUT: TerminalOutputEntry[] = [];
export type TerminalScreenProps = {
  terminalId?: string;
  visible?: boolean;
  workspace: WorkspaceRecord | null;
  conversation: ConversationRecord | null;
  terminal: TerminalClientState | null;
  connectionState: ConnectionState;
  startTerminalSession: (workspace: WorkspaceRecord, conversation: ConversationRecord, options: { cwd: string; shell: string; rows: number; cols: number; terminalId?: string }) => boolean;
  stopTerminalSession: (terminalId: string, tenantId: string, force?: boolean) => boolean;
  sendTerminalInput: (terminalId: string, tenantId: string, data: string) => boolean;
  resizeTerminalSession: (terminalId: string, tenantId: string, rows: number, cols: number) => boolean;
  requestTerminalStatus: (workspace: WorkspaceRecord, conversation: ConversationRecord, terminalId?: string) => boolean;
  clearTerminalOutput: (terminalId: string) => void;
};

export function TerminalScreen({
  terminalId: requestedTerminalId,
  visible = true,
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
  const terminalId = requestedTerminalId || terminal?.terminalId || (conversation ? terminalIdForConversation(conversation.id) : '');
  const effectiveTenantId = terminal?.tenantId || workspace?.tenantId || 'local';
  const [cwd, setCwd] = useState(terminal?.cwd || workspace?.path || '');
  const [shell, setShell] = useState(terminal?.shell || '');
  const [rowsDraft, setRowsDraft] = useState(String(terminal?.rows ?? DEFAULT_TERMINAL_ROWS));
  const [colsDraft, setColsDraft] = useState(String(terminal?.cols ?? DEFAULT_TERMINAL_COLS));
  const [viewportSize, setViewportSize] = useState<{ rows: number; cols: number } | null>(null);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const terminalViewRef = useRef<InteractiveTerminalHandle>(null);
  const terminalStateRef = useRef(terminal);
  const autoStartKeyRef = useRef('');
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualStopRef = useRef(false);
  const insets = useSafeAreaInsets();
  const isRunning = terminal?.status === 'running';
  const isBusy = terminal?.status === 'starting' || terminal?.status === 'stopping';
  const canControl = Boolean(workspace && conversation && terminalId && connectionState === 'open' && visible);
  const rows = Math.max(8, Math.min(200, Number.parseInt(rowsDraft, 10) || DEFAULT_TERMINAL_ROWS));
  const cols = Math.max(20, Math.min(400, Number.parseInt(colsDraft, 10) || DEFAULT_TERMINAL_COLS));
  const statusColor = isRunning ? 'success' : terminal?.status === 'error' ? 'danger' : isBusy ? 'warning' : 'default';
  const output = terminal?.output ?? EMPTY_TERMINAL_OUTPUT;

  useEffect(() => {
    if (!isRunning || !canControl || !viewportSize) return;
    if (terminal?.rows !== viewportSize.rows || terminal?.cols !== viewportSize.cols) resizeTerminalSession(terminalId, effectiveTenantId, viewportSize.rows, viewportSize.cols);
  }, [isRunning, canControl, viewportSize, terminal?.rows, terminal?.cols, terminalId, effectiveTenantId, resizeTerminalSession]);

  useEffect(() => {
    terminalStateRef.current = terminal;
  }, [terminal]);

  useEffect(() => {
    manualStopRef.current = false;
  }, [conversation?.id, terminalId]);

  useEffect(() => {
    autoStartKeyRef.current = '';
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, [connectionState, conversation?.id, terminalId, visible]);

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
    if (visible && workspace && conversation && connectionState === 'open') {
      requestTerminalStatus(workspace, conversation, terminalId);
    }
  }, [connectionState, conversation?.id, requestTerminalStatus, workspace?.id, terminalId, visible]);

  useEffect(() => {
    if (!visible || !workspace || !conversation || !terminalId || connectionState !== 'open' || manualStopRef.current) return;
    const attemptKey = `${conversation.id}:${terminalId}`;
    if (autoStartKeyRef.current === attemptKey) return;
    autoStartKeyRef.current = attemptKey;
    requestTerminalStatus(workspace, conversation, terminalId);
    const timer = setTimeout(() => {
      if (manualStopRef.current) return;
      const latest = terminalStateRef.current;
      if (!latest || latest.status === 'idle') {
        startTerminalSession(workspace, conversation, {
        terminalId,
          cwd: latest?.cwd || workspace.path,
          shell: latest?.shell || '',
          rows: latest?.rows || DEFAULT_TERMINAL_ROWS,
          cols: latest?.cols || DEFAULT_TERMINAL_COLS,
        });
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [
    visible,
    connectionState,
    conversation?.id,
    requestTerminalStatus,
    startTerminalSession,
    terminalId,
    workspace?.id,
    workspace?.path,
  ]);

  useEffect(() => {
    if (!visible || !workspace || !conversation || !terminalId || connectionState !== 'open' || manualStopRef.current) return;
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
        terminalId,
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
    visible,
    connectionState,
    conversation?.id,
    startTerminalSession,
    terminal?.status,
    terminalId,
    workspace?.id,
    workspace?.path,
  ]);

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
      terminalId,
      cwd: cwd.trim() || workspace.path,
      shell,
      rows,
      cols,
    });
  }, [cols, connectionState, conversation, cwd, rows, shell, startTerminalSession, toast, workspace, terminalId]);

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
    requestTerminalStatus(workspace, conversation, terminalId);
  }, [conversation, requestTerminalStatus, workspace, terminalId]);

  const copyOutput = useCallback(async () => {
    const output = terminal?.output.map((entry) => entry.text).join('');
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
    <View className="flex-1 bg-background">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View className="h-14 flex-row items-center gap-2 border-b border-separator px-3">
          <View className="min-w-0 flex-1">
            <Text type="body-sm" weight="semibold" numberOfLines={1}>{workspace.name}</Text>
            <Text type="body-xs" color="muted" numberOfLines={1} className="font-mono">{cwd || workspace.path}</Text>
          </View>
          <Chip size="sm" variant="soft" color={statusColor}>
            <Chip.Label>{terminalStatusLabel(terminal?.status ?? 'idle')}</Chip.Label>
          </Chip>
          <Button isIconOnly size="sm" variant="ghost" accessibilityLabel="终端更多操作" onPress={() => setMenuVisible(true)} className="h-11 w-11 rounded-full">
            <StyledIonicons name="ellipsis-horizontal" size={20} className="text-foreground" />
          </Button>
        </View>
        {terminal?.error ? <View className="px-3 py-2"><InlineNotice status="danger" title="终端连接异常" description={terminal.error} /></View> : null}
        <View className="min-h-0 flex-1" style={{ backgroundColor: '#171717' }}>
          <InteractiveTerminal
            ref={terminalViewRef}
            key={terminalId}
            output={output}
            visible={visible}
            enabled={isRunning && canControl}
            onInput={data => sendTerminalInput(terminalId, effectiveTenantId, data)}
            onResize={(nextRows, nextCols) => {
              setViewportSize(current => current?.rows === nextRows && current.cols === nextCols ? current : { rows: nextRows, cols: nextCols });
            }}
          />
          {!isRunning ? (
            <View className="absolute inset-0 items-center justify-center gap-4 px-8">
              <Text type="body-sm" className="text-center text-white/70">
                {connectionState !== 'open' ? '连接后端后即可使用终端' : isBusy ? '正在连接终端…' : '终端尚未运行'}
              </Text>
              {canControl && !isBusy ? <Button size="sm" onPress={start}><Button.Label>启动终端</Button.Label></Button> : null}
            </View>
          ) : null}
        </View>
        <View className="border-t border-separator bg-background" style={{ paddingBottom: insets.bottom }}>
          <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerClassName="items-center gap-1 px-2 py-1">
            <Button isIconOnly size="sm" variant="ghost" accessibilityLabel="聚焦终端键盘" isDisabled={!isRunning || !canControl} onPress={() => terminalViewRef.current?.focus()} className="h-11 w-11 rounded-lg">
              <StyledIonicons name="keypad-outline" size={18} className="text-foreground" />
            </Button>
            {([['Ctrl-C', '\u0003'], ['Tab', '\t'], ['Esc', '\u001b'], ['↑', '\u001b[A'], ['↓', '\u001b[B'], ['←', '\u001b[D'], ['→', '\u001b[C']] as const).map(([label, data]) => (
              <Button key={label} variant="ghost" size="sm" className="h-11 min-w-11 rounded-lg px-3" isDisabled={!isRunning || !canControl} onPress={() => {
                sendTerminalInput(terminalId, effectiveTenantId, data);
                terminalViewRef.current?.focus();
              }}><Button.Label className="font-mono">{label}</Button.Label></Button>
            ))}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
      <ActionSheet isOpen={menuVisible} onOpenChange={setMenuVisible} title="终端操作" actions={[
        { id: 'refresh', label: '刷新状态', icon: 'refresh-outline', disabled: !canControl, onPress: refresh },
        { id: 'copy', label: '复制输出', icon: 'copy-outline', disabled: !output.length, onPress: () => void copyOutput() },
        { id: 'clear', label: '清空输出', icon: 'trash-outline', disabled: !terminalId, onPress: () => clearTerminalOutput(terminalId) },
        { id: 'settings', label: '会话设置', icon: 'options-outline', onPress: () => setSettingsExpanded(true) },
        { id: 'stop', label: '停止终端', icon: 'stop-outline', destructive: true, disabled: !isRunning && !isBusy, onPress: () => stop(false) },
        { id: 'force-stop', label: '强制停止', icon: 'close-circle-outline', destructive: true, disabled: !isRunning && !isBusy, onPress: () => stop(true) },
      ]} />
      <AppSheet isOpen={settingsExpanded} onOpenChange={setSettingsExpanded} title="会话设置" description="启动目录和 Shell 在下次启动时生效">
        <View className="gap-4">
          <FormField label="工作目录" value={cwd} onChangeText={setCwd} placeholder={workspace.path} editable={!isRunning && !isBusy} monospace />
          <FormField label="Shell" value={shell} onChangeText={setShell} placeholder="使用后端默认 Shell" editable={!isRunning && !isBusy} monospace />
          <Text type="body-sm" color="muted">终端行列数随可用空间自动调整。</Text>
          {terminal?.pid ? <Text type="body-sm" color="muted">进程 {terminal.pid}</Text> : null}
          {terminal?.outputTruncated ? <Text type="body-sm" color="muted">较早的输出已截断。</Text> : null}
        </View>
      </AppSheet>
    </View>
  );
}

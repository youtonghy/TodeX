import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Tabs } from 'heroui-native';
import { ActionSheet, EmptyStateView, StyledIonicons } from '../../components/ui';
import { WORKBENCH_TABS, type WorkbenchTab } from '../../lib/workbench';
import { terminalIdForConversation } from '../../lib/appCore';
import type { ConnectionState, ConversationRecord, GitDiffState, TerminalClientState } from '../../lib/appCore';
import type { WorkspaceRecord } from '../../lib/todex';
import { FilesScreen, type FilesClient } from '../FilesScreen';
import { BrowserScreen, type BrowserClient, type BrowserFetchResult } from '../BrowserScreen';
import { TerminalScreen, type TerminalScreenProps } from '../TerminalScreen';
import { GitDiffScreen } from '../GitDiffScreen';

type WorkbenchItem = { id: string; type: WorkbenchTab; title: string; target?: string; filePath?: string; terminalId?: string };
export type TabletWorkbenchPanelProps = {
  visible?: boolean;
  renderTerminal?: (terminalId: string, visible: boolean) => ReactNode;
  workspaceId: string;
  conversationId: string;
  workspace: WorkspaceRecord | null;
  conversation: ConversationRecord | null;
  activeTab?: WorkbenchTab;
  onTabChange?: (tab: WorkbenchTab) => void;
  onClose?: () => void;
  // Files
  filesClient?: FilesClient;
  initialFilePath?: string;
  onFileSelected?: (path: string) => void;
  // Browser
  browserClient?: BrowserClient;
  browserUrl?: string;
  browserFilePath?: string;
  renderWebView?: (result: BrowserFetchResult) => ReactNode;
  onBrowserResult?: (result: { url: string; title: string }) => void;
  // Terminal
  terminal?: TerminalClientState | null;
  connectionState?: ConnectionState;
  startTerminalSession?: (workspace: WorkspaceRecord, conversation: ConversationRecord, options: { cwd: string; shell: string; rows: number; cols: number; terminalId?: string }) => boolean;
  stopTerminalSession?: (terminalId: string, tenantId: string, force?: boolean) => boolean;
  sendTerminalInput?: (terminalId: string, tenantId: string, data: string) => boolean;
  clearTerminalOutput?: (terminalId: string) => void;
  resizeTerminalSession?: TerminalScreenProps['resizeTerminalSession'];
  requestTerminalStatus?: TerminalScreenProps['requestTerminalStatus'];
  // Git Diff
  gitDiffState?: GitDiffState | null;
  requestGitDiff?: (conversationId?: string) => Promise<boolean>;
};


const LABELS: Record<WorkbenchTab, string> = { files: '文件', browser: '浏览器', terminal: '终端', 'git-diff': 'Git Diff' };
const unavailable = () => false;
const unavailableDiff = async () => false;
const noop = () => {};

// The same screen components back phone navigation and the tablet workbench.
// Visited panes stay mounted so switching tabs preserves their own scroll/input state.
export function TabletWorkbenchPanel(props: TabletWorkbenchPanelProps) {
  const initial = props.activeTab || 'files';
  const [items, setItems] = useState<WorkbenchItem[]>(() => [{ id: `${initial}-0`, type: initial, filePath: initial === 'browser' ? props.browserFilePath : undefined, terminalId: initial === 'terminal' ? terminalIdForConversation(props.conversationId) : undefined, title: LABELS[initial], target: initial === 'files' ? props.initialFilePath : props.browserUrl }]);
  const [activeId, setActiveId] = useState(`${initial}-0`);
  const [adding, setAdding] = useState(false);
  const counter = useRef(0);
  const active = items.find(item => item.id === activeId) || items[0];
  const select = (item: WorkbenchItem) => { setActiveId(item.id); props.onTabChange?.(item.type); };
  const open = (type: WorkbenchTab, reuse = false) => {
    // Git diff is scoped to the conversation; terminals each have a real PTY ID.
    const existing = items.find(item => item.type === type);
    if (existing && (reuse || type === 'git-diff')) { select(existing); return; }
    const item = { id: `${type}-${++counter.current}`, type, filePath: type === 'browser' ? props.browserFilePath : undefined, terminalId: type === 'terminal' ? (existing ? `${terminalIdForConversation(props.conversationId)}:${Date.now()}-${counter.current}` : terminalIdForConversation(props.conversationId)) : undefined, title: `${LABELS[type]} ${counter.current}`, target: type === 'files' ? props.initialFilePath : props.browserUrl };
    setItems(current => [...current, item]); select(item);
  };
  useEffect(() => {
    if (props.activeTab && active?.type !== props.activeTab) open(props.activeTab, true);
  }, [props.activeTab]);
  useEffect(() => {
    if (!props.initialFilePath) return;
    setItems(current => {
      const target = current.find(item => item.id === activeId && item.type === 'files') || current.find(item => item.type === 'files');
      return current.map(item => item.id === target?.id ? { ...item, target: props.initialFilePath } : item);
    });
  }, [props.initialFilePath]);
  useEffect(() => {
    setItems(current => {
      const target = current.find(item => item.id === activeId && item.type === 'browser') || current.find(item => item.type === 'browser');
      return current.map(item => item.id === target?.id ? { ...item, target: props.browserUrl, filePath: props.browserFilePath } : item);
    });
  }, [props.browserUrl, props.browserFilePath]);
  const close = (item: WorkbenchItem) => {
    if (items.length === 1) return;
    if (item.terminalId) props.stopTerminalSession?.(item.terminalId, props.workspace?.tenantId || 'local');
    const next = items.filter(candidate => candidate.id !== item.id);
    setItems(next);
    if (activeId === item.id) select(next[Math.max(0, items.indexOf(item) - 1)] || next[0]);
  };
  return <View className="flex-1 bg-background">
    <View className="flex-row items-center border-b border-separator">
      <ScrollView horizontal className="flex-1" showsHorizontalScrollIndicator={false}>
        <Tabs value={activeId} onValueChange={id => { const item = items.find(item => item.id === id); if (item) select(item); }}>
          <Tabs.List>
            {items.map(item => <View key={item.id} className="flex-row items-center">
              <Tabs.Trigger value={item.id} className="min-h-11"><Tabs.Label>{item.title}</Tabs.Label></Tabs.Trigger>
              <Button isIconOnly variant="ghost" className="h-11 w-11" accessibilityLabel={`关闭 ${item.title}`} isDisabled={items.length === 1} onPress={() => close(item)}><StyledIonicons name="close" size={16} /></Button>
            </View>)}
          </Tabs.List>
        </Tabs>
      </ScrollView>
      <Button isIconOnly variant="ghost" className="h-11 w-11" accessibilityLabel="新建工作台标签" onPress={() => setAdding(true)}><StyledIonicons name="add" size={18} /></Button>
    </View>
    {items.map(item => <View key={item.id} style={{ flex: 1, display: item.id === activeId ? 'flex' : 'none' }}>
      {item.type === 'files' && props.filesClient ? <FilesScreen client={props.filesClient} rootPath={props.workspace?.path || ''} initialFilePath={item.target} onFileSelected={path => { if (item.id === activeId) props.onFileSelected?.(path); }} /> : null}
      {item.type === 'browser' && props.browserClient ? <BrowserScreen client={props.browserClient} initialUrl={item.target} initialFilePath={item.filePath} renderWebView={props.renderWebView} onResult={result => { if (item.id === activeId) props.onBrowserResult?.({ url: result.url, title: result.url }); }} /> : null}
      {item.type === 'git-diff' ? <GitDiffScreen workspace={props.workspace} conversation={props.conversation} diffState={props.gitDiffState || null} requestGitDiff={props.requestGitDiff || unavailableDiff} /> : null}
      {item.type === 'terminal' && props.renderTerminal && item.terminalId ? props.renderTerminal(item.terminalId, props.visible !== false && item.id === activeId) : item.type === 'terminal' ? <TerminalScreen terminalId={item.terminalId} visible={props.visible !== false && item.id === activeId} workspace={props.workspace} conversation={props.conversation} terminal={props.terminal || null} connectionState={props.connectionState || 'closed'} startTerminalSession={props.startTerminalSession || unavailable} stopTerminalSession={props.stopTerminalSession || unavailable} sendTerminalInput={props.sendTerminalInput || unavailable} resizeTerminalSession={props.resizeTerminalSession || unavailable} requestTerminalStatus={props.requestTerminalStatus || unavailable} clearTerminalOutput={props.clearTerminalOutput || noop} /> : null}
      {(item.type === 'files' && !props.filesClient) || (item.type === 'browser' && !props.browserClient) ? <EmptyStateView title="后端未连接" description="连接后重新打开工作台。" icon="cloud-offline-outline" /> : null}
    </View>)}
    <ActionSheet isOpen={adding} onOpenChange={setAdding} title="新建工作台标签" actions={WORKBENCH_TABS.map(type => ({ id: type, label: LABELS[type], onPress: () => { setAdding(false); open(type); } }))} />
  </View>;
}

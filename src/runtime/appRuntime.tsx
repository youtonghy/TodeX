import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react';

import type { PendingRequest, WorkspaceRecord } from '../lib/todex';
import type {
  ConnectionState,
  ComposerAttachmentDraft,
  ComposerSelection,
  ConversationRecord,
  GitDiffState,
  MobileContextUsage,
  QueuedChatSubmission,
  TerminalClientState,
} from '../lib/appCore';
import type { TimelineStore } from '../lib/timelineStore';
import { ExternalStore, KeyedExternalStore, RuntimeActionRegistry, RuntimeTransaction } from './externalStore';

export type OutputRuntimeActions = {
  startTerminalSession: (
    workspace: WorkspaceRecord,
    conversation: ConversationRecord,
    options: { cwd: string; shell: string; rows: number; cols: number },
  ) => boolean;
  stopTerminalSession: (terminalId: string, tenantId: string, force?: boolean) => boolean;
  sendTerminalInput: (terminalId: string, tenantId: string, data: string) => boolean;
  resizeTerminalSession: (terminalId: string, tenantId: string, rows: number, cols: number) => boolean;
  requestTerminalStatus: (workspace: WorkspaceRecord, conversation: ConversationRecord) => boolean;
  clearTerminalOutput: (terminalId: string) => void;
  requestGitDiff: (conversationId?: string) => Promise<boolean>;
};

export type AppRuntime = {
  transaction: RuntimeTransaction;
  timelineStore: TimelineStore;
  routeSnapshots: KeyedExternalStore<unknown>;
  actions: RuntimeActionRegistry;
  workspaces: KeyedExternalStore<WorkspaceRecord>;
  conversations: KeyedExternalStore<ConversationRecord>;
  terminals: KeyedExternalStore<TerminalClientState>;
  gitDiffs: KeyedExternalStore<GitDiffState>;
  chatDrafts: KeyedExternalStore<string>;
  queuedChatDrafts: KeyedExternalStore<QueuedChatSubmission[]>;
  composerAttachments: KeyedExternalStore<ComposerAttachmentDraft[]>;
  composerSelections: KeyedExternalStore<ComposerSelection>;
  turnIds: KeyedExternalStore<string>;
  thinkingConversations: KeyedExternalStore<boolean>;
  contextUsage: KeyedExternalStore<MobileContextUsage>;
  pendingRequests: ExternalStore<PendingRequest[]>;
  connectionState: ExternalStore<ConnectionState>;
  outputActions: OutputRuntimeActions;
  bindOutputActions: (actions: OutputRuntimeActions) => void;
};

function recordById<Value extends { id: string }>(values: readonly Value[]): Record<string, Value> {
  return Object.fromEntries(values.map((value) => [value.id, value]));
}

export function createAppRuntime(timelineStore: TimelineStore): AppRuntime {
  const transaction = new RuntimeTransaction();
  let outputActionImplementations: OutputRuntimeActions | null = null;
  const getOutputActions = () => {
    if (!outputActionImplementations) throw new Error('App runtime output actions are not bound');
    return outputActionImplementations;
  };

  const runtime: AppRuntime = {
    transaction,
    timelineStore,
    routeSnapshots: new KeyedExternalStore(transaction),
    actions: new RuntimeActionRegistry(),
    workspaces: new KeyedExternalStore(transaction),
    conversations: new KeyedExternalStore(transaction),
    terminals: new KeyedExternalStore(transaction),
    gitDiffs: new KeyedExternalStore(transaction),
    chatDrafts: new KeyedExternalStore(transaction),
    queuedChatDrafts: new KeyedExternalStore(transaction),
    composerAttachments: new KeyedExternalStore(transaction),
    composerSelections: new KeyedExternalStore(transaction),
    turnIds: new KeyedExternalStore(transaction),
    thinkingConversations: new KeyedExternalStore(transaction),
    contextUsage: new KeyedExternalStore(transaction),
    pendingRequests: new ExternalStore<PendingRequest[]>([], transaction),
    connectionState: new ExternalStore<ConnectionState>('idle', transaction),
    outputActions: {
      startTerminalSession: (...args) => getOutputActions().startTerminalSession(...args),
      stopTerminalSession: (...args) => getOutputActions().stopTerminalSession(...args),
      sendTerminalInput: (...args) => getOutputActions().sendTerminalInput(...args),
      resizeTerminalSession: (...args) => getOutputActions().resizeTerminalSession(...args),
      requestTerminalStatus: (...args) => getOutputActions().requestTerminalStatus(...args),
      clearTerminalOutput: (...args) => getOutputActions().clearTerminalOutput(...args),
      requestGitDiff: (...args) => getOutputActions().requestGitDiff(...args),
    },
    bindOutputActions: (actions) => {
      outputActionImplementations = actions;
    },
  };
  return runtime;
}

export function syncRuntimeEntities(
  runtime: AppRuntime,
  workspaces: readonly WorkspaceRecord[],
  conversations: readonly ConversationRecord[],
): void {
  runtime.transaction.run(() => {
    runtime.workspaces.replace(recordById(workspaces));
    runtime.conversations.replace(recordById(conversations));
  });
}

const AppRuntimeContext = createContext<AppRuntime | null>(null);

export function AppRuntimeProvider({ runtime, children }: { runtime: AppRuntime; children: ReactNode }) {
  return <AppRuntimeContext.Provider value={runtime}>{children}</AppRuntimeContext.Provider>;
}

export function useAppRuntime(): AppRuntime {
  const runtime = useContext(AppRuntimeContext);
  if (!runtime) throw new Error('AppRuntimeProvider is missing');
  return runtime;
}

export function useKeyedStoreValue<Value>(store: KeyedExternalStore<Value>, key: string): Value | null {
  const subscribe = useCallback((listener: () => void) => store.subscribeKey(key, listener), [key, store]);
  const getSnapshot = useCallback(() => store.getSnapshot(key), [key, store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useAllKeyedStoreValues<Value>(store: KeyedExternalStore<Value>): Readonly<Record<string, Value>> {
  return useSyncExternalStore(store.subscribe, store.getAllSnapshot, store.getAllSnapshot);
}

export function useRouteSnapshot<Value>(key: string): Value | null {
  const { routeSnapshots } = useAppRuntime();
  return useKeyedStoreValue(routeSnapshots, key) as Value | null;
}

export function useConnectionState(): ConnectionState {
  const { connectionState } = useAppRuntime();
  return useSyncExternalStore(connectionState.subscribe, connectionState.getSnapshot, connectionState.getSnapshot);
}

export function useExternalStoreValue<Value>(store: ExternalStore<Value>): Value {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

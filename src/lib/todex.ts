export type AppTab = 'chat' | 'settings';

export type ConnectionSettings = {
  serverUrl: string;
  authToken: string;
  tenantId: string;
  defaultWorkspacePath: string;
  defaultThreadId: string;
  defaultModel: string;
  approvalPolicy: string;
  sandboxMode: string;
};

export type LocalAdapterState = 'idle' | 'starting' | 'running' | 'stopped' | 'error';

export type WorkspaceRecord = {
  id: string;
  name: string;
  path: string;
  sessionId: string;
  tenantId: string;
  threadId: string;
  model: string;
  approvalPolicy: string;
  sandboxMode: string;
  localAdapterState?: LocalAdapterState;
  createdAt: number;
  updatedAt: number;
};

export type ServerEvent = {
  event_id?: string;
  id?: string;
  type: string;
  cursor?: number | string;
  codex_session_id?: string;
  codex_thread_id?: string;
  codex_turn_id?: string;
  workspace_id?: string;
  window_id?: string;
  pane_id?: string;
  payload: unknown;
};

export type PendingRequest = {
  requestId: string;
  requestType: string;
  title: string;
  event: ServerEvent;
  data: Record<string, unknown>;
};

export type CommandContext = {
  settings: ConnectionSettings;
  workspace: WorkspaceRecord | null;
  threadId: string;
  turnId: string;
  prompt: string;
  selectedRequest: PendingRequest | null;
};

export type CommandPreset = {
  group: string;
  label: string;
  type: string;
  description: string;
  build: (ctx: CommandContext) => Record<string, unknown>;
};

export type SendableMessage = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
};

export function createRequestId(prefix = 'req'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeServerUrl(raw: string): string {
  const value = raw.trim();
  if (!value) {
    return 'http://127.0.0.1:7345';
  }

  if (/^https?:\/\//i.test(value) || /^wss?:\/\//i.test(value)) {
    return value;
  }

  return `http://${value}`;
}

export function buildHttpUrl(serverUrl: string, pathname: string): string {
  const url = normalizeServerUrl(serverUrl);
  const normalized = url.startsWith('ws://')
    ? url.replace(/^ws:\/\//i, 'http://')
    : url.startsWith('wss://')
      ? url.replace(/^wss:\/\//i, 'https://')
      : url;
  return new URL(pathname, normalized).toString();
}

export function buildWebSocketUrl(serverUrl: string): string {
  const url = normalizeServerUrl(serverUrl);
  if (url.startsWith('ws://') || url.startsWith('wss://')) {
    return new URL('/v1/ws', url).toString();
  }
  const normalized = url.startsWith('https://')
    ? url.replace(/^https:\/\//i, 'wss://')
    : url.replace(/^http:\/\//i, 'ws://');
  return new URL('/v1/ws', normalized).toString();
}

export function displayNameFromPath(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, '');
  if (!trimmed) {
    return 'Workspace';
  }
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || 'Workspace';
}

export function eventPayloadData(event: ServerEvent): Record<string, unknown> {
  if (isObject(event.payload) && isObject(event.payload.data)) {
    return event.payload.data;
  }
  return isObject(event.payload) ? event.payload : {};
}

export function eventId(event: ServerEvent): string {
  return String(event.event_id ?? event.id ?? createRequestId('event'));
}

export function requestIdFromEvent(event: ServerEvent): string | null {
  const data = eventPayloadData(event);
  const value = data.requestId ?? data.request_id ?? data.id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function requestTypeFromEvent(event: ServerEvent): string {
  return event.type;
}

export function isPendingRequestType(type: string): boolean {
  return (
    type.endsWith('.request') ||
    type === 'codex.tool.requestUserInput.request' ||
    type === 'codex.account.chatgptAuthTokens.refresh'
  );
}

export function isApprovalLikeRequest(type: string): boolean {
  return (
    type === 'codex.approval.commandExecution.request' ||
    type === 'codex.approval.fileChange.request' ||
    type === 'codex.approval.permissions.request' ||
    type === 'codex.tool.requestUserInput.request' ||
    type === 'codex.tool.call.request' ||
    type === 'codex.account.chatgptAuthTokens.refresh'
  );
}

export function inferApprovalResponseType(requestType: string): string {
  switch (requestType) {
    case 'codex.approval.commandExecution.request':
      return 'codex.approval.commandExecution.respond';
    case 'codex.approval.fileChange.request':
      return 'codex.approval.fileChange.respond';
    case 'codex.approval.permissions.request':
      return 'codex.approval.permissions.respond';
    case 'codex.tool.requestUserInput.request':
      return 'codex.tool.requestUserInput.respond';
    case 'codex.tool.call.request':
      return 'codex.tool.call.respond';
    case 'codex.account.chatgptAuthTokens.refresh':
      return 'codex.account.chatgptAuthTokens.refresh.respond';
    default:
      return 'codex.approval.permissions.respond';
  }
}

export function classifyPendingRequest(event: ServerEvent): PendingRequest | null {
  if (!isPendingRequestType(event.type)) {
    return null;
  }

  const requestId = requestIdFromEvent(event);
  if (!requestId) {
    return null;
  }

  const data = eventPayloadData(event);
  return {
    requestId,
    requestType: event.type,
    title: titleForRequest(event.type, data),
    event,
    data,
  };
}

export function titleForRequest(type: string, data: Record<string, unknown>): string {
  const requestId = String(data.requestId ?? data.request_id ?? '');
  const base = requestId ? `${requestId} · ` : '';

  switch (type) {
    case 'codex.approval.commandExecution.request':
      return `${base}command approval`;
    case 'codex.approval.fileChange.request':
      return `${base}file approval`;
    case 'codex.approval.permissions.request':
      return `${base}permission approval`;
    case 'codex.tool.requestUserInput.request':
      return `${base}question`;
    case 'codex.tool.call.request':
      return `${base}tool call`;
    case 'codex.account.chatgptAuthTokens.refresh':
      return `${base}token refresh`;
    default:
      return `${base}${type}`;
  }
}

export function summarizeEventType(type: string): string {
  if (type.startsWith('codex.local.')) {
    return type.replace('codex.local.', 'local · ');
  }
  if (type.startsWith('codex.cloudTask.')) {
    return type.replace('codex.cloudTask.', 'task · ');
  }
  if (type.startsWith('codex.approval.')) {
    return type.replace('codex.approval.', 'approval · ');
  }
  if (type.startsWith('codex.turn.')) {
    return type.replace('codex.turn.', 'turn · ');
  }
  if (type.startsWith('codex.thread.')) {
    return type.replace('codex.thread.', 'thread · ');
  }
  if (type.startsWith('codex.mcp.')) {
    return type.replace('codex.mcp.', 'mcp · ');
  }
  return type;
}

export function shortJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function createMessage(type: string, payload: Record<string, unknown>): SendableMessage {
  return {
    id: createRequestId('msg'),
    type,
    payload,
  };
}

export function approvalResponsePayload(request: PendingRequest, accepted: boolean): Record<string, unknown> {
  if (request.requestType === 'codex.tool.requestUserInput.request') {
    const questions = Array.isArray(request.data.questions) ? request.data.questions : [];
    const answers = questions.reduce<Record<string, { answers: string[] }>>((acc, question) => {
      if (isObject(question) && typeof question.id === 'string' && question.id) {
        acc[question.id] = { answers: accepted ? ['yes'] : ['no'] };
      }
      return acc;
    }, {});

    return {
      answers: Object.keys(answers).length > 0 ? answers : { response: { answers: accepted ? ['yes'] : ['no'] } },
    };
  }

  if (request.requestType === 'codex.tool.call.request') {
    return {
      decision: accepted ? 'accept' : 'deny',
    };
  }

  if (request.requestType === 'codex.account.chatgptAuthTokens.refresh') {
    return {
      decision: accepted ? 'accept' : 'deny',
    };
  }

  return {
    decision: accepted ? 'accept' : 'deny',
  };
}

function localSessionPayload(ctx: CommandContext): Record<string, unknown> {
  const workspace = ctx.workspace;
  return {
    codexSessionId: workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
    tenantId: ctx.settings.tenantId,
  };
}

function localCwdPayload(ctx: CommandContext): Record<string, unknown> {
  const workspace = ctx.workspace;
  return {
    codexSessionId: workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
    tenantId: ctx.settings.tenantId,
    cwd: workspace?.path ?? ctx.settings.defaultWorkspacePath,
  };
}

export const COMMAND_PRESETS: CommandPreset[] = [
  {
    group: 'Local session',
    label: 'codex.local.start',
    type: 'codex.local.start',
    description: 'Start a local Codex CLI adapter for the selected workspace.',
    build: (ctx) => ({
      ...localCwdPayload(ctx),
      model: ctx.settings.defaultModel || undefined,
      approvalPolicy: ctx.settings.approvalPolicy || undefined,
      sandboxMode: ctx.settings.sandboxMode || undefined,
      configOverrides: {},
    }),
  },
  {
    group: 'Local session',
    label: 'codex.local.status',
    type: 'codex.local.status',
    description: 'Read the current local adapter status.',
    build: (ctx) => localSessionPayload(ctx),
  },
  {
    group: 'Local session',
    label: 'codex.local.stop',
    type: 'codex.local.stop',
    description: 'Stop the local adapter.',
    build: (ctx) => ({
      ...localSessionPayload(ctx),
      force: false,
    }),
  },
  {
    group: 'Local session',
    label: 'codex.local.turn',
    type: 'codex.local.turn',
    description: 'Send a new turn to the local adapter.',
    build: (ctx) => ({
      ...localSessionPayload(ctx),
      threadId: ctx.threadId || ctx.settings.defaultThreadId,
      input: [{ type: 'text', text: ctx.prompt || 'Write a message for Codex.' }],
      collaborationMode: {
        mode: 'default',
        settings: {
          model: ctx.settings.defaultModel || undefined,
          developerInstructions: null,
        },
      },
    }),
  },
  {
    group: 'Local session',
    label: 'codex.local.input',
    type: 'codex.local.input',
    description: 'Append text to the active turn.',
    build: (ctx) => ({
      ...localSessionPayload(ctx),
      threadId: ctx.threadId || ctx.settings.defaultThreadId,
      turnId: ctx.turnId || '',
      input: [{ type: 'text', text: ctx.prompt || 'Continue.' }],
    }),
  },
  {
    group: 'Local session',
    label: 'codex.local.steer',
    type: 'codex.local.steer',
    description: 'Steer the active turn with a new input.',
    build: (ctx) => ({
      ...localSessionPayload(ctx),
      threadId: ctx.threadId || ctx.settings.defaultThreadId,
      turnId: ctx.turnId || '',
      expectedTurnId: ctx.turnId || undefined,
      input: [{ type: 'text', text: ctx.prompt || 'Adjust the plan.' }],
    }),
  },
  {
    group: 'Local session',
    label: 'codex.local.interrupt',
    type: 'codex.local.interrupt',
    description: 'Interrupt the active turn.',
    build: (ctx) => ({
      ...localSessionPayload(ctx),
      threadId: ctx.threadId || ctx.settings.defaultThreadId,
      turnId: ctx.turnId || undefined,
    }),
  },
  {
    group: 'Local session',
    label: 'codex.local.replay',
    type: 'codex.local.replay',
    description: 'Replay events after a cursor.',
    build: (ctx) => ({
      ...localSessionPayload(ctx),
      afterCursor: null,
      limit: 200,
    }),
  },
  {
    group: 'Local session',
    label: 'codex.local.attach',
    type: 'codex.local.attach',
    description: 'Attach to an existing session and replay recent events.',
    build: (ctx) => ({
      ...localSessionPayload(ctx),
      afterCursor: null,
      replayLimit: 200,
    }),
  },
  {
    group: 'Local session',
    label: 'codex.local.snapshot',
    type: 'codex.local.snapshot',
    description: 'Request a snapshot of the current local adapter state.',
    build: (ctx) => ({
      ...localSessionPayload(ctx),
      maxBytes: 65_536,
    }),
  },
  {
    group: 'Local session',
    label: 'codex.local.unsupported',
    type: 'codex.local.unsupported',
    description: 'Send a rejected local operation marker.',
    build: (ctx) => ({
      ...localSessionPayload(ctx),
      operation: 'codex.cloudTask.create',
      reason: 'operation is excluded from local Codex CLI control',
    }),
  },
  {
    group: 'Local session',
    label: 'codex.local.request',
    type: 'codex.local.request',
    description: 'Send an arbitrary local method request.',
    build: (ctx) => ({
      ...localSessionPayload(ctx),
      method: 'thread/start',
      params: {
        threadId: ctx.threadId || ctx.settings.defaultThreadId,
      },
    }),
  },
  {
    group: 'Approvals',
    label: 'codex.local.approval.respond',
    type: 'codex.local.approval.respond',
    description: 'Respond to the selected approval or question request.',
    build: (ctx) => {
      const request = ctx.selectedRequest;
      return {
        ...localSessionPayload(ctx),
        requestId: request?.requestId ?? '',
        responseType: request ? inferApprovalResponseType(request.requestType) : 'codex.approval.permissions.respond',
        response: request ? approvalResponsePayload(request, true) : { decision: 'accept' },
      };
    },
  },
  {
    group: 'Lifecycle',
    label: 'codex.thread.start',
    type: 'codex.thread.start',
    description: 'Start a Codex thread.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      payload: {
        threadId: ctx.threadId || ctx.settings.defaultThreadId,
      },
    }),
  },
  {
    group: 'Lifecycle',
    label: 'codex.turn.start',
    type: 'codex.turn.start',
    description: 'Start a Codex turn.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      payload: {
        threadId: ctx.threadId || ctx.settings.defaultThreadId,
        input: [{ type: 'text', text: ctx.prompt || 'Start the turn.' }],
      },
    }),
  },
  {
    group: 'Lifecycle',
    label: 'codex.turn.steer',
    type: 'codex.turn.steer',
    description: 'Steer a turn from the lifecycle gateway.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      payload: {
        threadId: ctx.threadId || ctx.settings.defaultThreadId,
        turnId: ctx.turnId || '',
        expectedTurnId: ctx.turnId || undefined,
        input: [{ type: 'text', text: ctx.prompt || 'Steer the turn.' }],
      },
    }),
  },
  {
    group: 'Lifecycle',
    label: 'codex.turn.interrupt',
    type: 'codex.turn.interrupt',
    description: 'Interrupt a lifecycle turn.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      payload: {
        threadId: ctx.threadId || ctx.settings.defaultThreadId,
        turnId: ctx.turnId || undefined,
      },
    }),
  },
  {
    group: 'MCP',
    label: 'codex.mcp.server.listStatus',
    type: 'codex.mcp.server.listStatus',
    description: 'List MCP server status.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      payload: {},
    }),
  },
  {
    group: 'MCP',
    label: 'codex.mcp.resource.read',
    type: 'codex.mcp.resource.read',
    description: 'Read an MCP resource.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      payload: {
        uri: ctx.prompt || 'file:///path/to/resource',
      },
    }),
  },
  {
    group: 'MCP',
    label: 'codex.mcp.tool.call',
    type: 'codex.mcp.tool.call',
    description: 'Call an MCP tool.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      payload: {
        name: ctx.prompt || 'tool-name',
        arguments: {},
      },
    }),
  },
  {
    group: 'MCP',
    label: 'codex.mcp.server.refresh',
    type: 'codex.mcp.server.refresh',
    description: 'Refresh MCP servers.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      payload: {},
    }),
  },
  {
    group: 'MCP',
    label: 'codex.mcp.oauth.login',
    type: 'codex.mcp.oauth.login',
    description: 'Start an MCP OAuth login flow.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      payload: {
        serverId: ctx.prompt || 'server-id',
      },
    }),
  },
  {
    group: 'MCP',
    label: 'codex.mcp.elicitation.respond',
    type: 'codex.mcp.elicitation.respond',
    description: 'Respond to an MCP elicitation prompt.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      payload: {
        requestId: ctx.selectedRequest?.requestId ?? '',
        action: 'accept',
        content: {},
        _meta: null,
      },
    }),
  },
  {
    group: 'Cloud tasks',
    label: 'codex.cloudTask.create',
    type: 'codex.cloudTask.create',
    description: 'Create a Codex cloud task.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      env_id: ctx.settings.tenantId,
      prompt: ctx.prompt || 'Describe the task.',
      git_ref: 'main',
      qa_mode: false,
      best_of_n: 1,
    }),
  },
  {
    group: 'Cloud tasks',
    label: 'codex.cloudTask.list',
    type: 'codex.cloudTask.list',
    description: 'List Codex cloud tasks.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      env: ctx.settings.tenantId,
      limit: 25,
      cursor: '',
    }),
  },
  {
    group: 'Cloud tasks',
    label: 'codex.cloudTask.getSummary',
    type: 'codex.cloudTask.getSummary',
    description: 'Get a cloud task summary.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      task_id: ctx.selectedRequest?.requestId ?? '',
    }),
  },
  {
    group: 'Cloud tasks',
    label: 'codex.cloudTask.getDiff',
    type: 'codex.cloudTask.getDiff',
    description: 'Get a cloud task diff.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      task_id: ctx.selectedRequest?.requestId ?? '',
    }),
  },
  {
    group: 'Cloud tasks',
    label: 'codex.cloudTask.getMessages',
    type: 'codex.cloudTask.getMessages',
    description: 'Get cloud task messages.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      task_id: ctx.selectedRequest?.requestId ?? '',
    }),
  },
  {
    group: 'Cloud tasks',
    label: 'codex.cloudTask.getText',
    type: 'codex.cloudTask.getText',
    description: 'Get cloud task text.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      task_id: ctx.selectedRequest?.requestId ?? '',
    }),
  },
  {
    group: 'Cloud tasks',
    label: 'codex.cloudTask.listSiblingAttempts',
    type: 'codex.cloudTask.listSiblingAttempts',
    description: 'List sibling task attempts.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      task_id: ctx.selectedRequest?.requestId ?? '',
      turn_id: ctx.turnId || '',
    }),
  },
  {
    group: 'Cloud tasks',
    label: 'codex.cloudTask.applyPreflight',
    type: 'codex.cloudTask.applyPreflight',
    description: 'Run a preflight apply.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      task_id: ctx.selectedRequest?.requestId ?? '',
      diff_override: null,
      turn_id: ctx.turnId || '',
      attempt_placement: 0,
    }),
  },
  {
    group: 'Cloud tasks',
    label: 'codex.cloudTask.apply',
    type: 'codex.cloudTask.apply',
    description: 'Apply a cloud task.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      task_id: ctx.selectedRequest?.requestId ?? '',
      diff_override: null,
      turn_id: ctx.turnId || '',
      attempt_placement: 0,
    }),
  },
  {
    group: 'Gateway',
    label: 'codex.gateway.control',
    type: 'codex.gateway.control',
    description: 'Issue a gateway control request.',
    build: (ctx) => ({
      codex_session_id: ctx.workspace?.sessionId ?? `cdxs_${createRequestId('session')}`,
      tenant_id: ctx.settings.tenantId,
      action: 'control',
    }),
  },
];

export function findCommandPreset(type: string): CommandPreset | undefined {
  return COMMAND_PRESETS.find((preset) => preset.type === type);
}

export function presetsByGroup(): Record<string, CommandPreset[]> {
  return COMMAND_PRESETS.reduce<Record<string, CommandPreset[]>>((groups, preset) => {
    if (!groups[preset.group]) {
      groups[preset.group] = [];
    }
    groups[preset.group].push(preset);
    return groups;
  }, {});
}

export function parseSlashCommand(input: string): {
  type: string;
  payload: Record<string, unknown>;
  requestId: string;
} | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const body = trimmed.slice(1).trim();
  if (!body) {
    return null;
  }

  const [command, ...rest] = body.split(/\s+/);
  const tail = rest.join(' ').trim();
  const commandLower = command.toLowerCase();

  if (commandLower === 'help') {
    return {
      type: 'codex.local.unsupported',
      payload: {
        operation: 'help',
        reason: 'open the Commands tab for the full protocol catalog',
      },
      requestId: createRequestId('help'),
    };
  }

  if (
    commandLower === 'permission' ||
    commandLower === 'approve' ||
    commandLower === 'approval'
  ) {
    const accepted = !/^(deny|decline|reject|no|false)$/i.test(rest[0] ?? 'accept');
    const requestId = rest[1] ?? '';
    return {
      type: 'codex.local.approval.respond',
      requestId: createRequestId('approval'),
      payload: {
        requestId,
        responseType: 'codex.approval.permissions.respond',
        response: {
          decision: accepted ? 'accept' : 'deny',
        },
      },
    };
  }

  if (commandLower === 'start') {
    return {
      type: 'codex.local.start',
      requestId: createRequestId('local-start'),
      payload: {
        cwd: tail || '',
      },
    };
  }

  if (commandLower === 'status') {
    return {
      type: 'codex.local.status',
      requestId: createRequestId('local-status'),
      payload: {},
    };
  }

  if (commandLower === 'stop') {
    return {
      type: 'codex.local.stop',
      requestId: createRequestId('local-stop'),
      payload: {
        force: /true|force|1/i.test(tail),
      },
    };
  }

  if (commandLower === 'turn') {
    return {
      type: 'codex.local.turn',
      requestId: createRequestId('local-turn'),
      payload: {
        text: tail,
      },
    };
  }

  if (commandLower === 'input') {
    return {
      type: 'codex.local.input',
      requestId: createRequestId('local-input'),
      payload: {
        text: tail,
      },
    };
  }

  if (commandLower === 'steer') {
    return {
      type: 'codex.local.steer',
      requestId: createRequestId('local-steer'),
      payload: {
        text: tail,
      },
    };
  }

  if (commandLower === 'interrupt') {
    return {
      type: 'codex.local.interrupt',
      requestId: createRequestId('local-interrupt'),
      payload: {},
    };
  }

  if (commandLower === 'replay') {
    return {
      type: 'codex.local.replay',
      requestId: createRequestId('local-replay'),
      payload: {},
    };
  }

  if (commandLower === 'attach') {
    return {
      type: 'codex.local.attach',
      requestId: createRequestId('local-attach'),
      payload: {},
    };
  }

  if (commandLower === 'snapshot') {
    return {
      type: 'codex.local.snapshot',
      requestId: createRequestId('local-snapshot'),
      payload: {},
    };
  }

  return null;
}

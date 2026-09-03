import { memo, useEffect } from 'react';

import { LOCAL_SESSION_IDLE_SWEEP_MS } from '../lib/appCore';
import { useAppRuntime, useConnectionState } from './appRuntime';

export const CONNECTION_LIFECYCLE_ACTIONS = 'actions:connection-lifecycle';

export type ConnectionLifecycleActions = {
  syncWorkspaces: () => void;
  suspendIdleSessions: () => void;
};

export const ConnectionRuntimeEffects = memo(function ConnectionRuntimeEffects() {
  const runtime = useAppRuntime();
  const connectionState = useConnectionState();
  const actions = runtime.actions.get<ConnectionLifecycleActions>(CONNECTION_LIFECYCLE_ACTIONS);

  useEffect(() => {
    if (connectionState !== 'open') return;
    const timer = setInterval(actions.syncWorkspaces, 15000);
    return () => clearInterval(timer);
  }, [actions, connectionState]);

  useEffect(() => {
    if (connectionState !== 'open') return;
    const timer = setInterval(actions.suspendIdleSessions, LOCAL_SESSION_IDLE_SWEEP_MS);
    return () => clearInterval(timer);
  }, [actions, connectionState]);

  return null;
});

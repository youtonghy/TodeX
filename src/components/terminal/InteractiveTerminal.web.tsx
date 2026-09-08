import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { InteractiveTerminalHandle, InteractiveTerminalProps } from './InteractiveTerminal';
import { terminalReplayDelta } from '../../lib/terminalReplay';
import { xtermCss } from './assets';

export const InteractiveTerminal = forwardRef<InteractiveTerminalHandle, InteractiveTerminalProps>(function InteractiveTerminal({ output, enabled, visible = true, onInput, onResize }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const cursor = useRef('');
  const [ready, setReady] = useState(false);
  const callbacks = useRef({ onInput, onResize, enabled, visible });
  callbacks.current = { onInput, onResize, enabled, visible };
  useImperativeHandle(ref, () => ({ focus: () => {
    if (enabled && visible) terminal.current?.focus();
  } }), [enabled, visible]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(([{ Terminal }, { FitAddon }]) => {
      if (disposed || !host.current) return;
      const term = new Terminal({ cursorBlink: true, disableStdin: true, fontSize: 14, lineHeight: 1.2, scrollback: 5000, theme: { background: '#171717', foreground: '#ededed' } });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host.current);
      terminal.current = term;
      const input = term.onData(data => {
        const current = callbacks.current;
        if (current.enabled && current.visible) current.onInput(data);
      });
      const reportSize = () => {
        if (callbacks.current.visible && term.rows >= 8 && term.cols >= 20) callbacks.current.onResize(Math.min(200, term.rows), Math.min(400, term.cols));
      };
      const resize = term.onResize(reportSize);
      const observer = new ResizeObserver(() => { if (callbacks.current.visible) fit.fit(); });
      observer.observe(host.current);
      fit.fit();
      reportSize();
      setReady(true);
      cleanup = () => { observer.disconnect(); input.dispose(); resize.dispose(); term.dispose(); terminal.current = null; };
    });
    return () => { disposed = true; cleanup?.(); };
  }, []);

  useEffect(() => {
    const term = terminal.current;
    if (!ready || !term) return;
    term.options.disableStdin = !enabled || !visible;
    if (!visible) return;
    const delta = terminalReplayDelta(output, cursor.current);
    if (delta.reset) term.reset();
    if (delta.data) term.write(delta.data);
    cursor.current = delta.cursor;
  }, [output, ready, enabled, visible]);

  return <div style={{ flex: 1, minHeight: 0, position: 'relative', background: '#171717' }}>
    <style>{xtermCss}</style>
    <div ref={host} style={{ position: 'absolute', inset: 0, padding: 8, overflow: 'hidden' }} />
  </div>;
});

export type { InteractiveTerminalHandle, InteractiveTerminalProps } from './InteractiveTerminal';

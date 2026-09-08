import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { WebView } from 'react-native-webview';
import type { TerminalOutputEntry } from '../../lib/appCore';
import { terminalReplayDelta } from '../../lib/terminalReplay';
import { xtermScript, fitScript, xtermCss } from './assets';

// PTY bytes are passed as data to write(), never interpolated into HTML.
const HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>${xtermCss}html,body,#terminal{width:100%;height:100%;margin:0;overflow:hidden;background:#171717}#terminal{box-sizing:border-box;padding:8px}</style></head><body><div id="terminal"></div><script>${xtermScript.replace(/<\/script/gi, '<\\/script')}</script><script>${fitScript.replace(/<\/script/gi, '<\\/script')}</script><script>
const term = new Terminal({cursorBlink:true,disableStdin:true,fontSize:14,lineHeight:1.2,scrollback:5000,theme:{background:'#171717',foreground:'#ededed'},allowProposedApi:false});
const fit = new FitAddon.FitAddon(); term.loadAddon(fit); term.open(document.getElementById('terminal'));
const post = value => window.ReactNativeWebView.postMessage(JSON.stringify(value));
term.onData(data => post({type:'input',data}));
term.onResize(({rows,cols}) => post({type:'resize',rows,cols}));
window.terminalFocus = () => { fit.fit(); term.focus(); };
window.terminalReceive = ({data,reset,enabled}) => { if(reset) term.reset(); if(typeof enabled==='boolean') term.options.disableStdin=!enabled; if(data) term.write(data); };
let timer; new ResizeObserver(() => { clearTimeout(timer); timer=setTimeout(()=>fit.fit(),100); }).observe(document.getElementById('terminal'));
fit.fit(); post({type:'ready',rows:term.rows,cols:term.cols});
</script></body></html>`;

export type InteractiveTerminalHandle = { focus: () => void };
export type InteractiveTerminalProps = {
  output: readonly TerminalOutputEntry[];
  enabled: boolean;
  visible?: boolean;
  onInput: (data: string) => void;
  onResize: (rows: number, cols: number) => void;
};

export const InteractiveTerminal = forwardRef<InteractiveTerminalHandle, InteractiveTerminalProps>(function InteractiveTerminal({ output, enabled, visible = true, onInput, onResize }, ref) {
  const webView = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const cursor = useRef('');
  useImperativeHandle(ref, () => ({ focus: () => {
    if (enabled && visible) {
      webView.current?.requestFocus();
      webView.current?.injectJavaScript('window.terminalFocus?.();true;');
    }
  } }), [enabled, visible]);
  const source = useMemo(() => ({ html: HTML }), []);
  useEffect(() => {
    if (!ready) return;
    const delta = visible ? terminalReplayDelta(output, cursor.current) : { data: '', reset: false, cursor: cursor.current };
    const { data, reset } = delta;
    webView.current?.injectJavaScript(`window.terminalReceive(${JSON.stringify({ data, reset, enabled: enabled && visible })});true;`);
    cursor.current = delta.cursor;
  }, [enabled, output, ready, visible]);
  return <WebView ref={webView} source={source} style={{ flex: 1, backgroundColor: '#171717' }}
    originWhitelist={['about:blank']} javaScriptEnabled scrollEnabled={false}
    keyboardDisplayRequiresUserAction={false} allowsLinkPreview={false}
    onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
    onLoadStart={() => { setReady(false); cursor.current = ''; }}
    onMessage={event => {
      try {
        const message = JSON.parse(event.nativeEvent.data);
        if (message.type === 'ready') setReady(true);
        if (message.type === 'input' && visible && enabled && typeof message.data === 'string') onInput(message.data);
        if (visible && (message.type === 'resize' || message.type === 'ready') && Number.isInteger(message.rows) && Number.isInteger(message.cols) && message.rows >= 8 && message.cols >= 20) onResize(Math.max(8, Math.min(200, message.rows)), Math.max(20, Math.min(400, message.cols)));
      } catch { /* Ignore malformed bridge messages. */ }
    }} />;
});

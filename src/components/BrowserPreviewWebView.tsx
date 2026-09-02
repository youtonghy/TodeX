import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Button } from 'heroui-native';

import { StyledIonicons } from './ui/StyledIonicons';
import type { BrowserFetchResult } from '../screens/BrowserScreen';
import {
  browserHtmlForWebView,
  browserLivePreviewUrl,
  browserPreviewNavigationAllowed,
  type MobileWorkbenchState,
} from '../lib/appCore';

export function BrowserPreviewWebView({
  result,
  backendUrl,
  onInspect,
}: {
  result: BrowserFetchResult;
  backendUrl: string;
  onInspect: (element: NonNullable<MobileWorkbenchState['inspectedElement']>) => void;
}) {
  const [inspectMode, setInspectMode] = useState(false);
  const [livePreviewFailed, setLivePreviewFailed] = useState(false);
  const livePreviewUrl = browserLivePreviewUrl(result.url, backendUrl);
  const livePreview = !inspectMode && Boolean(livePreviewUrl) && !livePreviewFailed;
  useEffect(() => {
    setLivePreviewFailed(false);
  }, [backendUrl, result.url]);
  return (
    <View className="flex-1">
      <View className="mb-2 flex-row items-center justify-end gap-2">
        <Button
          size="sm"
          variant={inspectMode ? 'secondary' : 'primary'}
          onPress={() => {
            setInspectMode(false);
            setLivePreviewFailed(false);
          }}
          className="min-h-11 rounded-lg"
        >
          <StyledIonicons name="navigate-outline" size={15} className={inspectMode ? 'text-foreground' : 'text-accent-foreground'} />
          <Button.Label>预览</Button.Label>
        </Button>
        <Button size="sm" variant={inspectMode ? 'primary' : 'secondary'} onPress={() => setInspectMode(true)} className="min-h-11 rounded-lg">
          <StyledIonicons name="scan-outline" size={15} className={inspectMode ? 'text-accent-foreground' : 'text-foreground'} />
          <Button.Label>检查</Button.Label>
        </Button>
      </View>
      <WebView
        key={inspectMode ? 'inspect' : livePreview ? 'live-preview' : 'static-preview'}
        style={{ flex: 1, minHeight: 240 }}
        originWhitelist={['*']}
        source={livePreview
          ? { uri: livePreviewUrl! }
          : { html: browserHtmlForWebView(result.body, result.url, inspectMode) }}
        javaScriptEnabled
        domStorageEnabled={livePreview}
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(request) => (
          browserPreviewNavigationAllowed(request.url, livePreviewUrl)
        )}
        onError={() => {
          if (livePreview) setLivePreviewFailed(true);
        }}
        onHttpError={() => {
          if (livePreview) setLivePreviewFailed(true);
        }}
        onMessage={(event) => {
          try {
            const value = JSON.parse(event.nativeEvent.data) as { type?: string; selector?: string; tagName?: string; text?: string };
            if (value.type === 'inspect') {
              onInspect({
                selector: value.selector || '',
                tagName: value.tagName || '',
                text: value.text || '',
              });
            }
          } catch {
            // Inspector messages are untrusted preview input and may not be JSON.
          }
        }}
      />
    </View>
  );
}

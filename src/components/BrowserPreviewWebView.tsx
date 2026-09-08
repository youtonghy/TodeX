import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Button, useToast } from 'heroui-native';

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
  const { toast } = useToast();
  const reportError = () => {
    if (livePreview) setLivePreviewFailed(true);
    toast.show({ variant: 'danger', label: '网页加载失败', description: livePreview ? '已切换到静态预览，请稍后刷新重试。' : '请稍后刷新重试。', placement: 'top', duration: 3000 });
  };
  const [inspectMode, setInspectMode] = useState(false);
  const [livePreviewFailed, setLivePreviewFailed] = useState(false);
  const livePreviewUrl = browserLivePreviewUrl(result.url, backendUrl);
  const livePreview = !inspectMode && Boolean(livePreviewUrl) && !livePreviewFailed;
  useEffect(() => {
    setLivePreviewFailed(false);
  }, [backendUrl, result.url]);
  return (
    <View className="flex-1">
      <WebView
        key={inspectMode ? 'inspect' : livePreview ? 'live-preview' : 'static-preview'}
        style={{ flex: 1, minHeight: 0 }}
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
        onError={reportError}
        onHttpError={reportError}
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
      <View pointerEvents="box-none" className="absolute bottom-3 right-3">
        <Button size="sm" variant={inspectMode ? 'primary' : 'secondary'} accessibilityLabel={inspectMode ? '退出元素检查' : '检查页面元素'} onPress={() => {
          setInspectMode(value => !value);
          setLivePreviewFailed(false);
        }} className="h-11 rounded-full shadow-sm">
          <StyledIonicons name={inspectMode ? 'close-outline' : 'scan-outline'} size={16} className={inspectMode ? 'text-accent-foreground' : 'text-foreground'} />
          <Button.Label>{inspectMode ? '完成检查' : '检查'}</Button.Label>
        </Button>
      </View>
    </View>
  );
}

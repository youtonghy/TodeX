import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Button, Input, Text, useToast } from 'heroui-native';
import { ProgressBar } from 'heroui-native-pro/progress-bar';

import type { V2ApiClient } from '../lib/v2';
import { validateLoopbackUrl as validateSharedLoopbackUrl } from '../lib/mobileParity';
import { AppSheet, EmptyStateView, StyledIonicons } from '../components/ui';

export type BrowserClient = Pick<V2ApiClient, 'fetchBrowser' | 'readWorkspaceFile'>;
export type BrowserFetchResult = Awaited<ReturnType<V2ApiClient['fetchBrowser']>>;

export type BrowserUrlValidation =
  | { ok: true; url: string }
  | { ok: false; error: string };

export type BrowserScreenProps = {
  client: BrowserClient;
  initialUrl?: string;
  initialFilePath?: string;
  renderWebView?: (result: BrowserFetchResult) => ReactNode;
  onResult?: (result: BrowserFetchResult) => void;
};

const MAX_PREVIEW_CHARS = 200_000;

export function validateLoopbackUrl(value: string): BrowserUrlValidation {
  const validation = validateSharedLoopbackUrl(value);
  return validation.ok
    ? validation
    : { ok: false, error: validation.reason === 'missing URL' ? '请输入本机 HTTP 地址' : validation.reason };
}

export function BrowserScreen({ client, initialUrl = 'http://127.0.0.1:7345', initialFilePath, renderWebView, onResult }: BrowserScreenProps) {
  const [draft, setDraft] = useState(initialUrl);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [result, setResult] = useState<BrowserFetchResult | null>(null);
  const { toast } = useToast();
  const showError = useCallback((description: string) => {
    toast.show({ variant: 'danger', label: '无法打开网页', description, placement: 'top', duration: 3000 });
  }, [toast]);
  const [loading, setLoading] = useState(false);
  const [loadedUrl, setLoadedUrl] = useState('');
  const requestRef = useRef(0);
  const loadedClientRef = useRef<BrowserClient | null>(null);
  useEffect(() => () => { requestRef.current += 1; }, []);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const notifyResult = useCallback((value: BrowserFetchResult) => {
    onResultRef.current?.(value);
  }, []);

  const load = useCallback(async (value: string) => {
    const request = ++requestRef.current;
    const validation = validateLoopbackUrl(value);
    if (!validation.ok) {
      setResult(null);
      setLoadedUrl('');
      showError(validation.error);
      setLoading(false);
      return false;
    }
    setDraft(validation.url);
    setLoading(true);
    try {
      const fetched = await client.fetchBrowser(validation.url);
      if (request !== requestRef.current) return false;
      loadedClientRef.current = client;
      setResult(fetched);
      setLoadedUrl(validation.url);
      notifyResult(fetched);
      return true;
    } catch (reason) {
      if (request !== requestRef.current) return false;
      setResult(null);
      setLoadedUrl('');
      showError(reason instanceof Error ? reason.message : '网页读取失败');
      return false;
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [client, notifyResult, showError]);

  useEffect(() => {
    if (initialFilePath) {
      const request = ++requestRef.current;
      setLoading(true);
      void client.readWorkspaceFile(initialFilePath)
        .then((file) => {
          if (request !== requestRef.current) return;
          const fetched: BrowserFetchResult = {
            url: file.path,
            status: 200,
            contentType: file.mimeType,
            body: file.text || '',
          };
          setResult(fetched);
          setLoadedUrl(file.path);
          notifyResult(fetched);
        })
        .catch((reason) => {
          if (request !== requestRef.current) return;
          setResult(null);
          setLoadedUrl('');
          showError(reason instanceof Error ? reason.message : '文件读取失败');
        })
        .finally(() => { if (request === requestRef.current) setLoading(false); });
      return;
    }
    if (!initialUrl) return;
    // Avoid refetching a successful local navigation echoed by the shared store.
    if (initialUrl === loadedUrl && loadedClientRef.current === client) return;
    void load(initialUrl);
  }, [client, initialFilePath, initialUrl, load, notifyResult, showError]);

  const body = result?.body || '';
  const clippedBody = body.length > MAX_PREVIEW_CHARS ? `${body.slice(0, MAX_PREVIEW_CHARS)}\n\n[预览已截断]` : body;
  const navigate = () => { Keyboard.dismiss(); void load(draft); };

  return (
    <View className="flex-1 bg-background">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View className="flex-row items-center gap-1 border-b border-separator px-2 py-2">
          <Input
            containerClassName="min-w-0 flex-1"
            value={draft}
            onChangeText={setDraft}
            placeholder="输入本机网页地址"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={navigate}
            accessibilityLabel="网页地址"
            className="h-11 min-h-11 rounded-xl px-3 text-sm"
          />
          <Button isIconOnly size="sm" variant="ghost" accessibilityLabel={draft === loadedUrl ? '刷新网页' : '打开网页'} isDisabled={loading} onPress={navigate} className="h-11 w-11 rounded-full">
            <StyledIonicons name={draft === loadedUrl ? 'refresh-outline' : 'arrow-forward'} size={20} className="text-foreground" />
          </Button>
          <Button isIconOnly size="sm" variant="ghost" accessibilityLabel="页面信息" onPress={() => setDetailsVisible(true)} className="h-11 w-11 rounded-full">
            <StyledIonicons name="ellipsis-horizontal" size={20} className="text-foreground" />
          </Button>
        </View>
        {loading ? <ProgressBar isIndeterminate size="sm" color="accent"><ProgressBar.Track className="h-0.5"><ProgressBar.Fill /></ProgressBar.Track></ProgressBar> : null}
        {result ? (
          <View className="min-h-0 flex-1">
            {renderWebView ? renderWebView(result) : (
              <ScrollView contentContainerClassName="p-4">
                <Text selectable type="code" className="bg-transparent px-0 text-[13px] leading-5 text-foreground">
                  {clippedBody || '页面没有返回内容。'}
                </Text>
              </ScrollView>
            )}
          </View>
        ) : (
          <EmptyStateView icon="globe-outline" title="预览开发中的网页" description="输入后端机器上的 localhost 地址。" className="flex-1 justify-center px-6" />
        )}
      </KeyboardAvoidingView>
      <AppSheet isOpen={detailsVisible} onOpenChange={setDetailsVisible} title="页面信息">
        <View className="gap-3">
          <Text selectable type="body-sm">{loadedUrl || draft}</Text>
          {result ? <Text type="body-sm" color="muted">{result.status} · {result.contentType || 'text/html'}</Text> : null}
          <Text type="body-sm" color="muted">支持后端机器的 localhost、127.0.0.0/8 和 ::1 地址。</Text>
        </View>
      </AppSheet>
    </View>
  );
}

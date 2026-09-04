import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Button, Chip, Input, Surface, Text } from 'heroui-native';
import { ProgressBar } from 'heroui-native-pro';

import type { V2ApiClient } from '../lib/v2';
import { validateLoopbackUrl as validateSharedLoopbackUrl } from '../lib/mobileParity';
import { EmptyStateView, InlineNotice, Screen, StyledIonicons } from '../components/ui';

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
  const [result, setResult] = useState<BrowserFetchResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadedUrl, setLoadedUrl] = useState('');
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const notifyResult = useCallback((value: BrowserFetchResult) => {
    onResultRef.current?.(value);
  }, []);

  const load = useCallback(async (value: string) => {
    const validation = validateLoopbackUrl(value);
    if (!validation.ok) {
      setResult(null);
      setLoadedUrl('');
      setError(validation.error);
      return false;
    }
    setDraft(validation.url);
    setLoading(true);
    setError('');
    try {
      const fetched = await client.fetchBrowser(validation.url);
      setResult(fetched);
      setLoadedUrl(validation.url);
      notifyResult(fetched);
      return true;
    } catch (reason) {
      setResult(null);
      setLoadedUrl('');
      setError(reason instanceof Error ? reason.message : '网页读取失败');
      return false;
    } finally {
      setLoading(false);
    }
  }, [client, notifyResult]);

  useEffect(() => {
    if (initialFilePath) {
      setLoading(true);
      setError('');
      void client.readWorkspaceFile(initialFilePath)
        .then((file) => {
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
          setResult(null);
          setLoadedUrl('');
          setError(reason instanceof Error ? reason.message : '文件读取失败');
        })
        .finally(() => setLoading(false));
      return;
    }
    if (!initialUrl) return;
    setDraft(initialUrl);
    const validation = validateLoopbackUrl(initialUrl);
    if (!validation.ok) {
      setError(validation.error);
      setResult(null);
      setLoadedUrl('');
      return;
    }
    void load(validation.url);
  }, [client, initialFilePath, initialUrl, load, notifyResult]);

  const body = result?.body || '';
  const clippedBody = body.length > MAX_PREVIEW_CHARS ? `${body.slice(0, MAX_PREVIEW_CHARS)}\n\n[预览已截断]` : body;
  const statusOk = result ? result.status >= 200 && result.status < 400 : false;

  return (
    <Screen>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View className="gap-2 px-4 pb-3 pt-3">
          <View className="flex-row items-center gap-2">
            <View className="flex-row items-center gap-1.5">
              <View className="h-2.5 w-2.5 rounded-full bg-danger/70" />
              <View className="h-2.5 w-2.5 rounded-full bg-warning/70" />
              <View className="h-2.5 w-2.5 rounded-full bg-success/70" />
            </View>
            <Input
              containerClassName="flex-1"
              value={draft}
              onChangeText={setDraft}
              placeholder="http://127.0.0.1:7345"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={() => void load(draft)}
              accessibilityLabel="本机地址"
              className="min-h-11 flex-1 rounded-full px-4 font-mono text-sm"
            />
            <Button isIconOnly size="md" variant="primary" accessibilityLabel="打开" isDisabled={loading} onPress={() => void load(draft)} className="h-11 w-11 rounded-full">
              <StyledIonicons name={loading ? 'hourglass-outline' : 'arrow-forward'} size={18} className="text-accent-foreground" />
            </Button>
          </View>
          {loading ? (
            <ProgressBar isIndeterminate size="sm" color="accent">
              <ProgressBar.Track className="h-0.5">
                <ProgressBar.Fill />
              </ProgressBar.Track>
            </ProgressBar>
          ) : (
            <Text type="body-xs" color="muted" className="px-1">
              仅允许访问 localhost、127.0.0.0/8 或 ::1。
            </Text>
          )}
          {error ? <InlineNotice status="danger" title="无法打开" description={error} /> : null}
        </View>

        {result ? (
          <Surface className="mx-4 mb-4 min-h-0 flex-1 overflow-hidden rounded-3xl">
            <View className="flex-row items-center justify-between gap-2 border-b border-separator px-4 py-2.5">
              <View className="min-w-0 flex-1">
                <Text type="body-sm" weight="semibold" className="font-mono text-foreground" numberOfLines={1}>
                  {loadedUrl}
                </Text>
                <Text type="body-xs" color="muted" numberOfLines={1}>
                  {result.contentType || 'text/html'}
                </Text>
              </View>
              <Chip size="sm" variant="soft" color={statusOk ? 'success' : 'danger'}>
                <Chip.Label>{result.status}</Chip.Label>
              </Chip>
            </View>
            <View className="flex-1 p-3">
              {renderWebView ? renderWebView(result) : (
                <ScrollView contentContainerClassName="pb-6">
                  <Text type="body-xs" color="muted" className="mb-2">
                    HTML 文本预览（接入 WebView 时传入 renderWebView 插槽）
                  </Text>
                  <Text selectable type="code" className="bg-transparent px-0 text-[12px] leading-[18px] text-foreground">
                    {clippedBody || '页面没有返回内容。'}
                  </Text>
                </ScrollView>
              )}
            </View>
          </Surface>
        ) : (
          <EmptyStateView
            icon="globe-outline"
            title="本机网页预览"
            description="输入 loopback 地址后查看后端返回的 HTML。"
            className="flex-1 justify-center"
          />
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

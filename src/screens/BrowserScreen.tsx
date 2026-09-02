import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip, Input, Surface, Text as HeroText, TextField } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';
import type { V2ApiClient } from '../lib/v2';
import { validateLoopbackUrl as validateSharedLoopbackUrl } from '../lib/mobileParity';

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

  return (
    <Surface className="flex-1 bg-background">
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View className="px-4 pb-3 pt-4">
          <View className="flex-row items-center gap-2">
            <Ionicons name="globe-outline" size={20} color="#2b7a70" />
            <HeroText className="text-xl font-semibold text-foreground">浏览器</HeroText>
          </View>
          <HeroText className="mt-1 text-xs text-muted">仅允许访问 localhost、127.0.0.0/8 或 ::1。</HeroText>
          <View className="mt-3 flex-row items-end gap-2">
            <TextField className="min-w-0 flex-1" aria-label="本机地址">
              <Input
                value={draft}
                onChangeText={setDraft}
                placeholder="http://127.0.0.1:7345"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                onSubmitEditing={() => void load(draft)}
              />
            </TextField>
            <Button size="md" variant="primary" isDisabled={loading} onPress={() => void load(draft)}>
              {loading ? <ActivityIndicator color="#ffffff" size="small" /> : <Ionicons name="arrow-forward-outline" size={17} color="#ffffff" />}
              <Button.Label>打开</Button.Label>
            </Button>
          </View>
          {error ? <HeroText className="mt-2 text-xs text-danger" numberOfLines={3}>{error}</HeroText> : null}
        </View>

        {result ? (
          <View className="flex-1 px-4 pb-4">
            <Card variant="transparent" className="flex-1 border border-separator bg-surface px-3 py-3">
              <View className="flex-row items-center justify-between gap-2 border-b border-separator pb-3">
                <View className="min-w-0 flex-1">
                  <HeroText className="text-sm font-semibold text-foreground" numberOfLines={1}>{loadedUrl}</HeroText>
                  <HeroText className="mt-1 text-[11px] text-muted" numberOfLines={1}>{result.contentType || 'text/html'}</HeroText>
                </View>
                <Chip size="sm" color={result.status >= 200 && result.status < 400 ? 'success' : 'danger'} variant="secondary"><Text>{result.status}</Text></Chip>
              </View>
              <View className="flex-1 pt-3">
                {renderWebView ? renderWebView(result) : (
                  <ScrollView contentContainerStyle={styles.bodyContent}>
                    <HeroText className="mb-2 text-[11px] text-muted">HTML 文本预览（接入 WebView 时传入 renderWebView 插槽）</HeroText>
                    <Text selectable style={styles.bodyText}>{clippedBody || '页面没有返回内容。'}</Text>
                  </ScrollView>
                )}
              </View>
            </Card>
          </View>
        ) : (
          <View className="flex-1 items-center justify-center px-8">
            <Ionicons name="globe-outline" size={32} color="#7a8391" />
            <HeroText className="mt-3 text-sm font-semibold text-foreground">本机网页预览</HeroText>
            <HeroText className="mt-1 text-center text-xs text-muted">输入 loopback 地址后查看后端返回的 HTML。</HeroText>
          </View>
        )}
      </KeyboardAvoidingView>
    </Surface>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bodyContent: { paddingBottom: 24 },
  bodyText: { color: '#26323d', fontFamily: 'Courier', fontSize: 12, lineHeight: 18 },
});

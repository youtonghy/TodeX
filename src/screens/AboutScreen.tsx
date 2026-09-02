import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button, Card, Chip, Surface, Text as HeroText } from 'heroui-native';
import { Ionicons } from '@expo/vector-icons';

export type AboutScreenProps = {
  appVersion?: string;
  backendVersion?: string;
  backendUrl?: string;
  workspacePath?: string;
  dataDirectory?: string;
  connectionState?: string;
  projectUrl?: string;
  onCopy?: (value: string, label: string) => void | Promise<void>;
};

function InfoRow({ label, value, onCopy }: { label: string; value: string; onCopy?: () => void }) {
  return (
    <View className="flex-row items-center justify-between gap-3 border-b border-separator py-3">
      <HeroText className="shrink-0 text-xs text-muted">{label}</HeroText>
      <View className="min-w-0 flex-1 flex-row items-center justify-end gap-2">
        <HeroText className="flex-1 text-right text-sm font-semibold text-foreground" numberOfLines={2}>{value}</HeroText>
        {onCopy ? (
          <Button isIconOnly size="sm" variant="ghost" accessibilityLabel={`复制${label}`} onPress={onCopy}>
            <Ionicons name="copy-outline" size={16} color="#52606b" />
          </Button>
        ) : null}
      </View>
    </View>
  );
}

export function AboutScreen({
  appVersion = 'unknown',
  backendVersion = '未获取',
  backendUrl = '',
  workspacePath = '',
  dataDirectory = '',
  connectionState = 'unknown',
  projectUrl = 'https://github.com/youtonghy/TodeX_app',
  onCopy,
}: AboutScreenProps) {
  const [copied, setCopied] = useState('');
  const [copyError, setCopyError] = useState('');
  const connected = connectionState === 'open';

  const copy = async (value: string, label: string) => {
    if (!value) return;
    try {
      if (onCopy) await onCopy(value, label);
      else await Clipboard.setStringAsync(value);
      setCopied(label);
      setCopyError('');
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : `${label}复制失败`);
    }
  };

  return (
    <Surface className="flex-1 bg-background">
      <View className="px-4 pb-8 pt-5">
        <View className="flex-row items-center gap-3">
          <View style={styles.logo}>
            <Ionicons name="information-outline" size={24} color="#ffffff" />
          </View>
          <View className="min-w-0 flex-1">
            <View className="flex-row items-center gap-2">
              <HeroText className="text-xl font-semibold text-foreground">TodeX</HeroText>
              <Chip size="sm" variant="secondary"><Text>v{appVersion}</Text></Chip>
            </View>
            <HeroText className="mt-1 text-xs text-muted" numberOfLines={2}>统一连接 Codex、Pi、Claude Code 等 Agent 的移动工作台。</HeroText>
          </View>
        </View>

        <Card variant="transparent" className="mt-5 border border-separator bg-surface px-4 py-3">
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-row items-center gap-2">
              <Ionicons name="server-outline" size={17} color="#66717c" />
              <HeroText className="font-semibold text-foreground">运行信息</HeroText>
            </View>
            <Chip size="sm" color={connected ? 'success' : 'default'} variant="secondary"><Text>{connectionState}</Text></Chip>
          </View>
          <InfoRow label="移动端版本" value={appVersion} />
          <InfoRow label="后端版本" value={backendVersion} />
          <InfoRow label="后端地址" value={backendUrl || '未配置'} onCopy={backendUrl ? () => void copy(backendUrl, '后端地址') : undefined} />
          <InfoRow label="工作区" value={workspacePath || '未选择'} onCopy={workspacePath ? () => void copy(workspacePath, '工作区') : undefined} />
          <InfoRow label="数据目录" value={dataDirectory || '未获取'} onCopy={dataDirectory ? () => void copy(dataDirectory, '数据目录') : undefined} />
        </Card>

        <Card variant="transparent" className="mt-3 border border-separator bg-surface px-4 py-4">
          <View className="flex-row items-start gap-3">
            <Ionicons name="logo-github" size={21} color="#52606b" />
            <View className="min-w-0 flex-1">
              <HeroText className="font-semibold text-foreground">项目地址</HeroText>
              <HeroText className="mt-1 text-xs text-muted" numberOfLines={2}>{projectUrl}</HeroText>
            </View>
            <Button size="sm" variant="secondary" onPress={() => void copy(projectUrl, '项目地址')}>
              <Ionicons name="copy-outline" size={15} color="#52606b" />
              <Button.Label>复制</Button.Label>
            </Button>
          </View>
        </Card>
        {copied ? <HeroText className="mt-3 text-center text-xs text-success">已复制{copied}</HeroText> : null}
        {copyError ? <HeroText className="mt-3 text-center text-xs text-danger">{copyError}</HeroText> : null}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  logo: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#2b7a70' },
});


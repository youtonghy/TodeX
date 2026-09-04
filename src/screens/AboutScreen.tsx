import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button, Chip, Surface, Text } from 'heroui-native';

import { ConnectionChip, ListRow, ListSection, Screen, ScreenScrollView, SectionHeader, StyledIonicons, useAppToast, useResponsive } from '../components/ui';

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
  const toast = useAppToast();
  const { isLandscapeOrWide } = useResponsive();

  const copy = async (value: string, label: string) => {
    if (!value) return;
    try {
      if (onCopy) await onCopy(value, label);
      else await Clipboard.setStringAsync(value);
      toast.success(`已复制${label}`, value);
    } catch (error) {
      toast.error(`${label}复制失败`, error instanceof Error ? error.message : undefined);
    }
  };

  const copyButton = (value: string, label: string) => (
    <Button isIconOnly size="sm" variant="ghost" accessibilityLabel={`复制${label}`} onPress={() => void copy(value, label)} className="h-8 w-8 rounded-full">
      <StyledIonicons name="copy-outline" size={15} className="text-muted" />
    </Button>
  );

  const runtimeSection = (
    <View className="gap-2">
      <SectionHeader title="运行信息" />
      <ListSection>
        <ListRow icon="phone-portrait-outline" title="移动端版本" suffix={<Text type="body-sm" weight="medium" className="font-mono text-foreground">{appVersion}</Text>} />
        <ListRow icon="server-outline" title="后端版本" suffix={<Text type="body-sm" weight="medium" className="font-mono text-foreground">{backendVersion}</Text>} />
        <ListRow
          icon="link-outline"
          title="后端地址"
          description={backendUrl || '未配置'}
          descriptionLines={2}
          suffix={backendUrl ? copyButton(backendUrl, '后端地址') : undefined}
        />
        <ListRow
          icon="folder-open-outline"
          title="工作区"
          description={workspacePath || '未选择'}
          descriptionLines={2}
          suffix={workspacePath ? copyButton(workspacePath, '工作区') : undefined}
        />
        <ListRow
          icon="file-tray-full-outline"
          title="数据目录"
          description={dataDirectory || '未获取'}
          descriptionLines={2}
          suffix={dataDirectory ? copyButton(dataDirectory, '数据目录') : undefined}
        />
      </ListSection>
    </View>
  );

  const projectSection = (
    <View className="gap-2">
      <SectionHeader title="项目" />
      <ListSection>
        <ListRow
          icon="logo-github"
          title="项目地址"
          description={projectUrl}
          descriptionLines={2}
          onPress={() => void copy(projectUrl, '项目地址')}
          suffix={copyButton(projectUrl, '项目地址')}
        />
      </ListSection>
    </View>
  );

  return (
    <Screen>
      <ScreenScrollView>
        <Surface className="items-center gap-3 rounded-3xl px-4 py-6">
          <View className="h-16 w-16 items-center justify-center rounded-3xl bg-accent">
            <Text type="h2" className="text-accent-foreground">
              T
            </Text>
          </View>
          <View className="items-center gap-1">
            <View className="flex-row items-center gap-2">
              <Text type="h3" className="text-foreground">
                TodeX
              </Text>
              <Chip size="sm" variant="soft" color="accent">
                <Chip.Label>v{appVersion}</Chip.Label>
              </Chip>
            </View>
            <Text type="body-sm" color="muted" align="center">
              统一连接 Codex、Pi、Claude Code 等 Agent 的移动工作台。
            </Text>
          </View>
          <ConnectionChip state={connectionState} size="md" />
        </Surface>

        {isLandscapeOrWide ? (
          <View className="flex-row items-start gap-4">
            <View className="flex-1">
              {runtimeSection}
            </View>
            <View className="flex-1">
              {projectSection}
            </View>
          </View>
        ) : (
          <>
            {runtimeSection}
            {projectSection}
          </>
        )}
      </ScreenScrollView>
    </Screen>
  );
}

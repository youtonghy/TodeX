import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button, Surface, Text } from 'heroui-native';

import { shortJson } from '../../lib/todex';
import { AppSheet, StyledIonicons, useAppToast } from '../ui';

export function ThreadInfoModal({
  visible,
  title,
  detail,
  raw,
  onClose,
}: {
  visible: boolean;
  title: string;
  detail: string;
  raw?: unknown;
  onClose: () => void;
}) {
  const toast = useAppToast();
  const rawText = raw === undefined ? '' : shortJson(raw);
  const copyDetail = async () => {
    await Clipboard.setStringAsync(rawText || detail);
    toast.success('已复制', 'Thread 结果已复制到剪贴板');
  };
  return (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      snapPoints={['55%', '90%']}
      footer={
        <View className="flex-row gap-2">
          <Button variant="secondary" className="flex-1 rounded-xl" onPress={() => void copyDetail()}>
            <StyledIonicons name="copy-outline" size={16} className="text-foreground" />
            <Button.Label>复制</Button.Label>
          </Button>
          <Button variant="primary" className="flex-1 rounded-xl" onPress={onClose}>
            <Button.Label>关闭</Button.Label>
          </Button>
        </View>
      }
    >
      <View className="gap-3">
        {detail ? (
          <Text selectable type="body" className="leading-6 text-foreground">
            {detail}
          </Text>
        ) : null}
        {rawText ? (
          <Surface variant="secondary" className="gap-2 rounded-2xl p-3">
            <Text type="body-xs" weight="semibold" className="uppercase tracking-wide text-muted">
              Raw JSON
            </Text>
            <Text selectable type="code" className="text-xs leading-5 text-foreground">
              {rawText}
            </Text>
          </Surface>
        ) : null}
      </View>
    </AppSheet>
  );
}

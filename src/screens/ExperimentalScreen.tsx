import { useCallback, useState } from 'react';
import { View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Chip, Switch } from 'heroui-native';

import type { WorkspaceRecord } from '../lib/todex';
import {
  EXPERIMENTAL_FEATURES,
  EXPERIMENTAL_FEATURE_DEFAULTS,
  type ConversationRecord,
  type ExperimentalFeatureId,
  type ExperimentalFeatureSettings,
  type RootStackParamList,
} from '../lib/appCore';
import {
  ConfirmDialog,
  InlineNotice,
  ListRow,
  ListSection,
  Screen,
  ScreenIntro,
  ScreenScrollView,
  SectionHeader,
  StyledIonicons,
} from '../components/ui';

export function ExperimentalScreen({
  workspace,
  conversation,
  features,
  setFeatures,
}: NativeStackScreenProps<RootStackParamList, 'Experimental'> & {
  workspace: WorkspaceRecord | null;
  conversation: ConversationRecord | null;
  features: ExperimentalFeatureSettings;
  setFeatures: React.Dispatch<React.SetStateAction<ExperimentalFeatureSettings>>;
}) {
  const [resetVisible, setResetVisible] = useState(false);
  const enabledCount = EXPERIMENTAL_FEATURES.filter((feature) => features[feature.id]).length;
  const toggleFeature = useCallback((featureId: ExperimentalFeatureId, enabled: boolean) => {
    setFeatures((current) => ({
      ...current,
      [featureId]: enabled,
    }));
  }, [setFeatures]);

  return (
    <Screen>
      <ScreenScrollView>
        <ScreenIntro
          description={`${workspace?.name || '当前工作区'} · ${conversation?.title || '当前对话'}`}
          trailing={
            <Chip size="sm" variant="soft" color={enabledCount > 0 ? 'accent' : 'default'}>
              <Chip.Label>
                {enabledCount}/{EXPERIMENTAL_FEATURES.length} 已开启
              </Chip.Label>
            </Chip>
          }
        />
        <InlineNotice
          status="accent"
          title="测试性功能"
          description="开关会保存在本机；关闭后不会删除任何已有对话或工作区数据。"
          action={
            <Button size="sm" variant="secondary" onPress={() => setResetVisible(true)} className="rounded-full">
              <StyledIonicons name="refresh-outline" size={14} className="text-foreground" />
              <Button.Label>恢复默认</Button.Label>
            </Button>
          }
        />
        <View className="gap-2">
          <SectionHeader title="功能开关" />
          <ListSection>
            {EXPERIMENTAL_FEATURES.map((feature) => {
              const enabled = features[feature.id];
              return (
                <ListRow
                  key={feature.id}
                  title={feature.title}
                  description={`${feature.description} · ${feature.scope}`}
                  descriptionLines={3}
                  icon="flask-outline"
                  iconClassName={enabled ? 'bg-accent/15' : 'bg-default'}
                  iconColorClassName={enabled ? 'text-accent' : 'text-muted'}
                  onPress={() => toggleFeature(feature.id, !enabled)}
                  suffix={<Switch isSelected={enabled} onSelectedChange={(value) => toggleFeature(feature.id, value)} />}
                />
              );
            })}
          </ListSection>
        </View>
      </ScreenScrollView>

      <ConfirmDialog
        isOpen={resetVisible}
        onOpenChange={setResetVisible}
        title="恢复默认设置"
        description="所有测试性功能开关将恢复为默认值。"
        confirmLabel="恢复"
        onConfirm={() => setFeatures(EXPERIMENTAL_FEATURE_DEFAULTS)}
      />
    </Screen>
  );
}

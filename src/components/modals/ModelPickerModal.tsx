import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Chip, Text } from 'heroui-native';

import {
  DEFAULT_REASONING_EFFORT_OPTIONS,
  FALLBACK_CODEX_MODELS,
  normalizeReasoningEffort,
  type CodexModelCatalogItem,
  type CodexReasoningEffortOption,
} from '../../lib/todex';
import { defaultReasoningForModel, modelDisplayLabel, reasoningEffortLabel, reasoningOptionsForModel } from '../../lib/appCore';
import { AppSheet, InlineNotice, ListRow, ListSection, LoadingState, SectionHeader, StyledIonicons } from '../ui';

export function ReasoningEffortSelector({
  label,
  options,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  options: CodexReasoningEffortOption[];
  value: string | null;
  defaultValue: string | null;
  onChange: (value: string | null) => void;
}) {
  const normalizedValue = normalizeReasoningEffort(value);
  const normalizedDefault = normalizeReasoningEffort(defaultValue);
  const effectiveOptions = options.length ? options : DEFAULT_REASONING_EFFORT_OPTIONS;
  return (
    <View className="gap-2">
      <SectionHeader title={label} description={`默认: ${reasoningEffortLabel(normalizedDefault)}`} />
      <View className="flex-row flex-wrap gap-2">
        {effectiveOptions.map((option) => {
          const selected = normalizedValue === option.reasoningEffort;
          return (
            <Pressable
              key={option.reasoningEffort}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.reasoningEffort)}
              className={`min-w-[30%] flex-1 gap-1 rounded-2xl border px-3 py-2.5 ${
                selected ? 'border-accent bg-accent' : 'border-separator bg-surface-secondary'
              }`}
            >
              <Text type="body-sm" weight="semibold" className={selected ? 'text-accent-foreground' : 'text-foreground'} numberOfLines={1}>
                {reasoningEffortLabel(option.reasoningEffort)}
              </Text>
              <Text type="body-xs" className={selected ? 'text-accent-foreground/80' : 'text-muted'} numberOfLines={2}>
                {option.description}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ModelPickerModal({
  visible,
  title,
  catalog,
  selectedModel,
  selectedReasoningEffort,
  loading,
  error,
  onRefresh,
  onCancel,
  onSubmit,
  onManual,
}: {
  visible: boolean;
  title: string;
  catalog: CodexModelCatalogItem[];
  selectedModel: string;
  selectedReasoningEffort: string | null;
  loading: boolean;
  error: string;
  onRefresh: () => boolean;
  onCancel: () => void;
  onSubmit: (model: string, reasoningEffort: string | null) => void;
  onManual: () => void;
}) {
  const [draftModel, setDraftModel] = useState(selectedModel);
  const [draftReasoningEffort, setDraftReasoningEffort] = useState<string | null>(normalizeReasoningEffort(selectedReasoningEffort));
  const safeCatalog = catalog.length ? catalog : FALLBACK_CODEX_MODELS;

  useEffect(() => {
    if (visible) {
      setDraftModel(selectedModel);
      setDraftReasoningEffort(normalizeReasoningEffort(selectedReasoningEffort));
    }
  }, [selectedModel, selectedReasoningEffort, visible]);

  const selectedPreset = safeCatalog.find((item) => item.model === draftModel);
  const reasoningOptions = reasoningOptionsForModel(draftModel, safeCatalog);
  const defaultEffort = selectedPreset?.defaultReasoningEffort ?? defaultReasoningForModel(draftModel, safeCatalog);

  const selectModel = (model: CodexModelCatalogItem) => {
    setDraftModel(model.model);
    const currentEffort = normalizeReasoningEffort(draftReasoningEffort);
    const supported = model.supportedReasoningEfforts.map((option) => option.reasoningEffort);
    setDraftReasoningEffort(
      currentEffort && supported.includes(currentEffort)
        ? currentEffort
        : model.defaultReasoningEffort ?? supported[0] ?? null,
    );
  };

  return (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={title}
      description={`${modelDisplayLabel(draftModel, safeCatalog)} · ${reasoningEffortLabel(draftReasoningEffort)}`}
      snapPoints={['75%', '94%']}
      footer={
        <View className="flex-row gap-2">
          <Button variant="secondary" onPress={onCancel} className="flex-1 rounded-xl">
            <Button.Label>取消</Button.Label>
          </Button>
          <Button variant="primary" onPress={() => onSubmit(draftModel, draftReasoningEffort)} className="flex-1 rounded-xl">
            <Button.Label>应用</Button.Label>
          </Button>
        </View>
      }
    >
      <View className="gap-4">
        <View className="flex-row gap-2">
          <Button size="sm" variant="secondary" isDisabled={loading} onPress={() => onRefresh()} className="rounded-xl">
            <StyledIonicons name="refresh-outline" size={15} className="text-foreground" />
            <Button.Label>刷新列表</Button.Label>
          </Button>
          <Button size="sm" variant="ghost" onPress={onManual} className="rounded-xl">
            <StyledIonicons name="create-outline" size={15} className="text-foreground" />
            <Button.Label>手动输入</Button.Label>
          </Button>
        </View>
        {loading ? <LoadingState label="正在获取模型列表" className="py-4" /> : null}
        {error ? <InlineNotice status="danger" title="模型列表获取失败" description={error} /> : null}
        <View className="gap-2">
          <SectionHeader title="模型" />
          <ListSection variant="secondary">
            {safeCatalog.map((model) => {
              const selected = draftModel === model.model;
              return (
                <ListRow
                  key={model.model}
                  title={model.displayName || model.model}
                  description={model.description || model.model}
                  descriptionLines={2}
                  onPress={() => selectModel(model)}
                  suffix={
                    <View className="flex-row items-center gap-2">
                      {model.isDefault ? (
                        <Chip size="sm" variant="soft">
                          <Chip.Label>default</Chip.Label>
                        </Chip>
                      ) : null}
                      <StyledIonicons
                        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                        size={22}
                        className={selected ? 'text-accent' : 'text-muted'}
                      />
                    </View>
                  }
                />
              );
            })}
          </ListSection>
        </View>
        <ReasoningEffortSelector
          label={`思考强度 · ${draftModel || 'model'}`}
          options={reasoningOptions}
          value={draftReasoningEffort}
          defaultValue={defaultEffort}
          onChange={setDraftReasoningEffort}
        />
      </View>
    </AppSheet>
  );
}

import { useEffect, useState } from 'react';
import { Button } from 'heroui-native';

import { AppDialog, FormField, FormTextArea, InlineNotice } from '../ui';

export function PromptModal({
  visible,
  title,
  initialValue,
  placeholder,
  warning,
  multiline = false,
  submitTitle = '保存',
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  initialValue: string;
  placeholder: string;
  warning?: string;
  multiline?: boolean;
  submitTitle?: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (visible) {
      setValue(initialValue);
    }
  }, [initialValue, visible]);

  return (
    <AppDialog
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={title}
      actions={
        <>
          <Button variant="ghost" size="sm" onPress={onCancel}>
            <Button.Label>取消</Button.Label>
          </Button>
          <Button variant="primary" size="sm" onPress={() => onSubmit(value)}>
            <Button.Label>{submitTitle}</Button.Label>
          </Button>
        </>
      }
    >
      {multiline ? (
        <FormTextArea value={value} onChangeText={setValue} placeholder={placeholder} />
      ) : (
        <FormField value={value} onChangeText={setValue} placeholder={placeholder} autoFocus returnKeyType="done" onSubmitEditing={() => onSubmit(value)} />
      )}
      {warning ? <InlineNotice status="warning" title={warning} /> : null}
    </AppDialog>
  );
}

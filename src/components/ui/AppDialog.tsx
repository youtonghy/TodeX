import type { ReactNode } from 'react';
import { View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button, Dialog } from 'heroui-native';

/** Controlled centered dialog with title, optional body and action row. */
export function AppDialog({
  isOpen,
  onOpenChange,
  title,
  description,
  children,
  actions,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <KeyboardAvoidingView behavior="padding" className="w-full items-center px-4">
          <Dialog.Content className="w-full max-w-[420px] gap-4">
            <View className="gap-1.5 pr-8">
              <Dialog.Title>{title}</Dialog.Title>
              {description ? <Dialog.Description>{description}</Dialog.Description> : null}
            </View>
            {children}
            {actions ? <View className="flex-row justify-end gap-2 pt-1">{actions}</View> : null}
          </Dialog.Content>
        </KeyboardAvoidingView>
      </Dialog.Portal>
    </Dialog>
  );
}

/** Confirmation dialog for destructive or irreversible actions. */
export function ConfirmDialog({
  isOpen,
  onOpenChange,
  title,
  description,
  confirmLabel = '确定',
  cancelLabel = '取消',
  destructive = false,
  onConfirm,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AppDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      actions={
        <>
          <Button variant="ghost" size="sm" onPress={() => onOpenChange(false)}>
            <Button.Label>{cancelLabel}</Button.Label>
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            size="sm"
            onPress={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            <Button.Label>{confirmLabel}</Button.Label>
          </Button>
        </>
      }
    />
  );
}

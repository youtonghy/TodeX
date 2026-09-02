import { useEffect } from 'react';
import { Alert } from 'react-native';
import { useToast } from 'heroui-native';

type ToastManager = ReturnType<typeof useToast>['toast'];
type NoticeVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger';

let manager: ToastManager | null = null;

/**
 * Mounts inside `HeroUINativeProvider` and exposes the toast manager to
 * non-component code (the App state layer) through `notify`.
 */
export function ToastBridge() {
  const { toast } = useToast();
  useEffect(() => {
    manager = toast;
    return () => {
      if (manager === toast) manager = null;
    };
  }, [toast]);
  return null;
}

function show(variant: NoticeVariant, label: string, description?: string) {
  if (!manager) {
    Alert.alert(label, description);
    return;
  }
  manager.show({ variant, label, description, placement: 'bottom', duration: variant === 'danger' ? 4200 : 2800 });
}

/** Imperative notifications for app-level logic; falls back to a native alert before the bridge mounts. */
export const notify = {
  info: (label: string, description?: string) => show('default', label, description),
  success: (label: string, description?: string) => show('success', label, description),
  warning: (label: string, description?: string) => show('warning', label, description),
  error: (label: string, description?: string) => show('danger', label, description),
};

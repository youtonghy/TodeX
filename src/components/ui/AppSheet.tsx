import { useCallback, type ReactNode } from 'react';
import { View } from 'react-native';
import {
  BottomSheetFooter,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet } from 'heroui-native';

/**
 * Controlled bottom sheet used for forms and pickers. Content is scrollable
 * and the sheet grows with its content up to the largest snap point.
 */
export function AppSheet({
  isOpen,
  onOpenChange,
  title,
  description,
  children,
  snapPoints,
  scrollable = true,
  footer,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: ReactNode;
  snapPoints?: Array<string | number>;
  scrollable?: boolean;
  footer?: ReactNode;
}) {
  const { bottom: bottomInset } = useSafeAreaInsets();
  const header = title || description ? (
    <View className="mb-4 gap-1 pr-10">
      {title ? <BottomSheet.Title>{title}</BottomSheet.Title> : null}
      {description ? <BottomSheet.Description>{description}</BottomSheet.Description> : null}
    </View>
  ) : null;
  const renderFooter = useCallback((props: BottomSheetFooterProps) => (
    <BottomSheetFooter {...props} bottomInset={bottomInset}>
      <View className="bg-background px-5 pb-4 pt-2">{footer}</View>
    </BottomSheetFooter>
  ), [bottomInset, footer]);

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        <BottomSheet.Content
          {...(snapPoints
            ? { snapPoints, enableDynamicSizing: false, enableOverDrag: false, contentContainerClassName: 'h-full' }
            : {})}
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          android_keyboardInputMode="adjustResize"
          footerComponent={footer ? renderFooter : undefined}
        >
          <BottomSheet.Close className="absolute right-4 top-4 z-10" />
          {scrollable ? (
            <BottomSheetScrollView
              keyboardShouldPersistTaps="handled"
              enableFooterMarginAdjustment={Boolean(footer)}
              contentContainerClassName="px-1 pb-6"
            >
              {header}
              {children}
            </BottomSheetScrollView>
          ) : (
            <BottomSheetView enableFooterMarginAdjustment={Boolean(footer)} className="px-1 pb-6">
              {header}
              {children}
            </BottomSheetView>
          )}
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}

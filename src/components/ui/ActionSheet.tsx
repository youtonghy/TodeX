import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { BottomSheetView } from '@gorhom/bottom-sheet';
import { BottomSheet, Button, ListGroup, Separator, Text } from 'heroui-native';

import { StyledIonicons } from './StyledIonicons';

type IoniconName = ComponentProps<typeof StyledIonicons>['name'];

export type ActionSheetAction = {
  id: string;
  label: string;
  description?: string;
  icon?: IoniconName;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

/**
 * Replacement for `Alert.alert` action lists: a bottom sheet with a titled list
 * of actions. Actions close the sheet before running.
 */
export function ActionSheet({
  isOpen,
  onOpenChange,
  title,
  description,
  actions,
  cancelLabel = '取消',
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  actions: ActionSheetAction[];
  cancelLabel?: string;
}) {
  const close = () => onOpenChange(false);
  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        <BottomSheet.Content>
          <BottomSheetView className="gap-4 px-1 pb-6">
            {title || description ? (
              <View className="gap-1 px-1">
                {title ? (
                  <Text type="h5" numberOfLines={1} className="text-foreground">
                    {title}
                  </Text>
                ) : null}
                {description ? (
                  <Text type="body-sm" color="muted" numberOfLines={2}>
                    {description}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <ListGroup variant="secondary" className="overflow-hidden rounded-2xl">
              {actions.map((action, index) => (
                <View key={action.id}>
                  {index > 0 ? <Separator className="ml-4" /> : null}
                  <ListGroup.Item
                    disabled={action.disabled}
                    accessibilityRole="button"
                    className={`min-h-14 gap-3 px-4 ${action.disabled ? 'opacity-50' : ''}`}
                    onPress={() => {
                      close();
                      action.onPress();
                    }}
                  >
                    {action.icon ? (
                      <ListGroup.ItemPrefix>
                        <StyledIonicons
                          name={action.icon}
                          size={20}
                          className={action.destructive ? 'text-danger' : 'text-foreground'}
                        />
                      </ListGroup.ItemPrefix>
                    ) : null}
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle className={action.destructive ? 'text-danger' : undefined}>
                        {action.label}
                      </ListGroup.ItemTitle>
                      {action.description ? (
                        <ListGroup.ItemDescription numberOfLines={2}>{action.description}</ListGroup.ItemDescription>
                      ) : null}
                    </ListGroup.ItemContent>
                  </ListGroup.Item>
                </View>
              ))}
            </ListGroup>
            <Button variant="secondary" size="lg" onPress={close} className="rounded-2xl">
              <Button.Label>{cancelLabel}</Button.Label>
            </Button>
          </BottomSheetView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}

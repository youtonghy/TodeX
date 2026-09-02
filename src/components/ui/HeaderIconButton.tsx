import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { Button } from 'heroui-native';

import { StyledIonicons } from './StyledIonicons';

type IoniconName = ComponentProps<typeof StyledIonicons>['name'];

export function HeaderIconButton({
  icon,
  label,
  onPress,
  isDisabled = false,
  tone = 'default',
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
  isDisabled?: boolean;
  tone?: 'default' | 'accent';
}) {
  return (
    <Button
      isIconOnly
      size="sm"
      variant={tone === 'accent' ? 'primary' : 'ghost'}
      accessibilityLabel={label}
      isDisabled={isDisabled}
      onPress={onPress}
      className="h-9 w-9 rounded-full"
    >
      <StyledIonicons name={icon} size={19} className={tone === 'accent' ? 'text-accent-foreground' : 'text-foreground'} />
    </Button>
  );
}

/** Horizontal group used inside `navigation.setOptions({ headerRight })`. */
export function HeaderActions({ children }: { children: React.ReactNode }) {
  return <View className="flex-row items-center gap-1">{children}</View>;
}

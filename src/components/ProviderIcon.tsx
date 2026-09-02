import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import type { ProviderKind } from '../lib/v2';
import { providerIconMetadata } from '../lib/mobileParity';

export type ProviderIconProps = {
  provider?: ProviderKind | string | null;
  size?: number;
  color?: string;
  accessibilityLabel?: string;
};

type IconName = keyof typeof Ionicons.glyphMap;

export function providerLabel(provider?: ProviderKind | string | null): string {
  return providerIconMetadata(provider).label;
}

export function ProviderIcon({
  provider,
  size = 18,
  color,
  accessibilityLabel,
}: ProviderIconProps) {
  const metadata = providerIconMetadata(provider);
  const icon = metadata.iconName as IconName;
  const tint = color || metadata.color;
  const background = metadata.backgroundColor;
  const boxSize = Math.max(size + 12, 28);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel || providerLabel(provider)}
      style={{
        width: boxSize,
        height: boxSize,
        borderRadius: boxSize / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: background,
      }}
    >
      <Ionicons name={icon} size={size} color={tint} />
    </View>
  );
}

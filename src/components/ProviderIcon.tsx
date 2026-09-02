import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import type { ProviderKind } from '../lib/v2';

export type ProviderIconProps = {
  provider?: ProviderKind | string | null;
  size?: number;
  color?: string;
  accessibilityLabel?: string;
};

type IconName = keyof typeof Ionicons.glyphMap;

const ICONS: Record<string, IconName> = {
  acp: 'git-network-outline',
  codex: 'code-slash-outline',
  pi: 'radio-outline',
  'claude-code': 'sparkles-outline',
  unknown: 'cube-outline',
};

const COLORS: Record<string, string> = {
  acp: '#7c5cbf',
  codex: '#2b7a70',
  pi: '#b26a2b',
  'claude-code': '#b4573f',
  unknown: '#66717c',
};

const BACKGROUNDS: Record<string, string> = {
  acp: '#f0eafd',
  codex: '#e2f4ef',
  pi: '#fbefe2',
  'claude-code': '#f9e8e2',
  unknown: '#edf0f2',
};

export function providerLabel(provider?: ProviderKind | string | null): string {
  switch ((provider || '').toLowerCase()) {
    case 'acp':
      return 'ACP';
    case 'codex':
      return 'Codex CLI';
    case 'pi':
      return 'Pi';
    case 'claude-code':
      return 'Claude Code';
    default:
      return provider?.trim() || 'Agent';
  }
}

export function ProviderIcon({
  provider,
  size = 18,
  color,
  accessibilityLabel,
}: ProviderIconProps) {
  const key = (provider || 'unknown').toLowerCase();
  const icon = ICONS[key] || ICONS.unknown;
  const tint = color || COLORS[key] || COLORS.unknown;
  const background = BACKGROUNDS[key] || BACKGROUNDS.unknown;
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


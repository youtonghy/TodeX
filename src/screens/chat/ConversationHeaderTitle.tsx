import { View } from 'react-native';
import { Chip, Text } from 'heroui-native';

import type { LocalAdapterState } from '../../lib/todex';
import { modeLabelOf, type ConversationRecord } from '../../lib/appCore';

export function ConversationHeaderTitle({
  title,
  mode,
  goalLabel,
  localState,
  agentLabel,
}: {
  title: string;
  mode: ConversationRecord['mode'];
  goalLabel: string;
  localState: LocalAdapterState;
  agentLabel?: string;
}) {
  const stateLabel = localState === 'idle' ? '' : localState;
  return (
    <View className="max-w-[260px] items-start gap-0.5">
      <Text type="body" weight="semibold" className="text-foreground" numberOfLines={1}>
        {title}
      </Text>
      <View className="flex-row items-center gap-1">
        <Chip size="sm" variant="soft" color={mode === 'plan' ? 'accent' : 'default'}>
          <Chip.Label className="text-[10px]">{modeLabelOf(mode)}</Chip.Label>
        </Chip>
        {agentLabel ? (
          <Chip size="sm" variant="soft" color="accent">
            <Chip.Label className="text-[10px]" numberOfLines={1}>
              {agentLabel}
            </Chip.Label>
          </Chip>
        ) : null}
        {goalLabel && goalLabel !== 'No goal' ? (
          <Chip size="sm" variant="soft">
            <Chip.Label className="max-w-[90px] text-[10px]" numberOfLines={1}>
              {goalLabel}
            </Chip.Label>
          </Chip>
        ) : null}
        {stateLabel ? (
          <Chip size="sm" variant="soft" color={stateLabel === 'running' ? 'success' : 'warning'}>
            <Chip.Label className="text-[10px]">{stateLabel}</Chip.Label>
          </Chip>
        ) : null}
      </View>
    </View>
  );
}

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  PanResponder,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  canSplitWidth,
  resolveSplitLayout,
  SPLIT_DIVIDER_WIDTH,
  DEFAULT_MIN_LEFT_WIDTH,
  DEFAULT_MIN_RIGHT_WIDTH,
  DEFAULT_SPLIT_RATIO,
  calculateSplitLeftWidth,
  clampSplitLeftWidth,
} from '../../lib/splitLayout';

export type SplitLayoutProps = {
  left: ReactNode;
  right: ReactNode;
  /** Whether the split mode is active. When false, only `left` is rendered full width. */
  isSplit: boolean;
  defaultRatio?: number;
  minLeftWidth?: number;
  minRightWidth?: number;
  style?: StyleProp<ViewStyle>;
  className?: string;
  onRatioChange?: (ratio: number) => void;
  onResetRatio?: () => void;
};

export function SplitLayout({
  left,
  right,
  isSplit,
  defaultRatio = DEFAULT_SPLIT_RATIO,
  minLeftWidth = DEFAULT_MIN_LEFT_WIDTH,
  minRightWidth = DEFAULT_MIN_RIGHT_WIDTH,
  style,
  className = 'flex-1 flex-row overflow-hidden',
  onRatioChange,
  onResetRatio,
}: SplitLayoutProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [leftWidth, setLeftWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const ratioRef = useRef(defaultRatio);
  const dragStartLeftWidthRef = useRef(0);
  const lastTapTimeRef = useRef(0);
  const resetGestureRef = useRef(false);
  const containerWidthRef = useRef(0);
  containerWidthRef.current = containerWidth;
  const leftWidthRef = useRef(0);
  leftWidthRef.current = leftWidth;

  const handleContainerLayout = useCallback((event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    if (width <= 0) return;
    const previousWidth = containerWidthRef.current;
    if (previousWidth === width) return;
    setContainerWidth(width);
    if (canSplitWidth(width, minLeftWidth, minRightWidth)) {
      setLeftWidth(calculateSplitLeftWidth(width - SPLIT_DIVIDER_WIDTH, ratioRef.current, minLeftWidth, minRightWidth));
    }
  }, [defaultRatio, minLeftWidth, minRightWidth]);

  const resetToDefault = useCallback(() => {
    if (containerWidthRef.current <= 0) return;
    const next = calculateSplitLeftWidth(containerWidthRef.current - SPLIT_DIVIDER_WIDTH, defaultRatio, minLeftWidth, minRightWidth);
    ratioRef.current = defaultRatio;
    setLeftWidth(next);
    onResetRatio?.();
  }, [defaultRatio, minLeftWidth, minRightWidth, onResetRatio]);

  const panResponder = useMemo(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_evt, gestureState) => Math.abs(gestureState.dx) > 2,
      onPanResponderGrant: () => {
        const now = Date.now();
        resetGestureRef.current = now - lastTapTimeRef.current < 320;
        if (resetGestureRef.current) {
          // Double tap detected
          resetToDefault();
          lastTapTimeRef.current = 0;
          return;
        }
        lastTapTimeRef.current = now;
        dragStartLeftWidthRef.current = leftWidthRef.current;
        setIsDragging(true);
      },
      onPanResponderMove: (_evt, gestureState) => {
        if (resetGestureRef.current) return;
        const total = containerWidthRef.current - SPLIT_DIVIDER_WIDTH;
        if (total <= 0) return;
        const target = dragStartLeftWidthRef.current + gestureState.dx;
        const clamped = clampSplitLeftWidth(target, total, minLeftWidth, minRightWidth);
        ratioRef.current = clamped / total;
        setLeftWidth(clamped);
      },
      onPanResponderRelease: () => {
        setIsDragging(false);
        const total = containerWidthRef.current - SPLIT_DIVIDER_WIDTH;
        if (total > 0) {
          const ratio = leftWidthRef.current / total;
          onRatioChange?.(ratio);
        }
      },
      onPanResponderTerminate: () => {
        setIsDragging(false);
      },
    });
  }, [minLeftWidth, minRightWidth, onRatioChange, resetToDefault]);

  const layout = resolveSplitLayout(containerWidth, leftWidth, isSplit, minLeftWidth, minRightWidth);
  const splitVisible = layout.split;

  return (
    <View onLayout={handleContainerLayout} className={className} style={style}>
      {/* Left Column (Chat) */}
      <View
        style={splitVisible ? { width: layout.leftWidth } : { flex: 1 }}
        className="h-full overflow-hidden border-r border-separator"
      >
        {left}
      </View>

      {/* Vertical Resizable Divider */}
      <View
        style={splitVisible ? undefined : { display: 'none' }}
        {...panResponder.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="调整左右分栏大小"
        accessibilityHint="向上或向下调整；双击拖柄恢复默认宽度"
        accessibilityValue={{ min: minLeftWidth, max: Math.max(minLeftWidth, containerWidth - SPLIT_DIVIDER_WIDTH - minRightWidth), now: layout.leftWidth }}
        accessibilityActions={[{ name: 'increment', label: '加宽聊天栏' }, { name: 'decrement', label: '缩窄聊天栏' }]}
        onAccessibilityAction={(event) => {
          const direction = event.nativeEvent.actionName === 'increment' ? 1 : -1;
          const available = containerWidthRef.current - SPLIT_DIVIDER_WIDTH;
          const next = clampSplitLeftWidth(leftWidthRef.current + direction * 32, available, minLeftWidth, minRightWidth);
          ratioRef.current = next / available;
          setLeftWidth(next);
          onRatioChange?.(next / available);
        }}
        className="relative z-30 h-full w-5 items-center justify-center cursor-col-resize select-none"
      >
        {/* Prominent line */}
        <View
          className={`h-full w-[2px] ${
            isDragging ? 'bg-accent' : 'bg-separator'
          } transition-colors`}
        />
        {/* Distinct grab pill handle */}
        <View
          className={`absolute h-10 w-1.5 rounded-full shadow-xs ${
            isDragging ? 'bg-accent scale-125' : 'bg-muted'
          } transition-all`}
        />
      </View>

      {/* Right Column (Workbench) */}
      <View style={splitVisible ? undefined : { display: 'none' }} accessibilityElementsHidden={!splitVisible} importantForAccessibility={splitVisible ? 'auto' : 'no-hide-descendants'} className="h-full flex-1 overflow-hidden bg-background">
        {right}
      </View>
    </View>
  );
}

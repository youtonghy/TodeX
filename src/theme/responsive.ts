import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { computeResponsiveMetrics, type ResponsiveMetrics } from '../lib/responsive';

export type { ResponsiveMetrics };
export { computeResponsiveMetrics };

/**
 * React hook that returns responsive screen metrics that update
 * automatically upon device rotation or window resizing.
 */
export function useResponsive(): ResponsiveMetrics {
  const { width, height } = useWindowDimensions();

  return useMemo(
    () => computeResponsiveMetrics(width, height),
    [width, height],
  );
}

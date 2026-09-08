import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

/** Defer native sheets until requested, retaining only their closing animation. */
export function useSheetLifecycle(requestedOpen: boolean) {
  const [mounted, setMounted] = useState(false);
  const [laidOut, setLaidOut] = useState(false);
  const requestedOpenRef = useRef(requestedOpen);
  requestedOpenRef.current = requestedOpen;

  useEffect(() => {
    if (requestedOpen) setMounted(true);
    else if (!laidOut) setMounted(false);
  }, [requestedOpen, laidOut]);

  const frameRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    // The portal may mount after the parent's effect. Wait for its content:
    // HeroUI opens on a false -> true edge. Give Gorhom a layout frame and
    // the following UI-thread measurement update before requesting that edge.
    if (requestedOpenRef.current && event.nativeEvent.layout.height > 0 && frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          if (requestedOpenRef.current) setLaidOut(true);
        });
      });
    }
  }, []);

  const onChange = useCallback((index: number) => {
    // A stale close event must not tear down a sheet that has reopened.
    if (index === -1 && !requestedOpenRef.current) {
      setLaidOut(false);
      setMounted(false);
    }
  }, []);

  return { shouldRender: requestedOpen || mounted, isOpen: requestedOpen && laidOut, onChange, onLayout };
}

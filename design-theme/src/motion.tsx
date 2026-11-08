import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, type PressableProps, type ViewProps } from 'react-native';

const ReducedMotion = createContext(true);
const nativeDriver = Platform.OS !== 'web';

function initialReducedMotion(): boolean {
  // Web can read this before the first paint. An async default of `true` made
  // every entrance render at its final position before motion was enabled.
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }
  return true;
}

/** Share one device preference subscription across all animated controls. */
export function MotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(initialReducedMotion);
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && !window.matchMedia) {
      // React Native Web reports reduced motion when matchMedia is unavailable.
      // Keep the visual default while still honoring real browser preferences.
      return;
    }
    let active = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      changed = true;
      setReduced(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active && !changed) setReduced(value);
    }).catch(() => { /* Keep motion off when the preference is unavailable. */ });
    return () => { active = false; subscription.remove(); };
  }, []);
  return <ReducedMotion.Provider value={reduced}>{children}</ReducedMotion.Provider>;
}

export function useReduceMotion() { return useContext(ReducedMotion); }
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Preserve the control's layout, focus and hit target while giving it spring feedback. */
export function MotionPressable({ style, onPressIn, onPressOut, onHoverIn, onHoverOut, disabled, ...props }: PressableProps) {
  const reduced = useReduceMotion();
  const [pressed, setPressed] = useState(false);
  const hovered = useRef(false);
  const [scale] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced || disabled) { scale.stopAnimation(); scale.setValue(1); }
    return () => scale.stopAnimation();
  }, [disabled, reduced, scale]);
  function settle(toValue: number) {
    if (reduced || disabled) return;
    Animated.spring(scale, { toValue, stiffness: 380, damping: 24, mass: 0.55, isInteraction: false, useNativeDriver: nativeDriver }).start();
  }
  return <AnimatedPressable
    {...props}
    disabled={disabled}
    onPressIn={(event) => { setPressed(true); settle(0.94); onPressIn?.(event); }}
    onPressOut={(event) => { setPressed(false); settle(hovered.current ? 1.025 : 1); onPressOut?.(event); }}
    onHoverIn={(event) => { hovered.current = true; if (!pressed) settle(1.025); onHoverIn?.(event); }}
    onHoverOut={(event) => { hovered.current = false; if (!pressed) settle(1); onHoverOut?.(event); }}
    style={[typeof style === 'function' ? style({ pressed: pressed && !disabled }) : style, { transform: [{ scale }] }]}
  />;
}

/** Bounded reveals animate only opacity and transforms, without blocking list rendering. */
export function MotionView({ children, delay = 0, distance = 18, replayKey, style, ...props }: ViewProps & {
  delay?: number;
  distance?: number;
  replayKey?: string;
}) {
  const reduced = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    if (reduced) { progress.setValue(1); return; }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1, duration: 360, delay: Math.min(Math.max(delay, 0), 240),
      easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver, isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, progress, reduced, replayKey]);
  return <Animated.View {...props} style={[style, {
    opacity: progress,
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  }]}>{children}</Animated.View>;
}

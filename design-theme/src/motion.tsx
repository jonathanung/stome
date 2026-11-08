import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, type PressableProps, type ViewProps } from 'react-native';

const ReducedMotion = createContext(true);

/** Share one device preference subscription across all animated controls. */
export function MotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
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
const nativeDriver = Platform.OS !== 'web';
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Preserve the control's layout, focus and hit target while giving it spring feedback. */
export function MotionPressable({ style, onPressIn, onPressOut, disabled, ...props }: PressableProps) {
  const reduced = useReduceMotion();
  const [pressed, setPressed] = useState(false);
  const [scale] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced || disabled) { scale.stopAnimation(); scale.setValue(1); }
    return () => scale.stopAnimation();
  }, [disabled, reduced, scale]);
  function settle(toValue: number) {
    if (reduced || disabled) return;
    Animated.spring(scale, { toValue, stiffness: 420, damping: 28, mass: 0.6, isInteraction: false, useNativeDriver: nativeDriver }).start();
  }
  return <AnimatedPressable
    {...props}
    disabled={disabled}
    onPressIn={(event) => { setPressed(true); settle(0.97); onPressIn?.(event); }}
    onPressOut={(event) => { setPressed(false); settle(1); onPressOut?.(event); }}
    style={[typeof style === 'function' ? style({ pressed: pressed && !disabled }) : style, { transform: [{ scale }] }]}
  />;
}

/** Bounded reveals animate only opacity and transforms, without blocking list rendering. */
export function MotionView({ children, delay = 0, distance = 12, style, ...props }: ViewProps & {
  delay?: number;
  distance?: number;
}) {
  const reduced = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    if (reduced) { progress.setValue(1); return; }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1, duration: 320, delay: Math.min(Math.max(delay, 0), 240),
      easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver, isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, progress, reduced]);
  return <Animated.View {...props} style={[style, {
    opacity: progress,
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  }]}>{children}</Animated.View>;
}

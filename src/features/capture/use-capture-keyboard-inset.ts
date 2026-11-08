import { useLayoutEffect, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { Keyboard, Platform, View, type KeyboardEvent as KeyboardFrameEvent } from 'react-native';

import {
  frameKeyboardOverlap,
  visualViewportKeyboardOverlap,
} from './keyboard-inset';

type CaptureLayer = ComponentRef<typeof View>;

export type CaptureKeyboardInset = {
  overlap: number;
  /** Full-screen layer whose bottom is compared with the keyboard. Unused on web. */
  layerRef: RefObject<CaptureLayer | null>;
  onLayerLayout: () => void;
};

/**
 * Bottom inset that keeps the phone capture sheet above the software keyboard.
 * Zero while the keyboard is closed, including after it is dismissed.
 */
export function useCaptureKeyboardOverlap(): CaptureKeyboardInset {
  const [overlap, setOverlap] = useState(0);
  const layerRef = useRef<CaptureLayer | null>(null);
  const keyboardRef = useRef<{ screenY: number; height: number } | null>(null);

  const applyNative = () => {
    const keyboard = keyboardRef.current;
    const layer = layerRef.current;
    if (!keyboard || !layer || typeof layer.measureInWindow !== 'function') {
      setOverlap(0);
      return;
    }
    layer.measureInWindow((_x, y, _width, height) => {
      setOverlap(frameKeyboardOverlap({
        frameY: y,
        frameHeight: height,
        keyboardScreenY: keyboard.screenY,
        keyboardHeight: keyboard.height,
      }));
    });
  };

  useLayoutEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || window.visualViewport == null) return;
      const viewport = window.visualViewport;
      const read = () => {
        setOverlap(visualViewportKeyboardOverlap({
          layoutHeight: window.innerHeight,
          viewportHeight: viewport.height,
          viewportOffsetTop: viewport.offsetTop,
        }));
      };
      read();
      viewport.addEventListener('resize', read);
      viewport.addEventListener('scroll', read);
      window.addEventListener('resize', read);
      return () => {
        viewport.removeEventListener('resize', read);
        viewport.removeEventListener('scroll', read);
        window.removeEventListener('resize', read);
      };
    }

    const onShow = (event: KeyboardFrameEvent) => {
      keyboardRef.current = {
        screenY: event.endCoordinates.screenY,
        height: event.endCoordinates.height,
      };
      applyNative();
    };
    const onHide = () => {
      keyboardRef.current = null;
      setOverlap(0);
    };
    const visible = Keyboard.metrics();
    if (visible) {
      keyboardRef.current = { screenY: visible.screenY, height: visible.height };
      applyNative();
    }

    const subscriptions = Platform.OS === 'ios'
      ? [
          Keyboard.addListener('keyboardWillShow', onShow),
          Keyboard.addListener('keyboardWillHide', onHide),
        ]
      : [
          Keyboard.addListener('keyboardDidShow', onShow),
          Keyboard.addListener('keyboardDidHide', onHide),
        ];
    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, []);

  return {
    overlap,
    layerRef,
    onLayerLayout: () => {
      if (Platform.OS !== 'web') applyNative();
    },
  };
}

'use no memo';

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import type { BackgroundPattern, BackgroundSize, WhiteboardElement } from './types';

type PersistedState = {
  elements: WhiteboardElement[];
  bgPattern: BackgroundPattern;
  bgSize: BackgroundSize;
};

function key(roomId: string): string {
  return `wb-state:${roomId}`;
}

export function loadWhiteboardState(roomId: string): PersistedState | null {
  if (Platform.OS !== 'web') return null;
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(key(roomId));
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

function persist(roomId: string, state: PersistedState): void {
  if (Platform.OS !== 'web') return;
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(key(roomId), JSON.stringify(state));
  } catch {
    // quota exceeded or private mode — silently ignore
  }
}

/** Auto-saves whiteboard state to localStorage, debounced by 400 ms. */
export function useWhiteboardPersistence(
  roomId: string | undefined,
  elements: WhiteboardElement[],
  bgPattern: BackgroundPattern,
  bgSize: BackgroundSize,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!roomId) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      persist(roomId, { elements, bgPattern, bgSize });
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [roomId, elements, bgPattern, bgSize]);
}

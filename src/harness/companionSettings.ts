import { useSyncExternalStore } from 'react';

import type { MockScenario } from './contract';

export type CompanionSettings = {
  url: string;
  /** In memory only. Never written to storage, so a reload asks again. */
  token: string;
  scenario: MockScenario;
};

export const DEFAULT_COMPANION_URL = 'http://127.0.0.1:8787';

let settings: CompanionSettings = { url: DEFAULT_COMPANION_URL, token: '', scenario: 'success' };
const listeners = new Set<() => void>();

export function getCompanionSettings(): CompanionSettings {
  return settings;
}

export function updateCompanionSettings(patch: Partial<CompanionSettings>): void {
  settings = { ...settings, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCompanionSettings(): CompanionSettings {
  return useSyncExternalStore(subscribe, getCompanionSettings, getCompanionSettings);
}

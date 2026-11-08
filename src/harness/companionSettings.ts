import { useSyncExternalStore } from 'react';

import { fetchCompanionStatus } from './companionClient';
import type { MockScenario } from './contract';
import type { CompanionStatus } from './tools';

export type CompanionSettings = {
  url: string;
  /** In memory only. Never written to storage, so a reload asks again. */
  token: string;
  scenario: MockScenario;
  /** What the companion last reported. Null means unknown or unpaired. */
  status: CompanionStatus | null;
  /** Placeholder limits shown in settings; the harness does not read them yet. */
  limits: { timeoutSec: string; maxChunks: string; maxAnswerChars: string };
};

export const DEFAULT_COMPANION_URL = 'http://127.0.0.1:8787';

let settings: CompanionSettings = {
  url: DEFAULT_COMPANION_URL,
  token: '',
  scenario: 'success',
  status: null,
  limits: { timeoutSec: '30', maxChunks: '8', maxAnswerChars: '2000' },
};
const listeners = new Set<() => void>();

export function getCompanionSettings(): CompanionSettings {
  return settings;
}

export function updateCompanionSettings(patch: Partial<Omit<CompanionSettings, 'status'>>): void {
  const changed =
    (patch.url !== undefined && patch.url !== settings.url) || (patch.token !== undefined && patch.token !== settings.token);
  // A status belongs to one url and token pair, so changing either makes it unknown again.
  settings = { ...settings, ...patch, status: changed ? null : settings.status };
  listeners.forEach((listener) => listener());
}

function setStatus(status: CompanionStatus | null): void {
  settings = { ...settings, status };
  listeners.forEach((listener) => listener());
}

/** True only when the paired companion says a real model answers. Mock and unknown are false. */
export function isLiveCompanion(current: CompanionSettings = settings): boolean {
  return current.status?.live === true;
}

/**
 * Asks the companion for its status with the current url and token. Stores the result,
 * clears it on failure, and returns the error message (null on success).
 */
export async function refreshCompanionStatus(signal?: AbortSignal): Promise<string | null> {
  const { url, token } = settings;
  if (!token.trim()) {
    setStatus(null);
    return 'Paste the token the companion printed first.';
  }
  try {
    const status = await fetchCompanionStatus({ baseUrl: url.trim(), token: token.trim() }, signal);
    // The pair may have changed while the request was in flight; drop a stale reply.
    if (settings.url === url && settings.token === token) setStatus(status);
    return null;
  } catch (reason: unknown) {
    if (settings.url === url && settings.token === token) setStatus(null);
    return reason instanceof Error ? reason.message : 'The companion could not be reached';
  }
}

/** Display name per provider; the vendor that receives live questions. */
export const PROVIDER_NAMES: Record<CompanionStatus['provider'], string> = {
  mock: 'Deterministic mock',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  xai: 'xAI',
};

/** "Anthropic · claude-opus-5-5 · live", "Deterministic mock", or null while unknown. */
export function companionLabel(status: CompanionStatus | null): string | null {
  if (!status) return null;
  if (!status.live) return 'Deterministic mock';
  const provider = PROVIDER_NAMES[status.provider] ?? status.provider;
  return [provider, status.model, 'live'].filter(Boolean).join(' · ');
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

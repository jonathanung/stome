import assert from 'node:assert/strict';
import { test } from 'node:test';

import { startCompanion } from '../companion/server.ts';
import { fetchCompanionStatus } from '../src/harness/companionClient.ts';
import {
  companionLabel,
  getCompanionSettings,
  isLiveCompanion,
  refreshCompanionStatus,
  updateCompanionSettings,
} from '../src/harness/companionSettings.ts';
import { mockProvider } from '../src/harness/provider.ts';
import type { CompanionStatus } from '../src/harness/tools.ts';

// A browser sends Origin on its own; Node's fetch does not, and the companion requires it.
const APP_ORIGIN = 'http://localhost:8081';
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set('origin', APP_ORIGIN);
  return realFetch(input, { ...init, headers });
};

const LIVE: CompanionStatus = { provider: 'anthropic', model: 'claude-opus-5-5', live: true, tools: [] };

test('status clears when the url or token changes, not for other fields', () => {
  updateCompanionSettings({ url: 'http://127.0.0.1:1', token: 'a' });
  assert.equal(getCompanionSettings().status, null);
  assert.equal(isLiveCompanion(), false);
  assert.equal(isLiveCompanion({ ...getCompanionSettings(), status: LIVE }), true);
  assert.equal(isLiveCompanion({ ...getCompanionSettings(), status: { ...LIVE, live: false } }), false);
});

test('refreshCompanionStatus stores status, clears it on failure, and url/token changes reset it', async () => {
  const companion = await startCompanion({
    origin: APP_ORIGIN,
    token: 'pair-token-status',
    expiresAt: Date.now() + 60_000,
    provider: mockProvider,
  });
  try {
    updateCompanionSettings({ url: companion.url, token: 'pair-token-status' });
    assert.equal(await refreshCompanionStatus(), null);
    assert.equal(getCompanionSettings().status?.provider, 'mock');
    assert.equal(isLiveCompanion(), false);
    assert.equal(companionLabel(getCompanionSettings().status), 'Deterministic mock');

    updateCompanionSettings({ scenario: 'error' });
    assert.notEqual(getCompanionSettings().status, null, 'scenario change keeps status');

    updateCompanionSettings({ token: 'wrong-token' });
    assert.equal(getCompanionSettings().status, null);
    assert.equal(typeof (await refreshCompanionStatus()), 'string');
    assert.equal(getCompanionSettings().status, null);

    updateCompanionSettings({ token: 'pair-token-status' });
    assert.equal(await refreshCompanionStatus(), null);
    updateCompanionSettings({ url: `${companion.url}/` });
    assert.equal(getCompanionSettings().status, null);

    updateCompanionSettings({ token: '' });
    assert.match((await refreshCompanionStatus()) ?? '', /token/);
  } finally {
    await companion.close();
    updateCompanionSettings({ token: '', scenario: 'success' });
  }
});

test('companionLabel names a live provider and model', () => {
  assert.equal(companionLabel(null), null);
  assert.equal(companionLabel(LIVE), 'Anthropic · claude-opus-5-5 · live');
});

test('fetchCompanionStatus works with the right token and is rejected with a wrong one', async () => {
  const companion = await startCompanion({
    origin: APP_ORIGIN,
    token: 'pair-token-fetch',
    expiresAt: Date.now() + 60_000,
    provider: mockProvider,
  });
  try {
    const status = await fetchCompanionStatus({ baseUrl: companion.url, token: 'pair-token-fetch' });
    assert.equal(status.provider, 'mock');
    assert.equal(status.live, false);
    assert.equal(status.model, null);
    await assert.rejects(fetchCompanionStatus({ baseUrl: companion.url, token: 'nope' }));
  } finally {
    await companion.close();
  }
});

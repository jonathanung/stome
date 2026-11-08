import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  FLOWS,
  REFRESH_SKEW_MS,
  accountIdFromToken,
  authorizeUrl,
  createPkce,
  credentialSource,
  exchangeCode,
  type FetchLike,
} from '../companion/auth/oauth.ts';
import { deleteCredential, getCredential, setCredential, type OAuthCredential } from '../companion/auth/store.ts';
import {
  createCompatibleProvider,
  subscriptionResponsesClient,
  type LiveResponse,
  type ResponsesClient,
} from '../companion/providers/openai.ts';
import { parseJsonObject } from '../companion/providers/shared.ts';
import { liveConfigFromEnv } from '../companion/server.ts';
import { HarnessError } from '../src/harness/contract.ts';
import { completeReadTool } from '../src/harness/provider.ts';
import { REVIEW_TOOL_NAME, type ReviewQuestionOutput } from '../src/harness/tools.ts';

const tempStore = () => join(mkdtempSync(join(tmpdir(), 'stome-auth-')), 'nested', 'auth.json');
const jwt = (claims: Record<string, unknown>) =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const credential = (over: Partial<OAuthCredential> = {}): OAuthCredential => ({
  type: 'oauth',
  access: 'access-1',
  refresh: 'refresh-1',
  expiresAt: Date.now() + 60 * 60 * 1000,
  ...over,
});
const reviewInput = { roomId: 'r1', chunk: { id: 'c1', roomId: 'r1', text: 'Mitochondria make ATP.' } };

test('PKCE challenge is the S256 of the verifier', () => {
  const { verifier, challenge } = createPkce();
  const expected = createHash('sha256').update(verifier).digest('base64url');
  assert.equal(challenge, expected);
  assert.ok(verifier.length >= 43);
});

test('authorize URLs carry each vendor registration', () => {
  const openai = new URL(authorizeUrl(FLOWS.openai, 'state-1', 'chal', 'nonce-1'));
  assert.equal(openai.origin + openai.pathname, 'https://auth.openai.com/oauth/authorize');
  assert.equal(openai.searchParams.get('redirect_uri'), 'http://localhost:1455/auth/callback');
  assert.equal(openai.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(openai.searchParams.get('originator'), 'codex_cli_rs');
  assert.equal(openai.searchParams.get('nonce'), null);
  const xai = new URL(authorizeUrl(FLOWS.xai, 'state-2', 'chal', 'nonce-2'));
  assert.equal(xai.searchParams.get('redirect_uri'), 'http://127.0.0.1:56121/callback');
  assert.equal(xai.searchParams.get('plan'), 'generic');
  assert.equal(xai.searchParams.get('nonce'), 'nonce-2');
  assert.match(xai.searchParams.get('scope') ?? '', /api:access/);
});

test('the ChatGPT account id is read from any of its claim shapes', () => {
  assert.equal(accountIdFromToken(jwt({ chatgpt_account_id: 'a1' })), 'a1');
  assert.equal(accountIdFromToken(jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'a2' } })), 'a2');
  assert.equal(accountIdFromToken(jwt({ organizations: [{ id: 'org-3' }] })), 'org-3');
  assert.equal(accountIdFromToken('opaque-token'), undefined);
});

test('the store is 0600 in a 0700 directory and round-trips', () => {
  const path = tempStore();
  setCredential('xai', credential(), path);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(join(path, '..')).mode & 0o777, 0o700);
  assert.equal(getCredential('xai', path)?.access, 'access-1');
  assert.equal(getCredential('openai', path), null);
  assert.equal(deleteCredential('xai', path), true);
  assert.equal(getCredential('xai', path), null);
});

test('code exchange sends PKCE and keeps the account id; errors never echo tokens', async () => {
  const sent: URLSearchParams[] = [];
  const ok: FetchLike = async (_url, init) => {
    sent.push(new URLSearchParams(String(init.body)));
    return Response.json({ access_token: 'acc', refresh_token: 'ref', id_token: jwt({ chatgpt_account_id: 'acct' }), expires_in: 600 });
  };
  const result = await exchangeCode('openai', 'the-code', 'the-verifier', ok);
  assert.equal(result.accountId, 'acct');
  assert.equal(sent[0]!.get('code_verifier'), 'the-verifier');
  assert.equal(sent[0]!.get('client_id'), FLOWS.openai.clientId);
  const bad: FetchLike = async () => Response.json({ error: 'invalid_grant', error_description: 'Code expired' }, { status: 400 });
  await assert.rejects(exchangeCode('xai', 'secret-code', 'v', bad), (error: unknown) => {
    return error instanceof Error && /Code expired/.test(error.message) && !error.message.includes('secret-code');
  });
});

test('a near-expiry sign-in refreshes once, persists the rotated token, and a fresh one does not refresh', async () => {
  const path = tempStore();
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Response.json({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 });
  };
  setCredential('xai', credential({ expiresAt: Date.now() + REFRESH_SKEW_MS - 1000 }), path);
  const source = credentialSource('xai', { path, fetcher });
  const [a, b] = await Promise.all([source(), source()]);
  assert.equal(calls, 1);
  assert.equal(a.access, 'access-2');
  assert.equal(b.access, 'access-2');
  assert.equal(getCredential('xai', path)?.refresh, 'refresh-2');
  assert.equal((await source()).access, 'access-2');
  assert.equal(calls, 1);
  assert.ok(!readFileSync(path, 'utf8').includes('refresh-1'));
});

test('not signed in fails the question with a provider_error and no network call', async () => {
  for (const vendor of ['openai', 'xai'] as const) {
    const client = subscriptionResponsesClient(vendor, credentialSource(vendor, { path: tempStore() }));
    const provider = createCompatibleProvider({ vendor, client, subscription: true });
    await assert.rejects(
      completeReadTool(provider, { tool: REVIEW_TOOL_NAME, input: reviewInput, scenario: 'success' }, new AbortController().signal),
      (error: unknown) => error instanceof HarnessError && error.code === 'provider_error' && /companion:login -- /.test(error.message),
    );
  }
  const noAccount = subscriptionResponsesClient('openai', async () => credential());
  await assert.rejects(
    completeReadTool(
      createCompatibleProvider({ vendor: 'openai', client: noAccount, subscription: true }),
      { tool: REVIEW_TOOL_NAME, input: reviewInput, scenario: 'success' },
      new AbortController().signal,
    ),
    (error: unknown) => error instanceof HarnessError && /no account id/.test(error.message),
  );
});

test('ChatGPT subscription requests use the Codex shape: schema in instructions, no text.format', async () => {
  const calls: Record<string, unknown>[] = [];
  const reply: LiveResponse = {
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: '```json\n{"chunkId":"c1","question":"q?","answer":"a"}\n```' }] }],
  };
  const client: ResponsesClient = {
    async create(params) {
      calls.push(params);
      return reply;
    },
  };
  const provider = createCompatibleProvider({ vendor: 'openai', client, subscription: true });
  const out = await completeReadTool<ReviewQuestionOutput>(
    provider,
    { tool: REVIEW_TOOL_NAME, input: reviewInput, scenario: 'success' },
    new AbortController().signal,
  );
  assert.equal(out.question, 'q?');
  const params = calls[0]!;
  assert.equal(params.model, 'gpt-5.5');
  assert.equal(params.text, undefined);
  assert.equal(params.max_output_tokens, undefined);
  assert.equal(params.store, false);
  assert.deepEqual(params.include, ['reasoning.encrypted_content']);
  assert.match(String(params.instructions), /JSON schema/);
  assert.deepEqual(params.reasoning, { effort: 'medium' });
});

test('Grok subscription keeps the API request shape', async () => {
  const calls: Record<string, unknown>[] = [];
  const client: ResponsesClient = {
    async create(params) {
      calls.push(params);
      return { status: 'completed', output_text: '{"chunkId":"c1","question":"q","answer":"a"}', output: [] };
    },
  };
  await createCompatibleProvider({ vendor: 'xai', client, subscription: true }).complete(
    { tool: REVIEW_TOOL_NAME, input: reviewInput, scenario: 'success' },
    new AbortController().signal,
  );
  assert.equal((calls[0]!.text as { format: { strict: boolean } }).format.strict, true);
  assert.equal(calls[0]!.model, 'grok-4.7');
});

test('an API key wins over a sign-in; with no key the sign-in is used', async () => {
  const path = tempStore();
  setCredential('openai', credential({ accountId: 'acct' }), path);
  const signedIn = await liveConfigFromEnv({ STOME_PROVIDER: 'openai', STOME_AUTH_FILE: path });
  assert.equal(signedIn?.status.model, 'gpt-5.5');
  assert.match(signedIn?.banner ?? '', /ChatGPT subscription/);
  assert.ok(!(signedIn?.banner ?? '').includes('access-1'));
  const keyed = await liveConfigFromEnv({ STOME_PROVIDER: 'openai', STOME_AUTH_FILE: path, OPENAI_API_KEY: 'sk-x' });
  assert.equal(keyed?.status.model, 'gpt-6-astra');
  assert.match(keyed?.banner ?? '', /API billing/);
  const neither = await liveConfigFromEnv({ STOME_PROVIDER: 'xai', STOME_AUTH_FILE: tempStore() });
  assert.match(neither?.banner ?? '', /companion:login -- xai/);
});

test('a fenced JSON reply still parses', () => {
  assert.deepEqual(parseJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonObject('{"a":2}'), { a: 2 });
});

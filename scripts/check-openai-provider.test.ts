import OpenAI from 'openai';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createCompatibleProvider,
  noCredentialsMessage,
  parseOpenAiEffort,
  sdkResponsesClient,
  type CompatibleVendor,
  type LiveResponse,
  type ResponsesClient,
} from '../companion/providers/openai.ts';
import { liveConfigFromEnv, startCompanion } from '../companion/server.ts';
import { ALLOWED_TOOL_NAMES, HarnessError, TOOL_NAME } from '../src/harness/contract.ts';
import { completeReadTool, completeWithLimits } from '../src/harness/provider.ts';
import {
  IMPORT_TOOL_NAME,
  REVIEW_TOOL_NAME,
  type ImportSuggestOutput,
  type ReviewQuestionOutput,
} from '../src/harness/tools.ts';

type Call = { params: Record<string, unknown>; signal: AbortSignal };

function fake(reply: LiveResponse | ((call: Call) => Promise<LiveResponse>)): { client: ResponsesClient; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      async create(params, options) {
        const call = { params, signal: options.signal };
        calls.push(call);
        return typeof reply === 'function' ? reply(call) : reply;
      },
    },
  };
}

const completed = (json: unknown): LiveResponse => ({ status: 'completed', output_text: JSON.stringify(json), output: [] });
const reviewInput = { roomId: 'r1', chunk: { id: 'c1', roomId: 'r1', text: 'Mitochondria make ATP.' } };
const signal = () => new AbortController().signal;
const isCode = (code: string) => (error: unknown) => error instanceof HarnessError && error.code === code;

for (const vendor of ['openai', 'xai'] as const) {
  test(`${vendor}: a review question maps through the shared parser`, async () => {
    const { client, calls } = fake(completed({ chunkId: 'c1', question: 'What makes ATP?', answer: 'Mitochondria.' }));
    const provider = createCompatibleProvider({ vendor, client });
    const out = await completeReadTool<ReviewQuestionOutput>(
      provider,
      { tool: REVIEW_TOOL_NAME, input: reviewInput, scenario: 'success' },
      signal(),
    );
    assert.equal(out.question, 'What makes ATP?');
    const params = calls[0]!.params;
    const format = (params.text as { format: Record<string, unknown> }).format;
    assert.equal(format.type, 'json_schema');
    assert.equal(format.strict, true);
    assert.equal(format.name, 'review_generateQuestion');
    assert.equal(typeof params.instructions, 'string');
    assert.equal(params.temperature, undefined);
    assert.equal(params.model, vendor === 'openai' ? 'gpt-6-astra' : 'grok-4.7');
  });
}

test('OpenAI sends reasoning effort and store:false; xAI sends neither by default', async () => {
  const reply = completed({ chunkId: 'c1', question: 'q', answer: 'a' });
  const open = fake(reply);
  await createCompatibleProvider({ vendor: 'openai', client: open.client }).complete(
    { tool: REVIEW_TOOL_NAME, input: reviewInput, scenario: 'success' },
    signal(),
  );
  assert.deepEqual(open.calls[0]!.params.reasoning, { effort: 'medium' });
  assert.equal(open.calls[0]!.params.store, false);
  const grok = fake(reply);
  await createCompatibleProvider({ vendor: 'xai', client: grok.client }).complete(
    { tool: REVIEW_TOOL_NAME, input: reviewInput, scenario: 'success' },
    signal(),
  );
  assert.equal(grok.calls[0]!.params.reasoning, undefined);
  assert.equal(grok.calls[0]!.params.store, undefined);
  const tuned = fake(reply);
  await createCompatibleProvider({ vendor: 'xai', client: tuned.client, effort: 'high' }).complete(
    { tool: REVIEW_TOOL_NAME, input: reviewInput, scenario: 'success' },
    signal(),
  );
  assert.deepEqual(tuned.calls[0]!.params.reasoning, { effort: 'high' });
});

test('an answer quote becomes an anchor, and a chunk outside the selection is rejected', async () => {
  const input = {
    roomId: 'r1',
    prompt: 'What makes ATP?',
    chunks: [{ id: 'c1', roomId: 'r1', text: 'Cells need energy. Mitochondria make ATP.' }],
    priorMessages: [],
  };
  const ok = createCompatibleProvider({
    vendor: 'openai',
    client: fake(completed({ chunkId: 'c1', body: 'Mitochondria.', quote: 'Mitochondria make ATP.' })).client,
  });
  const out = await completeWithLimits(ok, { tool: TOOL_NAME, input, scenario: 'success' }, signal());
  assert.equal('anchorStart' in out && out.anchorStart, 19);
  const bad = createCompatibleProvider({
    vendor: 'xai',
    client: fake(completed({ chunkId: 'elsewhere', body: 'x', quote: 'x' })).client,
  });
  await assert.rejects(completeWithLimits(bad, { tool: TOOL_NAME, input, scenario: 'success' }, signal()), isCode('scope_rejected'));
});

test('an invented import room id is rejected', async () => {
  const provider = createCompatibleProvider({
    vendor: 'xai',
    client: fake(completed({ suggestions: [{ noteId: 'a', roomId: 'made-up', newRoomName: null, subjects: [] }] })).client,
  });
  await assert.rejects(
    completeReadTool<ImportSuggestOutput>(
      provider,
      {
        tool: IMPORT_TOOL_NAME,
        input: { notes: [{ id: 'a', title: 'Bio', text: 'cells' }], rooms: [{ id: 'rb', name: 'Biology' }] },
        scenario: 'success',
      },
      signal(),
    ),
    isCode('scope_rejected'),
  );
});

test('refusal, content filter, truncation, and bad JSON are normalized', async () => {
  const cases: [LiveResponse, string][] = [
    [{ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }, 'provider_error'],
    [{ status: 'incomplete', incomplete_details: { reason: 'content_filter' } }, 'provider_error'],
    [{ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 'output_limit'],
    [{ status: 'completed', output_text: 'not json', output: [] }, 'invalid_shape'],
    [{ status: 'completed', output_text: '', output: [] }, 'invalid_output'],
  ];
  for (const [reply, code] of cases) {
    const provider = createCompatibleProvider({ vendor: 'openai', client: fake(reply).client });
    await assert.rejects(
      completeReadTool(provider, { tool: REVIEW_TOOL_NAME, input: reviewInput, scenario: 'success' }, signal()),
      isCode(code),
    );
  }
});

test('SDK errors map to short vendor messages without echoing secrets', async () => {
  const secret = 'sk-SECRET-VALUE';
  const headers = new Headers();
  const cases: [unknown, RegExp][] = [
    [new OpenAI.AuthenticationError(401, { message: secret }, secret, headers), /xAI API key was rejected/],
    [new OpenAI.RateLimitError(429, { message: secret }, secret, headers), /Rate limited by xAI/],
    [new OpenAI.NotFoundError(404, { message: secret }, secret, headers), /check STOME_MODEL/],
    [new OpenAI.APIConnectionError({ message: secret }), /Could not reach the xAI API/],
  ];
  for (const [thrown, message] of cases) {
    const provider = createCompatibleProvider({
      vendor: 'xai',
      client: fake(async () => {
        throw thrown;
      }).client,
    });
    await assert.rejects(
      completeReadTool(provider, { tool: REVIEW_TOOL_NAME, input: reviewInput, scenario: 'success' }, signal()),
      (error: unknown) => error instanceof HarnessError && message.test(error.message) && !error.message.includes(secret),
    );
  }
});

test('cancel aborts the call and reports cancelled', async () => {
  const controller = new AbortController();
  const provider = createCompatibleProvider({
    vendor: 'openai',
    client: fake(
      (call) =>
        new Promise((_resolve, reject) => {
          call.signal.addEventListener('abort', () => reject(new OpenAI.APIUserAbortError()), { once: true });
        }),
    ).client,
  });
  const pending = completeReadTool(provider, { tool: REVIEW_TOOL_NAME, input: reviewInput, scenario: 'success' }, controller.signal);
  controller.abort();
  await assert.rejects(pending, isCode('cancelled'));
});

test('a missing key fails at the first question without a network call', async () => {
  for (const vendor of ['openai', 'xai'] as CompatibleVendor[]) {
    const provider = createCompatibleProvider({ vendor, client: sdkResponsesClient(vendor, undefined) });
    await assert.rejects(
      completeReadTool(provider, { tool: REVIEW_TOOL_NAME, input: reviewInput, scenario: 'success' }, signal()),
      (error: unknown) => error instanceof HarnessError && error.message === noCredentialsMessage(vendor),
    );
  }
});

test('STOME_EFFORT is validated', () => {
  assert.equal(parseOpenAiEffort(undefined), undefined);
  assert.equal(parseOpenAiEffort('MAX'), 'max');
  assert.throws(() => parseOpenAiEffort('turbo'), /STOME_EFFORT/);
});

test('STOME_PROVIDER=openai|xai reports the vendor in /v1/status and never returns the key', async () => {
  for (const [vendor, keyEnv, model] of [
    ['openai', 'OPENAI_API_KEY', 'gpt-6-astra'],
    ['xai', 'XAI_API_KEY', 'grok-4.7'],
  ] as const) {
    const secret = `${vendor}-SECRET-KEY-VALUE`;
    const live = await liveConfigFromEnv({ STOME_PROVIDER: vendor, [keyEnv]: secret });
    assert.ok(live);
    assert.deepEqual(live.status, { provider: vendor, model, live: true, tools: [...ALLOWED_TOOL_NAMES] });
    assert.ok(!live.banner.includes(secret));
    assert.match(live.banner, new RegExp(`${keyEnv} env var: set`));
    const origin = 'http://127.0.0.1:8081';
    const handle = await startCompanion({ origin, token: 'pair-token', expiresAt: Date.now() + 60_000, provider: live.provider, status: live.status });
    try {
      const response = await fetch(`${handle.url}/v1/status`, { headers: { origin, 'x-stome-token': 'pair-token' } });
      const body = await response.text();
      assert.ok(body.includes(`"provider":"${vendor}"`));
      assert.ok(!body.includes(secret));
    } finally {
      await handle.close();
    }
  }
  const custom = await liveConfigFromEnv({ STOME_PROVIDER: 'xai', STOME_MODEL: 'grok-build-0.1', XAI_API_KEY: 'k' });
  assert.equal(custom?.status.model, 'grok-build-0.1');
});

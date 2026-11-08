// Live provider checks. A fake client stands in for the SDK: no network, no key.
import Anthropic from '@anthropic-ai/sdk';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FALLBACK_BETA,
  NO_CREDENTIALS_MESSAGE,
  anchorFor,
  createAnthropicProvider,
  normalizeError,
  parseEffort,
  type LiveMessage,
  type MessageClient,
} from '../companion/providers/anthropic.ts';
import { liveConfigFromEnv, startCompanion } from '../companion/server.ts';
import { ALLOWED_TOOL_NAMES, EDIT_TOOL_NAME, HarnessError, TOOL_NAME } from '../src/harness/contract.ts';
import { completeReadTool, completeWithLimits } from '../src/harness/provider.ts';
import {
  BOARD_TOOL_NAME,
  IMPORT_TOOL_NAME,
  REVIEW_TOOL_NAME,
  type BoardStickiesOutput,
  type ImportSuggestOutput,
  type ReviewQuestionOutput,
} from '../src/harness/tools.ts';

type Call = { params: Record<string, unknown>; signal: AbortSignal };

function fake(reply: LiveMessage | ((call: Call) => Promise<LiveMessage>)): { client: MessageClient; calls: Call[] } {
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

function json(value: unknown, stop_reason: string = 'end_turn'): LiveMessage {
  return { stop_reason, content: [{ type: 'thinking' }, { type: 'text', text: JSON.stringify(value) }] };
}

const signal = () => new AbortController().signal;
const TEXT = 'Chlorophyll absorbs red and blue light. It reflects green light, which is why leaves look green.'.repeat(2);
const annotateInput = {
  roomId: 'r1',
  prompt: 'Why are leaves green?',
  chunks: [
    { id: 'c1', roomId: 'r1', text: TEXT },
    { id: 'c2', roomId: 'r1', text: 'Other chunk.' },
  ],
  priorMessages: [{ role: 'user' as const, body: 'earlier' }],
};

test('annotation: quote is anchored with indexOf and the output has the exact shape', async () => {
  const quote = 'It reflects green light';
  const { client, calls } = fake(json({ chunkId: 'c1', body: 'Because it reflects green.', quote }));
  const out = await completeWithLimits(
    createAnthropicProvider({ client }),
    { tool: TOOL_NAME, input: annotateInput, scenario: 'success' },
    signal(),
  );
  const at = TEXT.indexOf(quote);
  assert.deepEqual(out, {
    roomId: 'r1',
    chunkId: 'c1',
    type: 'ai_answer',
    body: 'Because it reflects green.',
    anchorStart: at,
    anchorEnd: at + quote.length,
  });
  const user = JSON.stringify(calls[0]?.params.messages);
  assert.match(user, /earlier/);
  assert.match(user, /<content/);
});

test('annotation: a quote that is not in the chunk falls back to the first sentence', () => {
  const anchor = anchorFor(TEXT, 'not in the text at all');
  assert.equal(anchor.anchorStart, 0);
  assert.equal(TEXT.slice(anchor.anchorStart, anchor.anchorEnd), 'Chlorophyll absorbs red and blue light.');
  assert.deepEqual(anchorFor('Short note', undefined), { anchorStart: 0, anchorEnd: 10 });
});

test('annotation: a missing quote still yields a valid anchored answer', async () => {
  const { client } = fake(json({ chunkId: 'c2', body: 'Answer', quote: 'nope' }));
  const out = await completeWithLimits(
    createAnthropicProvider({ client }),
    { tool: TOOL_NAME, input: annotateInput, scenario: 'success' },
    signal(),
  );
  assert.equal(out.chunkId, 'c2');
  assert.deepEqual([(out as { anchorStart: number }).anchorStart, (out as { anchorEnd: number }).anchorEnd], [0, 12]);
});

test('annotation: a chunk outside the selection is rejected', async () => {
  const { client } = fake(json({ chunkId: 'other', body: 'x', quote: 'y' }));
  await assert.rejects(
    completeWithLimits(
      createAnthropicProvider({ client }),
      { tool: TOOL_NAME, input: annotateInput, scenario: 'success' },
      signal(),
    ),
    (error: unknown) => error instanceof HarnessError && error.code === 'scope_rejected',
  );
});

test('edit: one chunk, full replacement', async () => {
  const input = { ...annotateInput, chunks: [annotateInput.chunks[1]!], prompt: 'Make it longer' };
  const { client } = fake(json({ body: 'Other chunk, longer.' }));
  const out = await completeWithLimits(
    createAnthropicProvider({ client }),
    { tool: EDIT_TOOL_NAME, input, scenario: 'success' },
    signal(),
  );
  assert.deepEqual(out, { roomId: 'r1', chunkId: 'c2', type: 'chunk_edit', body: 'Other chunk, longer.' });
  await assert.rejects(
    completeWithLimits(
      createAnthropicProvider({ client: fake(json({ body: 'x'.repeat(2001) })).client }),
      { tool: EDIT_TOOL_NAME, input, scenario: 'success' },
      signal(),
    ),
    (error: unknown) => error instanceof HarnessError && error.code === 'output_limit',
  );
});

test('review question maps to ReviewQuestionOutput and rejects another chunk', async () => {
  const input = { roomId: 'r1', chunk: { id: 'c1', roomId: 'r1', text: TEXT } };
  const good = fake(json({ chunkId: 'c1', question: 'Why green?', answer: 'It reflects green.' }));
  const out = await completeReadTool<ReviewQuestionOutput>(
    createAnthropicProvider({ client: good.client }),
    { tool: REVIEW_TOOL_NAME, input, scenario: 'success' },
    signal(),
  );
  assert.deepEqual(out, { chunkId: 'c1', question: 'Why green?', answer: 'It reflects green.' });
  const bad = fake(json({ chunkId: 'zzz', question: 'q', answer: 'a' }));
  await assert.rejects(
    completeReadTool(
      createAnthropicProvider({ client: bad.client }),
      { tool: REVIEW_TOOL_NAME, input, scenario: 'success' },
      signal(),
    ),
    (error: unknown) => error instanceof HarnessError && error.code === 'scope_rejected',
  );
});

test('board stickies map to BoardStickiesOutput', async () => {
  const input = { roomId: 'r1', prompt: 'Summarize', items: [{ id: 'i1', kind: 'sticky' as const, text: 'Buy milk' }] };
  const { client } = fake(json({ summary: 'One errand.', stickies: [{ text: 'Buy milk today' }] }));
  const out = await completeReadTool<BoardStickiesOutput>(
    createAnthropicProvider({ client }),
    { tool: BOARD_TOOL_NAME, input, scenario: 'success' },
    signal(),
  );
  assert.deepEqual(out, { summary: 'One errand.', stickies: [{ text: 'Buy milk today' }] });
});

test('import suggestions map, and an invented room id is rejected', async () => {
  const input = {
    notes: [{ id: 'n1', title: 'Cells', text: 'mitochondria' }],
    rooms: [{ id: 'room-bio', name: 'Biology' }],
  };
  const good = fake(
    json({ suggestions: [{ noteId: 'n1', roomId: 'room-bio', newRoomName: null, subjects: ['cells'] }] }),
  );
  const out = await completeReadTool<ImportSuggestOutput>(
    createAnthropicProvider({ client: good.client }),
    { tool: IMPORT_TOOL_NAME, input, scenario: 'success' },
    signal(),
  );
  assert.equal(out.suggestions[0]?.roomId, 'room-bio');
  const invented = fake(
    json({ suggestions: [{ noteId: 'n1', roomId: 'room-made-up', newRoomName: null, subjects: [] }] }),
  );
  await assert.rejects(
    completeReadTool(
      createAnthropicProvider({ client: invented.client }),
      { tool: IMPORT_TOOL_NAME, input, scenario: 'success' },
      signal(),
    ),
    (error: unknown) => error instanceof HarnessError && error.code === 'scope_rejected',
  );
});

test('refusal and max_tokens are normalized before content is read', async () => {
  const input = { roomId: 'r1', chunk: { id: 'c1', roomId: 'r1', text: TEXT } };
  const run = (message: LiveMessage) =>
    completeReadTool(
      createAnthropicProvider({ client: fake(message).client }),
      { tool: REVIEW_TOOL_NAME, input, scenario: 'success' },
      signal(),
    );
  await assert.rejects(
    run({ stop_reason: 'refusal', content: [] }),
    (error: unknown) =>
      error instanceof HarnessError && error.code === 'provider_error' && error.message === 'The model declined this request',
  );
  await assert.rejects(
    run(json({ chunkId: 'c1', question: 'q', answer: 'a' }, 'max_tokens')),
    (error: unknown) => error instanceof HarnessError && error.code === 'output_limit',
  );
});

test('SDK errors map to short provider_error messages without echoing secrets', () => {
  const s = signal();
  const headers = new Headers();
  const secret = 'sk-ant-SECRET';
  const cases: [unknown, RegExp][] = [
    [Anthropic.APIError.generate(401, { error: { message: secret } }, secret, headers), /key was rejected/],
    [Anthropic.APIError.generate(403, { error: { message: secret } }, secret, headers), /not allowed/],
    [Anthropic.APIError.generate(429, { error: { message: secret } }, secret, headers), /Rate limited by Anthropic/],
    [Anthropic.APIError.generate(400, { error: { message: secret } }, secret, headers), /rejected the request/],
    [new Anthropic.APIConnectionError({ message: secret }), /Could not reach/],
    [Anthropic.APIError.generate(500, { error: { message: secret } }, secret, headers), /failed before answering/],
    [new Error('Could not resolve authentication method. Expected one of apiKey'), new RegExp(NO_CREDENTIALS_MESSAGE)],
  ];
  for (const [error, pattern] of cases) {
    const mapped = normalizeError(error, s);
    assert.equal(mapped.code, 'provider_error');
    assert.match(mapped.message, pattern);
    assert.doesNotMatch(mapped.message, /SECRET/);
  }
});

test('abort maps to cancelled, and the harness timeout stays a timeout', async () => {
  const hang = (call: Call): Promise<LiveMessage> =>
    new Promise((_resolve, reject) => {
      call.signal.addEventListener('abort', () => reject(new Anthropic.APIUserAbortError()), { once: true });
    });
  const provider = createAnthropicProvider({ client: fake(hang).client });
  const input = { roomId: 'r1', chunk: { id: 'c1', roomId: 'r1', text: TEXT } };
  const controller = new AbortController();
  const pending = completeReadTool(
    provider,
    { tool: REVIEW_TOOL_NAME, input, scenario: 'success' },
    controller.signal,
  );
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, (error: unknown) => error instanceof HarnessError && error.code === 'cancelled');
  await assert.rejects(
    completeReadTool(provider, { tool: REVIEW_TOOL_NAME, input, scenario: 'success' }, signal(), 20),
    (error: unknown) => error instanceof HarnessError && error.code === 'timeout',
  );
});

test('request params: model, effort, structured output, fallback; no thinking/temperature/tool_choice', async () => {
  const input = { roomId: 'r1', chunk: { id: 'c1', roomId: 'r1', text: TEXT } };
  const { client, calls } = fake(json({ chunkId: 'c1', question: 'q', answer: 'a' }));
  await completeReadTool(
    createAnthropicProvider({ client, effort: 'high' }),
    { tool: REVIEW_TOOL_NAME, input, scenario: 'success' },
    signal(),
  );
  const params = calls[0]!.params;
  assert.equal(params.model, 'claude-opus-5-5');
  assert.equal(params.max_tokens, 16000);
  const config = params.output_config as { effort: string; format: { type: string; schema: Record<string, unknown> } };
  assert.equal(config.effort, 'high');
  assert.equal(config.format.type, 'json_schema');
  assert.equal(config.format.schema.additionalProperties, false);
  assert.deepEqual(params.betas, [FALLBACK_BETA]);
  assert.equal(params.fallbacks, 'default');
  for (const forbidden of ['thinking', 'temperature', 'top_p', 'top_k', 'tool_choice', 'tools', 'output_format']) {
    assert.equal(forbidden in params, false, `${forbidden} must not be sent`);
  }
  const messages = params.messages as { role: string }[];
  assert.equal(messages.at(-1)?.role, 'user');
});

test('effort parsing and env selection', async () => {
  assert.equal(parseEffort(undefined), 'medium');
  assert.equal(parseEffort('XHigh'), 'xhigh');
  assert.throws(() => parseEffort('turbo'));
  assert.equal(await liveConfigFromEnv({}), null);
  assert.equal(await liveConfigFromEnv({ STOME_PROVIDER: 'mock' }), null);
  for (const name of ['anthropic', 'api-key']) {
    const live = await liveConfigFromEnv({ STOME_PROVIDER: name, ANTHROPIC_API_KEY: 'sk-ant-SECRET-VALUE' });
    assert.equal(live?.status.model, 'claude-opus-5-5');
    assert.doesNotMatch(live?.banner ?? '', /SECRET/);
    assert.match(live?.banner ?? '', /claude-opus-5-5/);
  }
});

test('the companion serves /v1/status for the live provider with no key-like strings', async () => {
  const { client } = fake(json({ chunkId: 'c1', question: 'q', answer: 'a' }));
  const origin = 'http://localhost:8081';
  const handle = await startCompanion({
    origin,
    token: 'tok',
    expiresAt: Date.now() + 60_000,
    provider: createAnthropicProvider({ client }),
    status: { provider: 'anthropic', model: 'claude-opus-5-5', live: true, tools: [...ALLOWED_TOOL_NAMES] },
  });
  try {
    const response = await fetch(`${handle.url}/v1/status`, { headers: { origin, 'x-stome-token': 'tok' } });
    const text = await response.text();
    assert.equal(response.status, 200);
    const body = JSON.parse(text) as { status: { provider: string; live: boolean; model: string; tools: string[] } };
    assert.equal(body.status.provider, 'anthropic');
    assert.equal(body.status.live, true);
    assert.equal(body.status.model, 'claude-opus-5-5');
    assert.equal(body.status.tools.length, 5);
    assert.doesNotMatch(text, /sk-|api[_-]?key|secret/i);
  } finally {
    await handle.close();
  }
});

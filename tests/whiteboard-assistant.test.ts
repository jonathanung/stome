import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openAiBoardProvider } from '../companion/board-provider.ts';
import { applyBoardCorrection, boardServiceOrigin, mockBoardReply, parseBoardReply, parseBoardRequest } from '../src/whiteboard/assistant.ts';
import { boardToNote, type BoardItem } from '../src/whiteboard/model.ts';

const items: BoardItem[] = [
  { id: 'topic', kind: 'text', x: 20, y: 30, text: 'Cell division' },
  { id: 'arrow', kind: 'arrow', x: 40, y: 50, width: 100, height: 0 },
];
const request = parseBoardRequest({ roomId: 'room-1', revision: 3, action: 'check', items });

test('native board service requires HTTPS and a clean origin', () => {
  assert.equal(boardServiceOrigin('https://board.example.com', 'native'), 'https://board.example.com');
  assert.equal(boardServiceOrigin('http://127.0.0.1:8787', 'web'), 'http://127.0.0.1:8787');
  assert.throws(() => boardServiceOrigin('http://192.168.1.2:8790', 'native'), /HTTPS/);
  assert.throws(() => boardServiceOrigin('https://key@board.example.com', 'native'), /credentials/);
  assert.throws(() => boardServiceOrigin('https://board.example.com/other', 'native'), /path/);
});

test('board replies validate correction targets and do not edit until applied', () => {
  const reply = parseBoardReply({ message: 'Clarify the title', correction: { kind: 'replace_text', targetId: 'topic', text: 'Mitosis', x: 20, y: 30 } }, request);
  assert.equal(items[0].kind === 'text' ? items[0].text : '', 'Cell division');
  const changed = applyBoardCorrection(items, reply.correction, () => 'new-id');
  assert.equal(changed[0].kind === 'text' ? changed[0].text : '', 'Mitosis');
  assert.throws(() => parseBoardReply({ message: 'Wrong', correction: { kind: 'replace_text', targetId: 'other-room-item', text: 'X', x: 20, y: 30 } }, request), /target/);
  assert.throws(() => parseBoardReply({ message: 'Wrong', correction: { kind: 'add_text', targetId: '', text: 'X', x: Infinity, y: 30 } }, request), /position/);
});

test('board request is bounded and board-to-notes preserves text', () => {
  assert.throws(() => parseBoardRequest({ ...request, items: [{ id: 'bad', kind: 'pencil', points: [[1001, 0]] }] }), /Board/);
  assert.match(boardToNote(items), /Cell division/);
  assert.match(boardToNote(items), /1 arrow/);
  assert.match(mockBoardReply(request).message, /Mock check/);
});

test('OpenAI board provider sends a structured, non-stored request and validates output', async () => {
  let sent: Record<string, unknown> = {};
  const provider = openAiBoardProvider({ apiKey: 'test-only-key', model: 'test-model', fetcher: async (_url, init) => {
    sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ message: 'Check the arrow.', correction: { kind: 'none', targetId: '', text: '', x: 0, y: 0 } }) }] }] }), { status: 200 });
  } });
  const reply = await provider.respond(request, new AbortController().signal);
  assert.equal(reply.message, 'Check the arrow.');
  assert.equal(sent.store, false);
  assert.equal(sent.model, 'test-model');
  assert.equal((sent.text as { format: { type: string } }).format.type, 'json_schema');
});


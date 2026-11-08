import assert from 'node:assert/strict';
import { test } from 'node:test';

import { boundsOverlap, itemBounds, selectionBounds, stickiesToProposal, toBoardItemView } from '../src/features/whiteboard/ask.ts';
import { SAMPLE_BOARD, acceptedItems, type BoardItem } from '../src/features/whiteboard/model.ts';
import { HarnessError } from '../src/harness/contract.ts';
import { completeReadTool, mockProvider } from '../src/harness/provider.ts';
import { BOARD_TOOL_NAME, type BoardStickiesOutput } from '../src/harness/tools.ts';

const shape: BoardItem = { kind: 'shape', id: 'a', x: 100, y: 200, w: 130, h: 80, radius: 10, title: 'citrate', caption: '6 carbons' };
const sticky: BoardItem = { kind: 'sticky', id: 'b', x: 10, y: 10, w: 170, text: 'why?', tilt: 1 };
const label: BoardItem = { kind: 'label', id: 'c', x: 5, y: 6, text: 'krebs', size: 'title' };
const stroke: BoardItem = { kind: 'stroke', id: 'd', arrow: true, points: [[10, 20], [50, 90]] };

let counter = 0;
const newId = () => `n${++counter}`;

test('board items map to harness views per kind', () => {
  assert.deepEqual(toBoardItemView(shape), { id: 'a', kind: 'shape', text: 'citrate: 6 carbons' });
  assert.deepEqual(toBoardItemView({ ...shape, caption: undefined }), { id: 'a', kind: 'shape', text: 'citrate' });
  assert.deepEqual(toBoardItemView(sticky), { id: 'b', kind: 'sticky', text: 'why?' });
  assert.deepEqual(toBoardItemView(label), { id: 'c', kind: 'label', text: 'krebs' });
  assert.deepEqual(toBoardItemView(stroke), { id: 'd', kind: 'stroke', text: '' });
});

test('proposal stickies sit beside the selection without overlapping it', () => {
  const output: BoardStickiesOutput = { summary: 's', stickies: [{ text: 'one' }, { text: 'two' }, { text: 'three' }] };
  for (const selection of [[shape], [shape, stroke], [{ ...shape, x: 1300 } as BoardItem], [{ ...shape, x: 1300, y: 10 } as BoardItem, { ...stroke, points: [[0, 0], [1, 1]] } as BoardItem]]) {
    const proposal = stickiesToProposal(output, 'q', selection, newId);
    const bounds = selectionBounds(selection);
    assert.equal(proposal.items.length, 3);
    const ids = new Set(proposal.items.flatMap((p) => [p.id, ...p.items.map((i) => i.id)]));
    assert.equal(ids.size, 6);
    const placed = proposal.items.map((p) => p.items[0]);
    for (const node of placed) {
      assert.equal(node.kind, 'sticky');
      assert.equal(boundsOverlap(itemBounds(node), bounds), false);
    }
    placed.forEach((a, i) => placed.slice(i + 1).forEach((b) => assert.equal(boundsOverlap(itemBounds(a), itemBounds(b)), false)));
    assert.ok(proposal.items.every((p) => p.checked && p.kind === 'sticky'));
  }
});

test('only checked stickies are applied on accept', () => {
  const proposal = stickiesToProposal({ summary: 's', stickies: [{ text: 'one' }, { text: 'two' }] }, 'q', [shape], newId);
  proposal.items[1].checked = false;
  const applied = acceptedItems(proposal);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].kind === 'sticky' && applied[0].text, 'one');
});

test('mock provider answers through completeReadTool and maps to a proposal', async () => {
  const selection = [SAMPLE_BOARD[0], SAMPLE_BOARD[3]];
  const out = await completeReadTool<BoardStickiesOutput>(
    mockProvider,
    { tool: BOARD_TOOL_NAME, input: { roomId: 'r1', prompt: 'what next?', items: selection.map(toBoardItemView) }, scenario: 'success' },
    new AbortController().signal,
  );
  const proposal = stickiesToProposal(out, 'what next?', selection, newId);
  assert.match(proposal.summary, /what next\?/);
  assert.equal(proposal.items.length, 1);
  assert.ok(proposal.items.every((p) => p.checked));
});

test('scenario error surfaces provider_error', async () => {
  await assert.rejects(
    completeReadTool(
      mockProvider,
      { tool: BOARD_TOOL_NAME, input: { roomId: 'r1', prompt: 'x', items: [toBoardItemView(shape)] }, scenario: 'error' },
      new AbortController().signal,
    ),
    (error: unknown) => error instanceof HarnessError && error.code === 'provider_error',
  );
});

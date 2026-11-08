/**
 * "Ask about selection" mappers (lane 4). Pure functions: board items to the
 * harness view, and the harness answer to a `Proposal` of sticky notes.
 * Nothing here touches the database or the board; the screen applies a
 * proposal only after the person accepts it.
 */

import type { StrokeProposal } from '../../harness/contract.ts';
import type { BoardItemView, BoardStickiesOutput } from '../../harness/tools.ts';
import type { BoardItem, Point, Proposal, StickyNode, StrokeNode } from './model.ts';

export const BOARD_W = 1440;
export const BOARD_H = 900;
export const STICKY_W = 170;
/** Matches the hit-test height the screen uses for stickies. */
export const STICKY_H = 80;
const LABEL_W = 160;
const LABEL_H = 40;
const GAP = 40;
const STACK_GAP = 16;

export type Bounds = { x: number; y: number; w: number; h: number };

export function itemBounds(item: BoardItem): Bounds {
  switch (item.kind) {
    case 'shape':
      return { x: item.x, y: item.y, w: item.w, h: item.h };
    case 'sticky':
      return { x: item.x, y: item.y, w: item.w, h: STICKY_H };
    case 'label':
      return { x: item.x, y: item.y, w: LABEL_W, h: LABEL_H };
    case 'stroke': {
      const xs = item.points.map(([x]) => x);
      const ys = item.points.map(([, y]) => y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
  }
}

export function selectionBounds(items: readonly BoardItem[]): Bounds {
  if (items.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const all = items.map(itemBounds);
  const x = Math.min(...all.map((b) => b.x));
  const y = Math.min(...all.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...all.map((b) => b.x + b.w)) - x,
    h: Math.max(...all.map((b) => b.y + b.h)) - y,
  };
}

export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function toBoardItemView(item: BoardItem): BoardItemView {
  switch (item.kind) {
    case 'shape':
      return { id: item.id, kind: 'shape', text: [item.title, item.caption].filter(Boolean).join(': ') };
    case 'sticky':
      return { id: item.id, kind: 'sticky', text: item.text };
    case 'label':
      return { id: item.id, kind: 'label', text: item.text };
    case 'stroke':
      return { id: item.id, kind: 'stroke', text: '' };
  }
}

/**
 * Where sticky `index` goes: a column to the right of the selection, else to
 * the left, else a row below it. Never overlaps the selection bounds.
 */
export function stickyPosition(selection: Bounds, index: number, count: number): { x: number; y: number } {
  const step = STICKY_H + STACK_GAP;
  const rightX = selection.x + selection.w + GAP;
  const leftX = selection.x - GAP - STICKY_W;
  const columnY = Math.max(0, Math.min(selection.y + index * step, BOARD_H - STICKY_H));
  if (rightX + STICKY_W <= BOARD_W) return { x: rightX, y: columnY };
  if (leftX >= 0) return { x: leftX, y: columnY };
  const belowY = Math.min(selection.y + selection.h + GAP, BOARD_H - STICKY_H);
  const rowStep = STICKY_W + STACK_GAP;
  const startX = Math.max(0, Math.min(selection.x, BOARD_W - count * rowStep));
  return { x: startX + index * rowStep, y: belowY };
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function stickiesToProposal(
  output: BoardStickiesOutput,
  prompt: string,
  selection: readonly BoardItem[],
  newId: () => string,
): Proposal {
  const bounds = selectionBounds(selection);
  const count = output.stickies.length;
  return {
    prompt,
    summary: output.summary,
    items: output.stickies.map((sticky, index) => {
      const { x, y } = stickyPosition(bounds, index, count);
      const node: StickyNode = { kind: 'sticky', id: newId(), x, y, w: STICKY_W, text: sticky.text, tilt: index % 2 === 0 ? 1 : -1 };
      return {
        id: `sticky-${index}-${node.id}`,
        title: truncate(sticky.text, 60),
        kind: 'sticky' as const,
        items: [node],
        checked: true,
      };
    }),
  };
}

/**
 * A real stroke proposal (HAR.6 #74) as a board `Proposal`: one ticked
 * `strokes` item holding a dashed `proposed` stroke. Accept applies it
 * through `acceptedItems`, which re-checks the point limits and flips
 * `proposed` to false; the screen confirms the harness session first so
 * the commit lands only on accept.
 */
export function strokeToProposal(
  proposal: Pick<StrokeProposal, 'points'>,
  prompt: string,
  newId: () => string,
): Proposal {
  const count = proposal.points.length;
  const node: StrokeNode = {
    kind: 'stroke',
    id: newId(),
    points: proposal.points.map(([x, y]): Point => [x, y]),
    arrow: false,
    proposed: true,
  };
  return {
    prompt,
    summary: `AI stroke proposal (${count} points). Accept to save it as an annotation.`,
    items: [
      {
        id: `stroke-${node.id}`,
        title: count === 1 ? '1-point stroke' : `${count}-point stroke`,
        kind: 'strokes',
        items: [node],
        checked: true,
      },
    ],
  };
}

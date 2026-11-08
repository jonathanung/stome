/**
 * Whiteboard board model (epic #14, HAR.5 #73, HAR.6 #74).
 *
 * The board lives in local screen state for now: there is no board table, and
 * stroke annotations are chunk-anchored. Nothing here writes to the database.
 * AI output arrives as a `Proposal` that only reaches the board after the user
 * accepts it; items the user leaves unticked are never applied.
 */

import { LIMITS } from '../../data/operations';

export type Point = [number, number];

export type ShapeNode = {
  kind: 'shape';
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  title: string;
  caption?: string;
  proposed?: boolean;
};
export type StickyNode = { kind: 'sticky'; id: string; x: number; y: number; w: number; text: string; tilt: number };
export type LabelNode = { kind: 'label'; id: string; x: number; y: number; text: string; size: 'title' | 'caption' };
export type StrokeNode = { kind: 'stroke'; id: string; points: Point[]; arrow: boolean; proposed?: boolean };
export type BoardItem = ShapeNode | StickyNode | LabelNode | StrokeNode;

export type ProposalItem = {
  id: string;
  title: string;
  kind: 'shape' | 'strokes' | 'image' | 'sticky';
  /** Items applied on accept. Images stay proposals until image storage exists (HAR.5). */
  items: BoardItem[];
  checked: boolean;
};

export type Proposal = { prompt: string; summary: string; items: ProposalItem[] };

export type Tool = 'select' | 'pen' | 'text' | 'rect' | 'arrow' | 'sticky' | 'image' | 'eraser';

export const TOOLS: { id: Tool; label: string }[] = [
  { id: 'select', label: 'select' },
  { id: 'pen', label: 'pen' },
  { id: 'text', label: 'text' },
  { id: 'rect', label: 'rectangle' },
  { id: 'arrow', label: 'arrow' },
  { id: 'sticky', label: 'sticky note' },
  { id: 'image', label: 'image' },
  { id: 'eraser', label: 'eraser' },
];

/** Same limits as the commit boundary: 1–5000 finite points. */
export function validStroke(points: Point[]): boolean {
  return (
    points.length >= 1 &&
    points.length <= LIMITS.strokePoints &&
    points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  );
}

export function pointsToPath(points: Point[]): string {
  if (!points.length) return '';
  const [first, ...rest] = points;
  if (!rest.length) return `M${first[0]} ${first[1]}l0.01 0`;
  return `M${first[0]} ${first[1]}${rest.map(([x, y]) => `L${x} ${y}`).join('')}`;
}

/** Items to add when the user accepts: only ticked, applicable ones. */
export function acceptedItems(proposal: Proposal): BoardItem[] {
  return proposal.items
    .filter((item) => item.checked && item.kind !== 'image')
    .flatMap((item) => item.items)
    .filter((item) => (item.kind === 'stroke' ? validStroke(item.points) : true))
    .map((item) => ('proposed' in item ? { ...item, proposed: false } : item));
}

export function acceptableCount(proposal: Proposal): number {
  return proposal.items.filter((item) => item.checked && item.kind !== 'image').length;
}

/** Sample board, matching the design, so the canvas is not blank before any real data exists. */
export const SAMPLE_BOARD: BoardItem[] = [
  { kind: 'shape', id: 'n1', x: 190, y: 256, w: 132, h: 84, radius: 18, title: 'acetyl-coa', caption: '2 carbons' },
  { kind: 'shape', id: 'n2', x: 480, y: 250, w: 140, h: 96, radius: 48, title: 'citrate', caption: '6 carbons' },
  { kind: 'shape', id: 'n3', x: 618, y: 462, w: 150, h: 96, radius: 48, title: 'α-ketoglutarate', caption: 'releases co₂' },
  { kind: 'shape', id: 'n4', x: 380, y: 620, w: 132, h: 90, radius: 45, title: 'succinate' },
  { kind: 'stroke', id: 's1', arrow: true, points: [[322, 300], [380, 286], [430, 288], [480, 300]] },
  { kind: 'stroke', id: 's2', arrow: true, points: [[610, 340], [660, 380], [680, 420], [684, 460]] },
  { kind: 'stroke', id: 's3', arrow: true, points: [[650, 590], [610, 640], [560, 660], [500, 664]] },
  { kind: 'label', id: 'l1', x: 360, y: 440, text: 'krebs cycle', size: 'title' },
  { kind: 'sticky', id: 'k1', x: 860, y: 250, w: 170, text: 'where does the cycle start over?', tilt: 2 },
];

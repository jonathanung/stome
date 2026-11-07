/**
 * Human whiteboard contract for epic #14.
 *
 * Route: `/board/[roomId]` (`src/app/board/[roomId].tsx`)
 * Components: `WhiteboardScreen`, `BoardCanvas`
 * Data: one room-owned chunk (`sourceLink` `stome:whiteboard`) plus one
 * `annotation.create` per finished pencil stroke. Points live in the stroke
 * anchor. This module does not add a table or an annotation type.
 *
 * The commit gate (see `checkAnchor` in `src/data/commit.ts`) accepts a stroke
 * of 1–5000 finite `[x, y]` pairs and does not check board bounds. This board
 * additionally keeps human points inside `BOARD_SPACE` before that commit.
 * Clear and delete are separate explicit calls; both use `source: "human"`.
 *
 * Not implemented here:
 * - #74 AI strokes. A future proposal must commit `annotation.create` with
 *   `source: "ai"` and `confirmed: true` after the person accepts it, using
 *   the same point rules. It must not use the human permission path.
 * - #73 images. There is no image annotation type. Image bytes do not belong
 *   in a stroke payload.
 */

import type { Operation } from '../../data/operations.ts';
import { LIMITS } from '../../data/operations.ts';

export const WHITEBOARD_ROUTE = '/board/[roomId]' as const;
export const WHITEBOARD_COMPONENTS = ['WhiteboardScreen', 'BoardCanvas'] as const;

export const WHITEBOARD_SOURCE_LINK = 'stome:whiteboard';
export const WHITEBOARD_CHUNK_BODY = 'Whiteboard';
export const WHITEBOARD_SUBJECT = 'whiteboard';

/** Unscaled board space. Pointer positions are converted into this space before save. */
export const BOARD_SPACE = { width: 1000, height: 700 } as const;

/** Pencil width in board units, stored on the payload and used when drawing. */
export const STROKE_WIDTH = 3;

export const WHITEBOARD_POINT_LIMITS = {
  min: 1,
  max: LIMITS.strokePoints,
} as const;

/**
 * Connection contract for a later preview (#74 owns that panel; this board does not).
 * Pull: `loadBoard(db, roomId)` in `session.ts`.
 * Push: `boardRefresh.notify(roomId)` in `refresh.ts`.
 * Listen: `boardRefresh.subscribe((roomId) => ...)` — `WhiteboardScreen` already does.
 */
export const WHITEBOARD_CONTRACT = {
  issue: 14,
  routePattern: WHITEBOARD_ROUTE,
  href: '/board/<roomId>',
  components: WHITEBOARD_COMPONENTS,
  coordinate: {
    space: 'board',
    origin: 'top-left',
    unit: 'board unit, not a screen pixel, rounded to 0.01 from the pointer',
    width: BOARD_SPACE.width,
    height: BOARD_SPACE.height,
    minX: 0,
    minY: 0,
    maxX: BOARD_SPACE.width,
    maxY: BOARD_SPACE.height,
    humanSaveRejectsOutOfBounds: true,
    commitGateRejectsOutOfBounds: false,
  },
  stroke: {
    annotationType: 'stroke',
    humanSource: 'human',
    humanConfirmed: false,
    pointsLiveIn: 'anchor.points',
    pointMin: WHITEBOARD_POINT_LIMITS.min,
    pointMax: WHITEBOARD_POINT_LIMITS.max,
    payload: {
      v: 1,
      kind: 'pencil',
      boardWidth: BOARD_SPACE.width,
      boardHeight: BOARD_SPACE.height,
      width: STROKE_WIDTH,
    },
  },
  chunk: {
    sourceLink: WHITEBOARD_SOURCE_LINK,
    body: WHITEBOARD_CHUNK_BODY,
    subject: WHITEBOARD_SUBJECT,
    id: 'wb-<roomId>',
    createOpId: 'wbop-<roomId>',
  },
  refresh: {
    load: 'loadBoard(db, roomId): Promise<BoardSnapshot | null>',
    subscribe: 'boardRefresh.subscribe(listener): unsubscribe',
    notify: 'boardRefresh.notify(roomId): void',
  },
} as const;

/**
 * #74 sketch only. The board does not build or commit this operation.
 * `boardBoundsEnforcedByCommit` is false: the live gate checks finiteness and
 * length, not `BOARD_SPACE`.
 */
export const FUTURE_AI_STROKE = {
  issue: 74,
  implemented: false,
  kind: 'annotation.create',
  source: 'ai',
  confirmed: true,
  type: 'stroke',
  pointMin: WHITEBOARD_POINT_LIMITS.min,
  pointMax: WHITEBOARD_POINT_LIMITS.max,
  boardBoundsEnforcedByCommit: false,
} as const;

/** #73 sketch only. No image tool and no image bytes on this board. */
export const FUTURE_IMAGE_INSERT = {
  issue: 73,
  implemented: false,
  reason: 'No image annotation type exists. Do not store image bytes in a stroke payload.',
} as const;

export function whiteboardHref(roomId: string): `/board/${string}` {
  return `/board/${roomId}`;
}

export function isWhiteboardChunk(chunk: { sourceLink: string | null }): boolean {
  return chunk.sourceLink === WHITEBOARD_SOURCE_LINK;
}

export type BoardPoint = [number, number];

export interface ViewSize {
  width: number;
  height: number;
}

export type StrokeReject = 'empty' | 'too_long' | 'non_finite' | 'out_of_bounds' | 'malformed';

export interface PointerDraft {
  points: BoardPoint[];
  /** A further distinct sample would exceed the commit gate, so the gesture must not be saved. */
  capped: boolean;
}

const REJECT_TEXT: Record<StrokeReject, string> = {
  empty: 'A stroke needs at least one point.',
  too_long: `A stroke can have at most ${LIMITS.strokePoints} points.`,
  non_finite: 'Stroke points must be finite numbers.',
  out_of_bounds: `Stroke points must stay inside the ${BOARD_SPACE.width} by ${BOARD_SPACE.height} board.`,
  malformed: 'Stroke points must be [x, y] pairs.',
};

export function emptyDraft(): PointerDraft {
  return { points: [], capped: false };
}

function clamp(value: number, max: number): number {
  if (value < 0) return 0;
  if (value > max) return max;
  return value;
}

/** Hundredths of a board unit. Finer than a pixel on this board, and stable across reloads. */
function roundBoard(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Maps a pointer position in the canvas view into board space, clamped to the board. */
export function pointerToBoard(localX: number, localY: number, view: ViewSize): BoardPoint | null {
  if (!(view.width > 0) || !(view.height > 0)) return null;
  if (!Number.isFinite(localX) || !Number.isFinite(localY)) return null;
  return [
    roundBoard(clamp((localX / view.width) * BOARD_SPACE.width, BOARD_SPACE.width)),
    roundBoard(clamp((localY / view.height) * BOARD_SPACE.height, BOARD_SPACE.height)),
  ];
}

export function appendPointerSample(draft: PointerDraft, localX: number, localY: number, view: ViewSize): PointerDraft {
  if (draft.capped) return draft;
  const point = pointerToBoard(localX, localY, view);
  if (!point) return draft;
  const last = draft.points[draft.points.length - 1];
  if (last && last[0] === point[0] && last[1] === point[1]) return draft;
  if (draft.points.length >= LIMITS.strokePoints) return { points: draft.points, capped: true };
  return { points: [...draft.points, point], capped: false };
}

/**
 * Pointer-up is the explicit save gesture. Cancel, an empty gesture, or a
 * stroke that hit the point cap returns null and must not be written.
 */
export function finishPointerDraft(draft: PointerDraft, reason: 'up' | 'cancel'): BoardPoint[] | null {
  if (reason !== 'up' || draft.capped) return null;
  const accepted = acceptBoardPoints(draft.points);
  return accepted.ok ? accepted.points : null;
}

export interface ClassifiedPoints {
  ok: true;
  points: BoardPoint[];
}

export interface RejectedPoints {
  ok: false;
  reason: StrokeReject;
  message: string;
}

/** Same shape the commit gate enforces: 1–5000 finite pairs, bounds not included. */
export function readStoredStrokePoints(anchor: unknown): BoardPoint[] | null {
  const classified = classifyPoints(anchorPoints(anchor));
  return classified.ok ? classified.points : null;
}

/** Human writes must also lie inside the board. */
export function acceptBoardPoints(points: unknown): ClassifiedPoints | RejectedPoints {
  const classified = classifyPoints(points);
  if (!classified.ok) return { ok: false, reason: classified.reason, message: REJECT_TEXT[classified.reason] };
  for (const [x, y] of classified.points) {
    if (x < 0 || y < 0 || x > BOARD_SPACE.width || y > BOARD_SPACE.height) {
      return { ok: false, reason: 'out_of_bounds', message: REJECT_TEXT.out_of_bounds };
    }
  }
  return classified;
}

export function pencilPayload(): { v: 1; kind: 'pencil'; boardWidth: number; boardHeight: number; width: number } {
  return {
    v: 1,
    kind: 'pencil',
    boardWidth: BOARD_SPACE.width,
    boardHeight: BOARD_SPACE.height,
    width: STROKE_WIDTH,
  };
}

export function strokeWidth(payload: unknown): number {
  if (typeof payload !== 'object' || payload === null) return STROKE_WIDTH;
  const width = (payload as { width?: unknown }).width;
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0 || width > 48) return STROKE_WIDTH;
  return width;
}

export function humanStrokeOperation(input: {
  opId: string;
  chunkId: string;
  points: BoardPoint[];
}): { ok: true; operation: Operation<'annotation.create'> } | RejectedPoints {
  const accepted = acceptBoardPoints(input.points);
  if (!accepted.ok) return accepted;
  return {
    ok: true,
    operation: {
      opId: input.opId,
      kind: 'annotation.create',
      source: 'human',
      confirmed: false,
      payload: {
        chunkId: input.chunkId,
        type: 'stroke',
        anchor: { points: accepted.points },
        payload: pencilPayload(),
      },
    },
  };
}

export function whiteboardChunkId(roomId: string): string | null {
  return boundedId('wb', roomId);
}

export function whiteboardChunkOpId(roomId: string): string | null {
  return boundedId('wbop', roomId);
}

/** Largest axis-aligned board rectangle that fits inside `bounds`. */
export function fittedBoardSize(bounds: ViewSize): ViewSize | null {
  if (!(bounds.width > 0) || !(bounds.height > 0)) return null;
  const aspect = BOARD_SPACE.width / BOARD_SPACE.height;
  let width = bounds.width;
  let height = width / aspect;
  if (height > bounds.height) {
    height = bounds.height;
    width = height * aspect;
  }
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
}

function boundedId(prefix: string, roomId: string): string | null {
  if (typeof roomId !== 'string' || roomId.length === 0) return null;
  const id = `${prefix}-${roomId}`;
  return id.length <= 64 ? id : null;
}

function anchorPoints(anchor: unknown): unknown {
  if (typeof anchor !== 'object' || anchor === null) return anchor;
  return (anchor as { points?: unknown }).points;
}

function classifyPoints(points: unknown): { ok: true; points: BoardPoint[] } | { ok: false; reason: StrokeReject } {
  if (!Array.isArray(points)) return { ok: false, reason: 'malformed' };
  if (points.length === 0) return { ok: false, reason: 'empty' };
  if (points.length > LIMITS.strokePoints) return { ok: false, reason: 'too_long' };
  const out: BoardPoint[] = [];
  for (const point of points) {
    if (!Array.isArray(point) || point.length !== 2) return { ok: false, reason: 'malformed' };
    const [x, y] = point;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, reason: 'non_finite' };
    }
    out.push([x, y]);
  }
  return { ok: true, points: out };
}

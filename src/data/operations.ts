/**
 * The typed operations accepted by the write boundary (issue #36, FND.2).
 * Every change, whether it comes from a person, an import or the AI harness
 * (#32), is one of these.
 */

import type { AnnotationType, ReviewState, RoomStage } from '../db/schema.ts';
import type { AnnotationAnchors } from './models.ts';
import type { BoardItem } from '../whiteboard/model.ts';

export const SOURCES = ['human', 'import', 'ai'] as const;
export type Source = (typeof SOURCES)[number];

export interface Payloads {
  'board.save': { roomId: string; items: BoardItem[] };
  /** One reviewed source note, saved atomically with its provenance. */
  'import.note': {
    sourceId: string;
    fingerprint: string;
    destination: { roomId: string } | { name: string };
    bodies: string[];
    subjects: string[];
  };
  'room.create': { roomId?: string; name: string };
  'room.rename': { roomId: string; name: string };
  /** Always needs `confirmed: true`, whatever the source. */
  'room.delete': { roomId: string };
  /**
   * Creates one chunk per body, in order, at `index` (default: the end).
   * Pasting several paragraphs is one op, so it is all-or-nothing.
   */
  'chunk.create': {
    roomId: string;
    bodies: string[];
    chunkIds?: string[];
    subjects?: string[];
    index?: number;
    sourceLink?: string | null;
  };
  'chunk.update': { chunkId: string; body?: string; subjects?: string[] };
  'chunk.move': { chunkId: string; toIndex: number };
  'chunk.delete': { chunkId: string };
  'annotation.create': {
    annotationId?: string;
    chunkId: string;
    type: AnnotationType;
    anchor: AnnotationAnchors[AnnotationType];
    payload?: Record<string, unknown>;
  };
  'annotation.delete': { annotationId: string };
  /**
   * Latest human review of one chunk for one local calendar day.
   * A second mark that day replaces the row and earns no extra credit.
   * It does not change the chunk. The third distinct chunk-day in a room
   * promotes that room to brick in the same commit.
   */
  'review.mark': { chunkId: string; state: ReviewState; timeZone: string };
}

export interface Results {
  'board.save': { roomId: string; revision: number };
  'import.note': { roomId: string; chunkIds: string[]; skipped: boolean };
  'room.create': { roomId: string; revision: number };
  'room.rename': { roomId: string; revision: number };
  'room.delete': { roomId: string };
  'chunk.create': { chunkIds: string[] };
  'chunk.update': { chunkId: string; revision: number; updatedAt: number };
  'chunk.move': { chunkId: string; revision: number };
  'chunk.delete': { chunkId: string };
  'annotation.create': { annotationId: string };
  'annotation.delete': { annotationId: string };
  'review.mark': {
    chunkId: string;
    state: ReviewState;
    localDay: string;
    markedAt: number;
    dueAt: number;
    timeZone: string;
    stage: RoomStage;
  };
}

export type OpKind = keyof Payloads;

export const OP_KINDS = [
  'board.save',
  'import.note',
  'room.create',
  'room.rename',
  'room.delete',
  'chunk.create',
  'chunk.update',
  'chunk.move',
  'chunk.delete',
  'annotation.create',
  'annotation.delete',
  'review.mark',
] as const satisfies readonly OpKind[];

export type Operation<K extends OpKind = OpKind> = {
  [P in K]: {
    /** Caller-generated and unique per intended change; retries reuse it. */
    opId: string;
    kind: P;
    payload: Payloads[P];
    /** Revision of the target the caller last saw. Required for ops on an existing row. */
    expectedRevision?: number;
    source: Source;
    /** Must be true for AI changes and for room deletion. */
    confirmed: boolean;
  };
}[K];

/** Ops that target an existing row and so must carry `expectedRevision`. */
export const NEEDS_REVISION: ReadonlySet<OpKind> = new Set<OpKind>([
  'room.rename',
  'room.delete',
  'chunk.update',
  'chunk.move',
  'chunk.delete',
  'review.mark',
]);

/** Which sources may run which ops. Humans may do anything. */
export const PERMISSIONS: Record<Source, ReadonlySet<OpKind>> = {
  human: new Set<OpKind>(OP_KINDS),
  import: new Set<OpKind>(['room.create', 'chunk.create', 'import.note']),
  ai: new Set<OpKind>(['annotation.create', 'chunk.update', 'board.save']),
};

export type CommitErrorCode =
  | 'invalid'
  | 'forbidden'
  | 'unconfirmed'
  | 'not_found'
  | 'stale_revision'
  | 'conflict'
  | 'failed';

export interface CommitError {
  code: CommitErrorCode;
  message: string;
}

export type CommitResult<K extends OpKind = OpKind> =
  | { ok: true; duplicate: boolean; value: Results[K] }
  | { ok: false; error: CommitError };

export const LIMITS = {
  roomName: 80,
  body: 50_000,
  subject: 40,
  subjects: 12,
  bodiesPerOp: 200,
  strokePoints: 5_000,
  payloadChars: 20_000,
} as const;

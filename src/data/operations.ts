/**
 * The typed operations accepted by the write boundary (issue #36, FND.2).
 * Every change, whether it comes from a person, an import or the AI harness
 * (#32), is one of these.
 */

import type { AnnotationType, ReviewState, RoomStage, StudyQuestionKind } from '../db/schema.ts';
import type { BoardItem } from '../whiteboard/model.ts';
import type { AnnotationAnchors, SlideItem } from './models.ts';

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
  /**
   * Study materials (STUDY.1 #130). Generated rows are never source notes:
   * every op carries the single-room `roomId`, the `sourceChunkIds` it was
   * grounded on, and the `sourceRevision` snapshot. All study ops need
   * `confirmed: true`; `import` may not write study tables.
   */
  'study.deck.create': {
    deckId?: string;
    roomId: string;
    title: string;
    sourceChunkIds: string[];
    sourceRevision: number;
  };
  'study.card.create': {
    cardId?: string;
    deckId: string;
    roomId: string;
    front: string;
    back: string;
    position?: number;
    sourceChunkIds: string[];
    sourceRevision: number;
  };
  'study.quiz.create': {
    quizId?: string;
    roomId: string;
    title: string;
    sourceChunkIds: string[];
    sourceRevision: number;
  };
  'study.question.create': {
    questionId?: string;
    quizId: string;
    roomId: string;
    kind: StudyQuestionKind;
    stem: string;
    /** Required for `mcq` (2–6 options); empty otherwise. */
    choices?: string[];
    answer: string;
    explanation?: string;
    position?: number;
    sourceChunkIds: string[];
    sourceRevision: number;
  };
  /**
   * One immutable quiz run: score %, per-question right/wrong, duration.
   * History, never edited; replaying an op id adds no row. No source refs:
   * provenance lives on the quiz.
   */
  'study.attempt.save': {
    attemptId?: string;
    quizId: string;
    roomId: string;
    scorePct: number;
    correct: number;
    total: number;
    results: { questionId: string; correct: boolean }[];
    durationMs: number;
  };
  'study.slide-outline.create': {
    outlineId?: string;
    roomId: string;
    title: string;
    slides: SlideItem[];
    sourceChunkIds: string[];
    sourceRevision: number;
  };
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
  'study.deck.create': { deckId: string };
  'study.card.create': { cardId: string };
  'study.quiz.create': { quizId: string };
  'study.question.create': { questionId: string };
  'study.attempt.save': { attemptId: string };
  'study.slide-outline.create': { outlineId: string };
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
  'study.deck.create',
  'study.card.create',
  'study.quiz.create',
  'study.question.create',
  'study.attempt.save',
  'study.slide-outline.create',
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
    /** Must be true for AI changes, room deletion, imports, and study writes. */
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
  ai: new Set<OpKind>([
    'annotation.create',
    'chunk.update',
    'board.save',
    'study.deck.create',
    'study.card.create',
    'study.quiz.create',
    'study.question.create',
    'study.slide-outline.create',
  ]),
};

/** Ops that always need `confirmed: true`, whatever the source. */
export const NEEDS_CONFIRMATION: ReadonlySet<OpKind> = new Set<OpKind>([
  'room.delete',
  'import.note',
  'study.deck.create',
  'study.card.create',
  'study.quiz.create',
  'study.question.create',
  'study.attempt.save',
  'study.slide-outline.create',
]);

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
  studyTitle: 120,
  studyText: 10_000,
  studyChoice: 500,
  studyChoices: 6,
  studySlides: 50,
  studyBullets: 12,
  studyBullet: 1_000,
} as const;

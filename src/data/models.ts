/**
 * Typed models for the #9 data contract. Plain types only, so the UI, the
 * write boundary and later the AI harness (#32) can share them.
 * Timestamps are Unix epoch milliseconds.
 */

import type { AnnotationType, ReviewState, RoomStage } from '../db/schema.ts';

export type { AnnotationType, RoomStage } from '../db/schema.ts';

export interface Room {
  id: string;
  name: string;
  stage: RoomStage;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface Chunk {
  id: string;
  roomId: string;
  position: number;
  body: string;
  subjects: string[];
  sourceLink: string | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

/** A character range inside a chunk's body. */
export interface TextAnchor {
  start: number;
  end: number;
}

/** A freehand stroke, in canvas units. */
export interface StrokeAnchor {
  points: [number, number][];
}

export interface AnnotationAnchors {
  highlight: TextAnchor;
  ai_answer: TextAnchor;
  stroke: StrokeAnchor;
}

export interface Annotation<T extends AnnotationType = AnnotationType> {
  id: string;
  chunkId: string;
  type: T;
  anchor: AnnotationAnchors[T];
  payload: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** A chunk in the recent list, with the name of the room it lives in. */
export interface RecentChunk extends Chunk {
  roomName: string;
}

/** The latest human review stored for one chunk on one local calendar day. */
export interface ReviewMark {
  chunkId: string;
  state: ReviewState;
  localDay: string;
  markedAt: number;
  dueAt: number;
  timeZone: string;
}

/** A chunk whose latest review mark is due at the queried time. */
export interface DueChunk {
  chunk: Chunk;
  mark: ReviewMark;
}

/**
 * Due-ownership rule for REV.3 (#127): annotation-keyed.
 *
 * Each pinned `ai_answer` annotation owns its due clock in `answer_marks`,
 * keyed by annotation id. The source chunk keeps its own clock in
 * `review_marks` and is never moved by an answer mark. To keep one fact from
 * staying due twice, presentation (`planDueItems`, the review queue) hides a
 * chunk's own due entry while any of its answers is due — the answer card
 * replaces it. Once the answer is marked into the future, the chunk shows
 * again under its own clock. Related research #64 is notes-only (no code).
 */
export interface AnswerMark {
  annotationId: string;
  chunkId: string;
  state: ReviewState;
  localDay: string;
  markedAt: number;
  dueAt: number;
  timeZone: string;
}

/**
 * A pinned AI answer with its review clock. `mark` is null until the first
 * human mark; an unmarked answer is due as soon as it is pinned.
 */
export interface DueAnswer {
  annotation: Annotation;
  chunk: Chunk;
  mark: AnswerMark | null;
}

/** Anything the Today/session ordering can rank: a due chunk or a due answer. */
export type DueItem = DueChunk | DueAnswer;

/** True for a due answer; false for a due chunk. */
export function isDueAnswer(item: DueItem): item is DueAnswer {
  return (item as DueAnswer).annotation !== undefined;
}

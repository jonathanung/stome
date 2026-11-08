/**
 * Typed models for the #9 data contract. Plain types only, so the UI, the
 * write boundary and later the AI harness (#32) can share them.
 * Timestamps are Unix epoch milliseconds.
 */

import type { AnnotationType, RoomStage } from '../db/schema.ts';
import type { ReviewState, StudyQuestionKind } from '../db/models.ts';

export type { AnnotationType, RoomStage } from '../db/schema.ts';
export type { ReviewState, StudyQuestionKind } from '../db/models.ts';

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

/* ------------------------------------------------ study materials (#130) */

/**
 * Generated study rows are never source notes: every deck, card, quiz,
 * question and slide carries the chunk ids it was grounded on plus the
 * revision snapshot taken at generation time. A later source edit marks the
 * derived row stale (computed on read); it never rewrites it.
 */
export interface StudyDeck {
  id: string;
  roomId: string;
  title: string;
  sourceChunkIds: string[];
  sourceRevision: number;
  createdAt: number;
  updatedAt: number;
}

export interface StudyCard {
  id: string;
  deckId: string;
  roomId: string;
  position: number;
  front: string;
  back: string;
  sourceChunkIds: string[];
  sourceRevision: number;
  createdAt: number;
  updatedAt: number;
}

export interface StudyQuiz {
  id: string;
  roomId: string;
  title: string;
  sourceChunkIds: string[];
  sourceRevision: number;
  createdAt: number;
  updatedAt: number;
}

export interface StudyQuestion {
  id: string;
  quizId: string;
  roomId: string;
  position: number;
  kind: StudyQuestionKind;
  stem: string;
  choices: string[];
  answer: string;
  explanation: string;
  sourceChunkIds: string[];
  sourceRevision: number;
  createdAt: number;
  updatedAt: number;
}

/** Per-question right/wrong for one quiz run. Replay adds no extra credit. */
export interface StudyAttemptResult {
  questionId: string;
  correct: boolean;
}

export interface StudyAttempt {
  id: string;
  quizId: string;
  roomId: string;
  scorePct: number;
  correct: number;
  total: number;
  results: StudyAttemptResult[];
  durationMs: number;
  createdAt: number;
}

/** One slide inside a slide outline. Slides are embedded, never separate rows. */
export interface SlideItem {
  title: string;
  bullets: string[];
  notes: string;
  sourceChunkIds: string[];
  sourceRevision: number;
}

export interface SlideOutline {
  id: string;
  roomId: string;
  title: string;
  slides: SlideItem[];
  sourceChunkIds: string[];
  sourceRevision: number;
  createdAt: number;
  updatedAt: number;
}

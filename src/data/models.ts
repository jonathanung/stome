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

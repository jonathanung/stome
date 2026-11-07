/**
 * Loads and writes one room's human whiteboard through the existing commit
 * boundary. Nothing here issues SQL, and nothing here uses `source: "ai"`.
 */

import type { Commit } from '../../data/commit.ts';
import type { Db } from '../../db/driver.ts';
import { getChunk, getRoom, listAnnotations, listChunks } from '../../data/queries.ts';
import {
  WHITEBOARD_CHUNK_BODY,
  WHITEBOARD_SOURCE_LINK,
  WHITEBOARD_SUBJECT,
  acceptBoardPoints,
  humanStrokeOperation,
  isWhiteboardChunk,
  readStoredStrokePoints,
  strokeWidth,
  whiteboardChunkId,
  whiteboardChunkOpId,
  type BoardPoint,
  type RejectedPoints,
} from './contract.ts';
import { boardRefresh } from './refresh.ts';

export interface BoardStroke {
  id: string;
  points: BoardPoint[];
  width: number;
  createdAt: number;
}

export interface BoardSnapshot {
  roomId: string;
  roomName: string;
  chunkId: string | null;
  strokes: BoardStroke[];
}

export type BoardFailure = RejectedPoints | { ok: false; reason: string; message: string };

export type SavedStroke = {
  ok: true;
  annotationId: string;
  duplicate: boolean;
  points: BoardPoint[];
};

/** Reads saved strokes. Does not create the board chunk and does not delete anything. */
export async function loadBoard(db: Db, roomId: string): Promise<BoardSnapshot | null> {
  const room = await getRoom(db, roomId);
  if (!room) return null;
  const chunk = (await listChunks(db, roomId)).find(isWhiteboardChunk) ?? null;
  if (!chunk) return { roomId, roomName: room.name, chunkId: null, strokes: [] };
  const annotations = await listAnnotations(db, chunk.id);
  const strokes: BoardStroke[] = [];
  for (const annotation of annotations) {
    if (annotation.type !== 'stroke') continue;
    const points = readStoredStrokePoints(annotation.anchor);
    if (!points) continue;
    strokes.push({
      id: annotation.id,
      points,
      width: strokeWidth(annotation.payload),
      createdAt: annotation.createdAt,
    });
  }
  return { roomId, roomName: room.name, chunkId: chunk.id, strokes };
}

export async function saveHumanStroke(
  db: Db,
  commit: Commit,
  input: { roomId: string; points: BoardPoint[]; opId: string },
): Promise<SavedStroke | BoardFailure> {
  const accepted = acceptBoardPoints(input.points);
  if (!accepted.ok) return accepted;
  const chunk = await ensureWhiteboardChunk(db, commit, input.roomId);
  if (!chunk.ok) return chunk;
  const operation = humanStrokeOperation({ opId: input.opId, chunkId: chunk.chunkId, points: accepted.points });
  if (!operation.ok) return operation;
  const result = await commit(operation.operation);
  if (!result.ok) return { ok: false, reason: result.error.code, message: result.error.message };
  boardRefresh.notify(input.roomId);
  return { ok: true, annotationId: result.value.annotationId, duplicate: result.duplicate, points: accepted.points };
}

/** Deletes one stroke on this room's board. Strokes in other rooms are left alone. */
export async function deleteBoardStroke(
  db: Db,
  commit: Commit,
  opId: string,
  roomId: string,
  annotationId: string,
): Promise<{ ok: true; annotationId: string } | BoardFailure> {
  const board = await loadBoard(db, roomId);
  if (!board) return { ok: false, reason: 'not_found', message: 'This room was not found.' };
  if (!board.strokes.some((stroke) => stroke.id === annotationId)) {
    return { ok: false, reason: 'not_found', message: 'That stroke is not on this board.' };
  }
  const deleted = await deleteAnnotation(commit, opId, annotationId);
  if (deleted.ok) boardRefresh.notify(roomId);
  return deleted;
}

/** Explicit clear of every saved stroke on this room's board. */
export async function clearBoard(
  db: Db,
  commit: Commit,
  newOpId: () => string,
  roomId: string,
): Promise<{ ok: true; deleted: number } | BoardFailure> {
  const board = await loadBoard(db, roomId);
  if (!board) return { ok: false, reason: 'not_found', message: 'This room was not found.' };
  let deleted = 0;
  for (const stroke of board.strokes) {
    const result = await deleteAnnotation(commit, newOpId(), stroke.id);
    if (!result.ok) {
      if (deleted > 0) boardRefresh.notify(roomId);
      return result;
    }
    deleted += 1;
  }
  if (deleted > 0) boardRefresh.notify(roomId);
  return { ok: true, deleted };
}

export async function undoBoardStroke(
  db: Db,
  commit: Commit,
  opId: string,
  roomId: string,
): Promise<{ ok: true; annotationId: string | null } | BoardFailure> {
  const board = await loadBoard(db, roomId);
  if (!board) return { ok: false, reason: 'not_found', message: 'This room was not found.' };
  const last = board.strokes[board.strokes.length - 1];
  if (!last) return { ok: true, annotationId: null };
  const deleted = await deleteBoardStroke(db, commit, opId, roomId, last.id);
  if (!deleted.ok) return deleted;
  return { ok: true, annotationId: deleted.annotationId };
}

async function ensureWhiteboardChunk(
  db: Db,
  commit: Commit,
  roomId: string,
): Promise<{ ok: true; chunkId: string } | BoardFailure> {
  const room = await getRoom(db, roomId);
  if (!room) return { ok: false, reason: 'not_found', message: 'This room was not found.' };
  const existing = (await listChunks(db, roomId)).find(isWhiteboardChunk);
  if (existing) return { ok: true, chunkId: existing.id };
  const chunkId = whiteboardChunkId(roomId);
  const opId = whiteboardChunkOpId(roomId);
  if (!chunkId || !opId) return { ok: false, reason: 'invalid', message: 'This room cannot own a whiteboard.' };
  const created = await commit({
    opId,
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: {
      roomId,
      bodies: [WHITEBOARD_CHUNK_BODY],
      chunkIds: [chunkId],
      subjects: [WHITEBOARD_SUBJECT],
      sourceLink: WHITEBOARD_SOURCE_LINK,
    },
  });
  if (!created.ok) {
    const raced = (await listChunks(db, roomId)).find(isWhiteboardChunk);
    if (raced) return { ok: true, chunkId: raced.id };
    return { ok: false, reason: created.error.code, message: created.error.message };
  }
  const chunk = await getChunk(db, created.value.chunkIds[0]);
  if (!chunk || !isWhiteboardChunk(chunk)) {
    return { ok: false, reason: 'failed', message: 'The whiteboard could not be created.' };
  }
  return { ok: true, chunkId: chunk.id };
}

async function deleteAnnotation(
  commit: Commit,
  opId: string,
  annotationId: string,
): Promise<{ ok: true; annotationId: string } | BoardFailure> {
  const result = await commit({
    opId,
    kind: 'annotation.delete',
    source: 'human',
    confirmed: false,
    payload: { annotationId },
  });
  if (!result.ok) return { ok: false, reason: result.error.code, message: result.error.message };
  return { ok: true, annotationId: result.value.annotationId };
}

/** Read-only queries. Writes go through `commit.ts` only. */

import type { Db } from '../db/driver.ts';
import type { Annotation, Chunk, RecentChunk, Room, RoomStage } from './models.ts';

interface RoomRow {
  id: string;
  name: string;
  stage: RoomStage;
  revision: number;
  created_at: number;
  updated_at: number;
}

interface ChunkRow {
  id: string;
  room_id: string;
  position: number;
  body: string;
  source_link: string | null;
  revision: number;
  created_at: number;
  updated_at: number;
  subjects_json: string;
}

const toRoom = (r: RoomRow): Room => ({
  id: r.id,
  name: r.name,
  stage: r.stage,
  revision: r.revision,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toChunk = (r: ChunkRow): Chunk => ({
  id: r.id,
  roomId: r.room_id,
  position: r.position,
  body: r.body,
  subjects: JSON.parse(r.subjects_json) as string[],
  sourceLink: r.source_link,
  revision: r.revision,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const CHUNK_COLUMNS = `
  c.*, c.content AS body,
  (SELECT json_group_array(subject) FROM
     (SELECT subject FROM chunk_subjects s WHERE s.chunk_id = c.id ORDER BY s.position)) AS subjects_json`;

export async function listRooms(db: Db): Promise<Room[]> {
  const rows = await db.all<RoomRow>('SELECT * FROM rooms ORDER BY name COLLATE NOCASE, created_at');
  return rows.map(toRoom);
}

export async function getRoom(db: Db, roomId: string): Promise<Room | null> {
  const row = await db.get<RoomRow>('SELECT * FROM rooms WHERE id = ?', [roomId]);
  return row ? toRoom(row) : null;
}

export async function listChunks(db: Db, roomId: string): Promise<Chunk[]> {
  const rows = await db.all<ChunkRow>(`SELECT ${CHUNK_COLUMNS} FROM chunks c WHERE c.room_id = ? ORDER BY c.position`, [roomId]);
  return rows.map(toChunk);
}

export async function getChunk(db: Db, chunkId: string): Promise<Chunk | null> {
  const row = await db.get<ChunkRow>(`SELECT ${CHUNK_COLUMNS} FROM chunks c WHERE c.id = ?`, [chunkId]);
  return row ? toChunk(row) : null;
}

/** Most recently edited chunks across all rooms (#39). */
export async function listRecentChunks(db: Db, limit = 30): Promise<RecentChunk[]> {
  const rows = await db.all<ChunkRow & { room_name: string }>(
    `SELECT ${CHUNK_COLUMNS}, r.name AS room_name
       FROM chunks c JOIN rooms r ON r.id = c.room_id
      ORDER BY c.updated_at DESC, c.id
      LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({ ...toChunk(r), roomName: r.room_name }));
}

interface AnnotationRow {
  id: string;
  chunk_id: string;
  type: Annotation['type'];
  anchor: string;
  payload: string;
  created_at: number;
  updated_at: number;
}

const toAnnotation = (row: AnnotationRow): Annotation => ({
  id: row.id,
  chunkId: row.chunk_id,
  type: row.type,
  anchor: JSON.parse(row.anchor),
  payload: JSON.parse(row.payload),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function listAnnotations(db: Db, chunkId: string): Promise<Annotation[]> {
  const rows = await db.all<AnnotationRow>('SELECT * FROM annotations WHERE chunk_id = ? ORDER BY created_at, id', [chunkId]);
  return rows.map(toAnnotation);
}

/** Loads annotations for all chunks in one room without one query per chunk. */
export async function listRoomAnnotations(db: Db, roomId: string): Promise<Annotation[]> {
  const rows = await db.all<AnnotationRow>(
    `SELECT a.* FROM annotations a
       JOIN chunks c ON c.id = a.chunk_id
      WHERE c.room_id = ?
      ORDER BY c.position, a.created_at, a.id`,
    [roomId],
  );
  return rows.map(toAnnotation);
}

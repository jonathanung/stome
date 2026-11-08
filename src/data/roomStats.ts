/** Read-only per-room counts for the rooms grid (#37). Writes go through `commit.ts` only. */

import type { Db } from '../db/driver.ts';

export interface RoomStats {
  chunks: number;
  annotations: number;
  due: number;
}

export const EMPTY_ROOM_STATS: RoomStats = { chunks: 0, annotations: 0, due: 0 };

interface StatsRow {
  room_id: string;
  chunks: number;
  annotations: number;
  due: number;
}

/** Chunk, annotation and due-chunk counts keyed by room id. Rooms with no chunks are absent. */
export async function listRoomStats(db: Db, now: number): Promise<Record<string, RoomStats>> {
  const rows = await db.all<StatsRow>(
    `SELECT c.room_id AS room_id,
            COUNT(*) AS chunks,
            (SELECT COUNT(*) FROM annotations a JOIN chunks ac ON ac.id = a.chunk_id WHERE ac.room_id = c.room_id) AS annotations,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM review_marks m
               WHERE m.chunk_id = c.id AND m.due_at <= ?
                 AND NOT EXISTS (
                   SELECT 1 FROM review_marks newer
                    WHERE newer.chunk_id = m.chunk_id
                      AND (newer.marked_at > m.marked_at
                           OR (newer.marked_at = m.marked_at AND newer.local_day > m.local_day)))
            ) THEN 1 ELSE 0 END) AS due
       FROM chunks c
      GROUP BY c.room_id`,
    [now],
  );
  const out: Record<string, RoomStats> = {};
  for (const r of rows) out[r.room_id] = { chunks: r.chunks, annotations: r.annotations, due: r.due ?? 0 };
  return out;
}

/** Read-only per-room counts for the rooms list. */

import type { Db } from '../db/driver.ts';
import { listDueChunks } from './queries.ts';

export interface RoomStats {
  chunks: number;
  due: number;
}

export async function listRoomStats(db: Db, now: number): Promise<Record<string, RoomStats>> {
  const counts = await db.all<{ room_id: string; n: number }>(
    'SELECT room_id, COUNT(*) AS n FROM chunks GROUP BY room_id',
  );
  const stats: Record<string, RoomStats> = {};
  for (const row of counts) stats[row.room_id] = { chunks: row.n, due: 0 };
  for (const { chunk } of await listDueChunks(db, now)) {
    const entry = stats[chunk.roomId] ?? (stats[chunk.roomId] = { chunks: 0, due: 0 });
    entry.due += 1;
  }
  return stats;
}

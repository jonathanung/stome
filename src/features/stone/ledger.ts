import type { Db } from '../../db/driver.ts';
import type { ReviewState } from '../../db/schema.ts';

export interface LedgerEntry {
  chunkId: string;
  title: string;
  state: ReviewState;
  localDay: string;
  markedAt: number;
}

interface LedgerRow {
  chunk_id: string;
  content: string;
  state: ReviewState;
  local_day: string;
  marked_at: number;
}

export function noteTitle(content: string): string {
  const line = content.split('\n').map((l) => l.replace(/^[#>\-*\s]+/, '').trim()).find(Boolean) ?? 'untitled note';
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

/**
 * Human review marks for one room, newest first. A mark row exists only for a
 * review the person finished, and (chunk, day) is unique, so each row is one credit.
 */
export async function listRoomLedger(db: Db, roomId: string): Promise<LedgerEntry[]> {
  const rows = await db.all<LedgerRow>(
    `SELECT m.chunk_id, c.content, m.state, m.local_day, m.marked_at
       FROM review_marks m JOIN chunks c ON c.id = m.chunk_id
      WHERE c.room_id = ?
      ORDER BY m.marked_at DESC, m.chunk_id`,
    [roomId],
  );
  return rows.map((r) => ({
    chunkId: r.chunk_id,
    title: noteTitle(r.content),
    state: r.state,
    localDay: r.local_day,
    markedAt: r.marked_at,
  }));
}

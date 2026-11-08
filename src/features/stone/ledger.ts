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

export interface ImportActivity {
  sourceId: string;
  noteCount: number;
  importedAt: number;
}

/** Imports into one room. They appear in the ledger as "no credit" so the rule is visible. */
export async function listRoomImports(db: Db, roomId: string): Promise<ImportActivity[]> {
  const rows = await db.all<{ source_id: string; chunk_ids: string; imported_at: number }>(
    'SELECT source_id, chunk_ids, imported_at FROM import_sources WHERE room_id = ? ORDER BY imported_at DESC, source_id',
    [roomId],
  );
  return rows.map((r) => {
    let count = 0;
    try { const ids: unknown = JSON.parse(r.chunk_ids); count = Array.isArray(ids) ? ids.length : 0; } catch { count = 0; }
    return { sourceId: r.source_id, noteCount: count, importedAt: r.imported_at };
  });
}

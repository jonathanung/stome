/** Read-only local search over chunks, highlights and pinned AI answers (#10, #39). */

import type { Db } from '../db/driver.ts';
import { listRecentChunks } from './queries.ts';

export type SearchKind = 'chunk' | 'highlight' | 'ai_answer';

export interface SearchHit {
  key: string;
  kind: SearchKind;
  chunkId: string;
  roomId: string;
  roomName: string;
  subjects: string[];
  text: string;
  updatedAt: number;
}

export interface SearchFilters {
  kinds?: readonly SearchKind[];
  roomId?: string | null;
  subject?: string | null;
}

interface AnnotationHitRow {
  id: string;
  chunk_id: string;
  type: 'highlight' | 'ai_answer';
  anchor: string;
  payload: string;
  updated_at: number;
}

function annotationText(row: AnnotationHitRow, body: string): string {
  let payload: Record<string, unknown> = {};
  let anchor: { start?: unknown; end?: unknown } = {};
  try {
    payload = JSON.parse(row.payload) as Record<string, unknown>;
    anchor = JSON.parse(row.anchor) as typeof anchor;
  } catch {
    return '';
  }
  if (row.type === 'ai_answer') return typeof payload.answer === 'string' ? payload.answer : '';
  const note = payload.text ?? payload.note;
  if (typeof note === 'string' && note.trim()) return note;
  return typeof anchor.start === 'number' && typeof anchor.end === 'number' ? body.slice(anchor.start, anchor.end) : '';
}

/** Case-insensitive substring search, newest first. An empty query returns no hits. */
export async function searchNotes(db: Db, query: string, filters: SearchFilters = {}, limit = 100): Promise<SearchHit[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const kinds = new Set<SearchKind>(filters.kinds?.length ? filters.kinds : ['chunk', 'highlight', 'ai_answer']);
  const chunks = await listRecentChunks(db, 10_000);
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const hits: SearchHit[] = [];
  const keep = (chunkId: string) => {
    const chunk = byId.get(chunkId);
    if (!chunk) return null;
    if (filters.roomId && chunk.roomId !== filters.roomId) return null;
    if (filters.subject && !chunk.subjects.includes(filters.subject)) return null;
    return chunk;
  };
  if (kinds.has('chunk')) {
    for (const chunk of chunks) {
      if (keep(chunk.id) && chunk.body.toLowerCase().includes(needle)) {
        hits.push({ key: `c:${chunk.id}`, kind: 'chunk', chunkId: chunk.id, roomId: chunk.roomId, roomName: chunk.roomName, subjects: chunk.subjects, text: chunk.body, updatedAt: chunk.updatedAt });
      }
    }
  }
  if (kinds.has('highlight') || kinds.has('ai_answer')) {
    const rows = await db.all<AnnotationHitRow>(
      "SELECT id, chunk_id, type, anchor, payload, updated_at FROM annotations WHERE type IN ('highlight', 'ai_answer') ORDER BY updated_at DESC, id",
    );
    for (const row of rows) {
      if (!kinds.has(row.type)) continue;
      const chunk = keep(row.chunk_id);
      if (!chunk) continue;
      const text = annotationText(row, chunk.body);
      if (text.toLowerCase().includes(needle)) {
        hits.push({ key: `a:${row.id}`, kind: row.type, chunkId: chunk.id, roomId: chunk.roomId, roomName: chunk.roomName, subjects: chunk.subjects, text, updatedAt: row.updated_at });
      }
    }
  }
  return hits.sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key)).slice(0, limit);
}

/** Split text into runs, marking the ones that match the query. */
export function highlightRuns(text: string, query: string): { text: string; hit: boolean }[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const runs: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (let found = lower.indexOf(needle); found !== -1; found = lower.indexOf(needle, at)) {
    if (found > at) runs.push({ text: text.slice(at, found), hit: false });
    runs.push({ text: text.slice(found, found + needle.length), hit: true });
    at = found + needle.length;
  }
  if (at < text.length) runs.push({ text: text.slice(at), hit: false });
  return runs;
}

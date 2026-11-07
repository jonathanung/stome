import type { SQLiteDatabase } from 'expo-sqlite';

import { GET_NOTE_SQL, INSERT_NOTE_SQL, LIST_NOTES_SQL } from './schema';

export type Note = {
  id: number;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
};

type NoteRow = {
  id: number;
  title: string;
  body: string;
  created_at: number;
  updated_at: number;
};

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listNotes(db: SQLiteDatabase): Promise<Note[]> {
  const rows = await db.getAllAsync<NoteRow>(LIST_NOTES_SQL);
  return rows.map(toNote);
}

export async function getNote(db: SQLiteDatabase, id: number): Promise<Note | null> {
  const row = await db.getFirstAsync<NoteRow>(GET_NOTE_SQL, id);
  return row ? toNote(row) : null;
}

export async function createNote(
  db: SQLiteDatabase,
  input: { title: string; body: string },
): Promise<void> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length === 0) {
    throw new Error('A note needs a title');
  }
  const now = Date.now();
  await db.runAsync(INSERT_NOTE_SQL, title, body, now, now);
}

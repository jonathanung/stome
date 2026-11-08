import {
  HARNESS_DATABASE_NAME,
  HarnessError,
  proposalMessage,
  type PriorMessage,
  type SessionState,
  type StoredProposal,
} from './contract';

export { HARNESS_DATABASE_NAME };

export type SqlValue = string | number | null;

export type SqlParams = readonly SqlValue[];

export type SqlExecutor = {
  exec(sql: string): Promise<void>;
  get<T>(sql: string, params?: SqlParams): Promise<T | null>;
  all<T>(sql: string, params?: SqlParams): Promise<T[]>;
  run(sql: string, params?: SqlParams): Promise<void>;
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
};

export const HARNESS_SCHEMA_VERSION = 3;

// Isolated from stome.db. These names are harness-owned and are not the
// Foundation Room / chunk / annotation tables. A confirmed answer lives only
// in stome.db `annotations`, written by createCommit (FND.2).
export const HARNESS_MIGRATION_SQL = `
CREATE TABLE harness_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('idle', 'running', 'completed', 'failed', 'cancelled')),
  selected_chunk_ids TEXT NOT NULL,
  run_token TEXT,
  error_code TEXT,
  error_message TEXT,
  proposal_json TEXT,
  confirmed_operation_id TEXT,
  pending_operation_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE harness_messages (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES harness_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE harness_operations (
  id TEXT PRIMARY KEY NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

type SessionRow = {
  id: string;
  room_id: string;
  state: SessionState;
  selected_chunk_ids: string;
  run_token: string | null;
  error_code: string | null;
  error_message: string | null;
  proposal_json: string | null;
  confirmed_operation_id: string | null;
  pending_operation_id: string | null;
  created_at: number;
  updated_at: number;
};

export type HarnessSession = {
  id: string;
  roomId: string;
  state: SessionState;
  selectedChunkIds: string[];
  runToken: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  proposal: StoredProposal | null;
  confirmedOperationId: string | null;
  pendingOperationId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type HarnessOperationResult = {
  replayed: boolean;
  annotationId: string;
  operationId: string;
};

type OperationRow = {
  result_json: string;
};

function mapSession(row: SessionRow): HarnessSession {
  const selected = JSON.parse(row.selected_chunk_ids) as unknown;
  if (!Array.isArray(selected) || selected.some((id) => typeof id !== 'string')) {
    throw new HarnessError('invalid_shape', 'The saved session selection is unreadable');
  }
  return {
    id: row.id,
    roomId: row.room_id,
    state: row.state,
    selectedChunkIds: selected,
    runToken: row.run_token,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    proposal: row.proposal_json ? (JSON.parse(row.proposal_json) as StoredProposal) : null,
    confirmedOperationId: row.confirmed_operation_id,
    pendingOperationId: row.pending_operation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readVersion(db: SqlExecutor): Promise<number> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  if (!row || typeof row.user_version !== 'number') {
    throw new HarnessError('invalid_shape', 'Could not read the harness database version');
  }
  return row.user_version;
}

export async function migrateHarness(db: SqlExecutor): Promise<void> {
  await db.exec('PRAGMA foreign_keys = ON;');
  const version = await readVersion(db);
  if (version > HARNESS_SCHEMA_VERSION) {
    throw new HarnessError('invalid_shape', 'The harness database is newer than this app');
  }
  if (version === HARNESS_SCHEMA_VERSION) {
    return;
  }
  if (version === 0) {
    await db.transaction(async (tx) => {
      await tx.exec(HARNESS_MIGRATION_SQL);
      await tx.exec(`PRAGMA user_version = ${HARNESS_SCHEMA_VERSION}`);
    });
    return;
  }
  // v2 wrote confirmed answers to a harness-local mock table. That adapter is
  // gone: the only confirmed answer now lives in stome.db `annotations` via
  // createCommit. Drop the mock rows and forget their cached operation results
  // so a replay cannot point at an annotation that does not exist.
  const dropStubAnnotations = async (tx: SqlExecutor): Promise<void> => {
    await tx.exec('DROP TABLE IF EXISTS harness_stub_annotations');
    await tx.exec(
      `DELETE FROM harness_operations WHERE instr(result_json, '"annotationId":"stub-') > 0`,
    );
  };
  if (version === 1) {
    await db.transaction(async (tx) => {
      await tx.exec('ALTER TABLE harness_sessions ADD COLUMN pending_operation_id TEXT');
      await dropStubAnnotations(tx);
      await tx.exec(`PRAGMA user_version = ${HARNESS_SCHEMA_VERSION}`);
    });
    return;
  }
  if (version === 2) {
    await db.transaction(async (tx) => {
      await dropStubAnnotations(tx);
      await tx.exec(`PRAGMA user_version = ${HARNESS_SCHEMA_VERSION}`);
    });
  }
}

export async function createSession(
  db: SqlExecutor,
  input: { id: string; roomId: string; selectedChunkIds: readonly string[]; now: number },
): Promise<HarnessSession> {
  await db.run(
    `INSERT INTO harness_sessions (
      id, room_id, state, selected_chunk_ids, created_at, updated_at
    ) VALUES (?, ?, 'idle', ?, ?, ?)`,
    [input.id, input.roomId, JSON.stringify(input.selectedChunkIds), input.now, input.now],
  );
  return requireSession(db, input.id);
}

export async function getSession(db: SqlExecutor, id: string): Promise<HarnessSession | null> {
  const row = await db.get<SessionRow>('SELECT * FROM harness_sessions WHERE id = ?', [id]);
  return row ? mapSession(row) : null;
}

export async function latestSession(db: SqlExecutor): Promise<HarnessSession | null> {
  const row = await db.get<SessionRow>(
    'SELECT * FROM harness_sessions ORDER BY updated_at DESC, id DESC LIMIT 1',
  );
  return row ? mapSession(row) : null;
}

async function requireSession(db: SqlExecutor, id: string): Promise<HarnessSession> {
  const session = await getSession(db, id);
  if (!session) {
    throw new HarnessError('not_found', 'The harness session is missing');
  }
  return session;
}

export async function listMessages(db: SqlExecutor, sessionId: string): Promise<PriorMessage[]> {
  const rows = await db.all<{ role: PriorMessage['role']; body: string }>(
    'SELECT role, body FROM harness_messages WHERE session_id = ? ORDER BY created_at ASC, id ASC',
    [sessionId],
  );
  return rows.map((row) => ({ role: row.role, body: row.body }));
}

export async function startRun(
  db: SqlExecutor,
  input: { sessionId: string; runToken: string; prompt: string; messageId: string; now: number },
): Promise<HarnessSession> {
  return db.transaction(async (tx) => {
    const session = await requireSession(tx, input.sessionId);
    if (session.state === 'running') {
      throw new HarnessError('busy', 'This session is already asking');
    }
    if (session.state === 'idle' || session.state === 'completed' || session.state === 'failed' || session.state === 'cancelled') {
      if (session.proposal && !session.confirmedOperationId && session.state === 'completed') {
        throw new HarnessError('busy', 'Confirm or discard the current proposal before asking again');
      }
    } else {
      throw new HarnessError('invalid_shape', 'This session cannot start a run');
    }
    // The confirmation flag belongs to the current proposal only. Clearing it
    // lets the next proposal be confirmed. The previous operation id still
    // replays from the harness operation record.
    await tx.run(
      `UPDATE harness_sessions
       SET state = 'running', run_token = ?, error_code = NULL, error_message = NULL,
           confirmed_operation_id = NULL, pending_operation_id = NULL, updated_at = ?
       WHERE id = ?`,
      [input.runToken, input.now, input.sessionId],
    );
    await tx.run(
      'INSERT INTO harness_messages (id, session_id, role, body, created_at) VALUES (?, ?, ?, ?, ?)',
      [input.messageId, input.sessionId, 'user', input.prompt, input.now],
    );
    return requireSession(tx, input.sessionId);
  });
}

/** Stable id for a completed proposal whose operation id was never stored. */
export function repairOperationId(sessionId: string, proposalId: string): string {
  const text = `${sessionId}\n${proposalId}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `pin-${(hash >>> 0).toString(16)}-${sessionId.replaceAll('-', '').slice(0, 20)}`;
}

/**
 * A completed proposal and its operation id are stored in one update.
 * If an older crash left the proposal without an id, the repair id is
 * deterministic so a later reopen confirms the same operation.
 */
export async function ensurePendingOperationId(db: SqlExecutor, sessionId: string, now: number): Promise<HarnessSession> {
  const session = await requireSession(db, sessionId);
  if (session.pendingOperationId || session.confirmedOperationId || session.state !== 'completed' || !session.proposal) {
    return session;
  }
  const operationId = repairOperationId(session.id, session.proposal.id);
  await db.run(
    `UPDATE harness_sessions
     SET pending_operation_id = ?, updated_at = ?
     WHERE id = ? AND state = 'completed' AND confirmed_operation_id IS NULL AND pending_operation_id IS NULL`,
    [operationId, now, sessionId],
  );
  return requireSession(db, sessionId);
}

export async function completeRun(
  db: SqlExecutor,
  input: {
    sessionId: string;
    runToken: string;
    proposal: StoredProposal;
    operationId: string;
    messageId: string;
    now: number;
  },
): Promise<'stored' | 'discarded'> {
  const operationId = input.operationId.trim();
  if (operationId.length === 0 || operationId.length > 64) {
    throw new HarnessError('invalid_shape', 'The operation id is missing');
  }
  return db.transaction(async (tx) => {
    const session = await requireSession(tx, input.sessionId);
    if (session.state !== 'running' || session.runToken !== input.runToken) {
      return 'discarded';
    }
    await tx.run(
      `UPDATE harness_sessions
       SET state = 'completed', run_token = NULL, proposal_json = ?,
           confirmed_operation_id = NULL, pending_operation_id = ?,
           error_code = NULL, error_message = NULL, updated_at = ?
       WHERE id = ? AND state = 'running' AND run_token = ?`,
      [JSON.stringify(input.proposal), operationId, input.now, input.sessionId, input.runToken],
    );
    const stored = await requireSession(tx, input.sessionId);
    if (stored.state !== 'completed' || stored.runToken !== null) {
      return 'discarded';
    }
    if (stored.confirmedOperationId !== null) {
      throw new HarnessError('invalid_shape', 'The new proposal kept a previous confirmation');
    }
    await tx.run(
      'INSERT INTO harness_messages (id, session_id, role, body, created_at) VALUES (?, ?, ?, ?, ?)',
      [input.messageId, input.sessionId, 'assistant', proposalMessage(input.proposal), input.now],
    );
    return 'stored';
  });
}

export async function failRun(
  db: SqlExecutor,
  input: { sessionId: string; runToken: string; code: string; message: string; now: number },
): Promise<'stored' | 'discarded'> {
  return db.transaction(async (tx) => {
    const session = await requireSession(tx, input.sessionId);
    if (session.state !== 'running' || session.runToken !== input.runToken) {
      return 'discarded';
    }
    await tx.run(
      `UPDATE harness_sessions
       SET state = 'failed', run_token = NULL, error_code = ?, error_message = ?, updated_at = ?
       WHERE id = ? AND state = 'running' AND run_token = ?`,
      [input.code, input.message, input.now, input.sessionId, input.runToken],
    );
    const stored = await requireSession(tx, input.sessionId);
    return stored.state === 'failed' ? 'stored' : 'discarded';
  });
}

export async function cancelRun(
  db: SqlExecutor,
  input: { sessionId: string; runToken: string; now: number },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const session = await requireSession(tx, input.sessionId);
    if (session.state !== 'running' || session.runToken !== input.runToken) {
      return false;
    }
    await tx.run(
      `UPDATE harness_sessions
       SET state = 'cancelled', run_token = NULL, error_code = 'cancelled', error_message = 'You cancelled this question.', updated_at = ?
       WHERE id = ? AND state = 'running' AND run_token = ?`,
      [input.now, input.sessionId, input.runToken],
    );
    return true;
  });
}

export async function discardProposal(db: SqlExecutor, sessionId: string, now: number): Promise<void> {
  await db.run(
    `UPDATE harness_sessions
     SET proposal_json = NULL, pending_operation_id = NULL, updated_at = ?
     WHERE id = ? AND state = 'completed' AND confirmed_operation_id IS NULL`,
    [now, sessionId],
  );
}

export async function failInterruptedSessions(db: SqlExecutor, now: number): Promise<number> {
  const pending = await db.all<{ id: string }>(
    "SELECT id FROM harness_sessions WHERE state = 'running'",
  );
  if (pending.length === 0) {
    return 0;
  }
  await db.run(
    `UPDATE harness_sessions
     SET state = 'failed', run_token = NULL, error_code = 'interrupted',
         error_message = 'The run was still going when the app restarted.', updated_at = ?
     WHERE state = 'running'`,
    [now],
  );
  return pending.length;
}

function resultFromOperation(row: OperationRow): HarnessOperationResult {
  const parsed = JSON.parse(row.result_json) as HarnessOperationResult;
  return { ...parsed, replayed: true };
}

/**
 * Harness-side record of a commit that already landed in stome.db. This is
 * session bookkeeping, never the annotation itself.
 */
export async function readHarnessOperation(
  db: SqlExecutor,
  operationId: string,
): Promise<HarnessOperationResult | null> {
  const existing = await db.get<OperationRow>('SELECT result_json FROM harness_operations WHERE id = ?', [operationId]);
  return existing ? resultFromOperation(existing) : null;
}

/** Remember the operation id for this proposal before the Foundation commit runs. */
export async function holdOperationId(
  db: SqlExecutor,
  input: { sessionId: string; operationId: string; now: number },
): Promise<void> {
  const operationId = input.operationId.trim();
  if (operationId.length === 0 || operationId.length > 64) {
    throw new HarnessError('invalid_shape', 'The operation id is missing');
  }
  await db.run(
    `UPDATE harness_sessions
     SET pending_operation_id = ?, updated_at = ?
     WHERE id = ? AND state = 'completed' AND confirmed_operation_id IS NULL
       AND (pending_operation_id IS NULL OR pending_operation_id = ?)`,
    [operationId, input.now, input.sessionId, operationId],
  );
  const session = await requireSession(db, input.sessionId);
  if (session.pendingOperationId !== operationId) {
    throw new HarnessError('invalid_shape', 'This proposal already has a different operation id');
  }
}

/** Session bookkeeping after createCommit accepts the pin. Does not write annotations. */
export async function recordFoundationPin(
  db: SqlExecutor,
  input: { sessionId: string; operationId: string; annotationId: string; now: number },
): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await tx.get<OperationRow>('SELECT result_json FROM harness_operations WHERE id = ?', [
      input.operationId,
    ]);
    if (!existing) {
      const result: HarnessOperationResult = {
        replayed: false,
        annotationId: input.annotationId,
        operationId: input.operationId,
      };
      await tx.run('INSERT INTO harness_operations (id, result_json, created_at) VALUES (?, ?, ?)', [
        input.operationId,
        JSON.stringify(result),
        input.now,
      ]);
    }
    await tx.run(
      `UPDATE harness_sessions
       SET confirmed_operation_id = ?, pending_operation_id = NULL, updated_at = ?
       WHERE id = ?`,
      [input.operationId, input.now, input.sessionId],
    );
  });
}

/** Session bookkeeping after createCommit accepts a note edit. Does not write the chunk. */
export async function recordFoundationEdit(
  db: SqlExecutor,
  input: { sessionId: string; operationId: string; chunkId: string; revision: number; now: number },
): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await tx.get<OperationRow>('SELECT result_json FROM harness_operations WHERE id = ?', [
      input.operationId,
    ]);
    if (!existing) {
      const result = {
        replayed: false,
        operationId: input.operationId,
        chunkId: input.chunkId,
        revision: input.revision,
        kind: 'chunk.update' as const,
      };
      await tx.run('INSERT INTO harness_operations (id, result_json, created_at) VALUES (?, ?, ?)', [
        input.operationId,
        JSON.stringify(result),
        input.now,
      ]);
    }
    await tx.run(
      `UPDATE harness_sessions
       SET confirmed_operation_id = ?, pending_operation_id = NULL, updated_at = ?
       WHERE id = ?`,
      [input.operationId, input.now, input.sessionId],
    );
  });
}

/**
 * A confirmed answer is written by createCommit in stome.db. The harness only
 * records that the operation landed so a replay can repair the session flag.
 */

export type HarnessSessionSummary = {
  id: string;
  roomId: string;
  state: SessionState;
  question: string;
  chunkCount: number;
  isEdit: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  hasPinnedAnswer: boolean;
  updatedAt: number;
};

/** Newest-first list for the companion screen. Read-only. */
export async function listSessionSummaries(db: SqlExecutor, limit = 50): Promise<HarnessSessionSummary[]> {
  const rows = await db.all<
    SessionRow & { question: string | null }
  >(
    `SELECT s.*, (
       SELECT m.body FROM harness_messages m
       WHERE m.session_id = s.id AND m.role = 'user'
       ORDER BY m.created_at ASC, m.id ASC LIMIT 1
     ) AS question
     FROM harness_sessions s ORDER BY s.updated_at DESC, s.id DESC LIMIT ?`,
    [limit],
  );
  return rows.map((row) => {
    const session = mapSession(row);
    return {
      id: session.id,
      roomId: session.roomId,
      state: session.state,
      question: row.question ?? '',
      chunkCount: session.selectedChunkIds.length,
      isEdit: session.proposal?.type === 'chunk_edit',
      errorCode: session.errorCode,
      errorMessage: session.errorMessage,
      hasPinnedAnswer: session.confirmedOperationId !== null,
      updatedAt: session.updatedAt,
    };
  });
}

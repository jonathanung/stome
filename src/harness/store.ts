import {
  HARNESS_DATABASE_NAME,
  HarnessError,
  type FoundationAnnotationRequest,
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

export const HARNESS_SCHEMA_VERSION = 2;

// Isolated from stome.db. These names are harness-owned and are not the
// Foundation Room / chunk / annotation tables.
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

CREATE TABLE harness_stub_annotations (
  id TEXT PRIMARY KEY NOT NULL,
  proposal_id TEXT NOT NULL UNIQUE,
  operation_id TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  note_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type = 'ai_answer'),
  body TEXT NOT NULL,
  anchor_start INTEGER NOT NULL,
  anchor_end INTEGER NOT NULL,
  chunk_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (anchor_start >= 0 AND anchor_end > anchor_start)
);

CREATE INDEX harness_stub_annotations_note ON harness_stub_annotations(note_id);
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

export type StubAnnotation = {
  id: string;
  proposalId: string;
  operationId: string;
  roomId: string;
  chunkId: string;
  noteId: number;
  type: 'ai_answer';
  body: string;
  anchorStart: number;
  anchorEnd: number;
  chunkRevision: number;
  createdAt: number;
};

type AnnotationRow = {
  id: string;
  proposal_id: string;
  operation_id: string;
  room_id: string;
  chunk_id: string;
  note_id: number;
  type: 'ai_answer';
  body: string;
  anchor_start: number;
  anchor_end: number;
  chunk_revision: number;
  created_at: number;
};

type OperationRow = {
  result_json: string;
};

export type StubCommitResult = {
  replayed: boolean;
  annotationId: string;
  operationId: string;
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

function mapAnnotation(row: AnnotationRow): StubAnnotation {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    operationId: row.operation_id,
    roomId: row.room_id,
    chunkId: row.chunk_id,
    noteId: row.note_id,
    type: row.type,
    body: row.body,
    anchorStart: row.anchor_start,
    anchorEnd: row.anchor_end,
    chunkRevision: row.chunk_revision,
    createdAt: row.created_at,
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
  if (version === 1) {
    await db.transaction(async (tx) => {
      await tx.exec('ALTER TABLE harness_sessions ADD COLUMN pending_operation_id TEXT');
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
    // replays, and that proposal id still has its stub row.
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

export async function completeRun(
  db: SqlExecutor,
  input: { sessionId: string; runToken: string; proposal: StoredProposal; messageId: string; now: number },
): Promise<'stored' | 'discarded'> {
  return db.transaction(async (tx) => {
    const session = await requireSession(tx, input.sessionId);
    if (session.state !== 'running' || session.runToken !== input.runToken) {
      return 'discarded';
    }
    await tx.run(
      `UPDATE harness_sessions
       SET state = 'completed', run_token = NULL, proposal_json = ?,
           confirmed_operation_id = NULL, error_code = NULL, error_message = NULL, updated_at = ?
       WHERE id = ? AND state = 'running' AND run_token = ?`,
      [JSON.stringify(input.proposal), input.now, input.sessionId, input.runToken],
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
      [input.messageId, input.sessionId, 'assistant', input.proposal.body, input.now],
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

export async function listStubAnnotations(db: SqlExecutor): Promise<StubAnnotation[]> {
  const rows = await db.all<AnnotationRow>(
    'SELECT * FROM harness_stub_annotations ORDER BY created_at ASC, id ASC',
  );
  return rows.map(mapAnnotation);
}

function resultFromOperation(row: OperationRow): StubCommitResult {
  const parsed = JSON.parse(row.result_json) as StubCommitResult;
  return { ...parsed, replayed: true };
}

export async function readStubResult(db: SqlExecutor, operationId: string): Promise<StubCommitResult | null> {
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
      const result: StubCommitResult = {
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

/**
 * Temporary stand-in for the Foundation commit (#36).
 * Writes only harness_stub_annotations. Re-checks the assessed request.
 * A duplicate operation id returns the original result and does not write again.
 */
export async function commitStubAnnotation(
  db: SqlExecutor,
  request: FoundationAnnotationRequest,
  sessionId: string,
  now: number,
): Promise<StubCommitResult> {
  if (request.confirmed !== true || request.source !== 'ai' || request.kind !== 'annotation.create') {
    throw new HarnessError('confirmation_required', 'The stub only accepts a confirmed AI annotation request');
  }
  const existing = await db.get<OperationRow>('SELECT result_json FROM harness_operations WHERE id = ?', [
    request.opId,
  ]);
  if (existing) {
    return resultFromOperation(existing);
  }
  const annotationId = `stub-${request.opId}`;
  try {
    return await db.transaction(async (tx) => {
      const again = await tx.get<OperationRow>('SELECT result_json FROM harness_operations WHERE id = ?', [
        request.opId,
      ]);
      if (again) {
        return resultFromOperation(again);
      }
      const session = await requireSession(tx, sessionId);
      if (session.confirmedOperationId) {
        throw new HarnessError('already_confirmed', 'This proposal was already saved');
      }
      if (session.proposal?.id !== request.payload.proposalId) {
        throw new HarnessError('proposal_mismatch', 'The saved proposal does not match this confirmation');
      }
      const consumed = await tx.get<{ id: string }>(
        'SELECT id FROM harness_stub_annotations WHERE proposal_id = ?',
        [request.payload.proposalId],
      );
      if (consumed) {
        throw new HarnessError('already_confirmed', 'This proposal was already saved');
      }
      await tx.run(
        `INSERT INTO harness_stub_annotations (
          id, proposal_id, operation_id, room_id, chunk_id, note_id, type, body,
          anchor_start, anchor_end, chunk_revision, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'ai_answer', ?, ?, ?, ?, ?)`,
        [
          annotationId,
          request.payload.proposalId,
          request.opId,
          request.payload.roomId,
          request.payload.chunkId,
          request.payload.noteId,
          request.payload.body,
          request.payload.anchorStart,
          request.payload.anchorEnd,
          request.expectedRevision,
          now,
        ],
      );
      const result: StubCommitResult = {
        replayed: false,
        annotationId,
        operationId: request.opId,
      };
      await tx.run('INSERT INTO harness_operations (id, result_json, created_at) VALUES (?, ?, ?)', [
        request.opId,
        JSON.stringify({ ...result }),
        now,
      ]);
      await tx.run(
        `UPDATE harness_sessions
         SET confirmed_operation_id = ?, updated_at = ?
         WHERE id = ? AND confirmed_operation_id IS NULL AND proposal_json IS NOT NULL`,
        [request.opId, now, sessionId],
      );
      const saved = await tx.get<{ confirmed_operation_id: string | null }>(
        'SELECT confirmed_operation_id FROM harness_sessions WHERE id = ?',
        [sessionId],
      );
      if (saved?.confirmed_operation_id !== request.opId) {
        throw new HarnessError('already_confirmed', 'This proposal was already saved');
      }
      return result;
    });
  } catch (error) {
    if (error instanceof HarnessError) {
      throw error;
    }
    const raced = await db.get<OperationRow>('SELECT result_json FROM harness_operations WHERE id = ?', [
      request.opId,
    ]);
    if (raced) {
      return resultFromOperation(raced);
    }
    throw error;
  }
}

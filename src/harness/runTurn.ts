import { createCommit } from '../data/commit';
import { getChunk } from '../data/queries';
import type { Db } from '../db/driver';
import {
  HarnessError,
  TOOL_NAME,
  assertOutputInScope,
  assertSingleRoomSelection,
  assessConfirmedAnnotation,
  chunkViewFromFoundation,
  noteIdFromChunk,
  noteToChunk,
  parseProposeInput,
  requestCharCount,
  PROVIDER_LIMITS,
  type ChunkView,
  type FoundationAnnotationRequest,
  type MockScenario,
  type NoteLike,
  type StoredProposal,
} from './contract';
import { completeWithLimits, type Provider } from './provider';
import {
  cancelRun,
  commitStubAnnotation,
  completeRun,
  createSession,
  discardProposal,
  failRun,
  getSession,
  listMessages,
  readStubResult,
  recordFoundationPin,
  startRun,
  type HarnessSession,
  type SqlExecutor,
  type StubCommitResult,
} from './store';

export type AskStatus = 'proposal' | 'failed' | 'cancelled' | 'discarded';

export type PreparedRun = {
  sessionId: string;
  runToken: string;
  prompt: string;
};

export type AskResult = {
  status: AskStatus;
  session: HarnessSession | null;
  proposal: StoredProposal | null;
  errorCode: string | null;
  errorMessage: string | null;
};

function nowMs(now?: number): number {
  return now ?? Date.now();
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

export async function beginQuestion(
  db: SqlExecutor,
  input: {
    chunks: readonly ChunkView[];
    prompt: string;
    continueSessionId?: string | null;
    now?: number;
  },
): Promise<PreparedRun> {
  const now = nowMs(input.now);
  const typedPrompt = input.prompt.trim();
  if (input.continueSessionId) {
    const existing = await getSession(db, input.continueSessionId);
    if (!existing) {
      throw new HarnessError('not_found', 'There is no saved session to continue');
    }
    const chunks = chunksForSavedSelection(existing.selectedChunkIds, input.chunks);
    assertSingleRoomSelection(chunks);
    if (chunks[0]?.roomId !== existing.roomId) {
      throw new HarnessError('scope_rejected', 'Continuation stays in the original room');
    }
    const prompt = typedPrompt.length > 0 ? typedPrompt : 'Continue';
    const runToken = newId();
    await startRun(db, {
      sessionId: existing.id,
      runToken,
      prompt,
      messageId: newId(),
      now,
    });
    return { sessionId: existing.id, runToken, prompt };
  }
  const prompt = typedPrompt;
  if (prompt.length === 0) {
    throw new HarnessError('invalid_shape', 'Write a question first');
  }
  assertSingleRoomSelection(input.chunks);
  const session = await createSession(db, {
    id: newId(),
    roomId: input.chunks[0]?.roomId ?? '',
    selectedChunkIds: input.chunks.map((chunk) => chunk.id),
    now,
  });
  const runToken = newId();
  await startRun(db, {
    sessionId: session.id,
    runToken,
    prompt,
    messageId: newId(),
    now,
  });
  return { sessionId: session.id, runToken, prompt };
}

function chunksForSavedSelection(selectedIds: readonly string[], chunks: readonly ChunkView[]): ChunkView[] {
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  return selectedIds.map((id) => {
    const chunk = byId.get(id);
    if (!chunk) {
      throw new HarnessError('not_found', 'A saved note is no longer available');
    }
    return chunk;
  });
}

export async function fulfillQuestion(
  db: SqlExecutor,
  prepared: PreparedRun,
  input: {
    chunks: readonly ChunkView[];
    scenario: MockScenario;
    provider: Provider;
    signal: AbortSignal;
    timeoutMs?: number;
    now?: number;
  },
): Promise<AskResult> {
  const now = nowMs(input.now);
  const session = await getSession(db, prepared.sessionId);
  if (!session || session.state !== 'running' || session.runToken !== prepared.runToken) {
    return result('discarded', session, null, null, null);
  }
  try {
    const chunks = chunksForSavedSelection(session.selectedChunkIds, input.chunks);
    assertSingleRoomSelection(chunks);
    if (chunks[0]?.roomId !== session.roomId) {
      throw new HarnessError('scope_rejected', 'The selected notes are outside this session room');
    }
    const priorMessages = (await listMessages(db, session.id)).slice(0, -1);
    const providerInput = parseProposeInput({
      roomId: session.roomId,
      prompt: prepared.prompt,
      chunks: chunks.map((chunk) => ({ id: chunk.id, roomId: chunk.roomId, text: chunk.text })),
      priorMessages,
    });
    if (requestCharCount(providerInput) > PROVIDER_LIMITS.maxRequestChars) {
      throw new HarnessError('request_limit', 'The question and selected notes are over the request limit');
    }
    const output = await completeWithLimits(
      input.provider,
      { tool: TOOL_NAME, input: providerInput, scenario: input.scenario },
      input.signal,
      input.timeoutMs,
    );
    if (input.signal.aborted) {
      await cancelRun(db, { sessionId: prepared.sessionId, runToken: prepared.runToken, now });
      return result('cancelled', await getSession(db, prepared.sessionId), null, 'cancelled', 'You cancelled this question.');
    }
    assertOutputInScope(output, chunks);
    const chunk = chunks.find((item) => item.id === output.chunkId);
    if (!chunk) {
      throw new HarnessError('scope_rejected', 'The proposal targets a chunk that was not selected');
    }
    const proposal: StoredProposal = {
      id: newId(),
      tool: TOOL_NAME,
      roomId: output.roomId,
      chunkId: output.chunkId,
      noteId: chunk.noteId,
      type: 'ai_answer',
      body: output.body,
      anchorStart: output.anchorStart,
      anchorEnd: output.anchorEnd,
      chunkRevision: chunk.revision,
    };
    const stored = await completeRun(db, {
      sessionId: prepared.sessionId,
      runToken: prepared.runToken,
      proposal,
      operationId: newId(),
      messageId: newId(),
      now,
    });
    const finished = await getSession(db, prepared.sessionId);
    if (stored === 'discarded' || finished?.state !== 'completed') {
      return result('discarded', finished, null, null, null);
    }
    return result('proposal', finished, proposal, null, null);
  } catch (error) {
    const code = error instanceof HarnessError ? error.code : 'provider_error';
    const message = error instanceof Error ? error.message : 'The question failed';
    if (code === 'cancelled' || input.signal.aborted) {
      await cancelRun(db, { sessionId: prepared.sessionId, runToken: prepared.runToken, now });
      const finished = await getSession(db, prepared.sessionId);
      if (finished?.state === 'cancelled') {
        return result('cancelled', finished, null, 'cancelled', 'You cancelled this question.');
      }
      return result('discarded', finished, null, null, null);
    }
    const stored = await failRun(db, {
      sessionId: prepared.sessionId,
      runToken: prepared.runToken,
      code,
      message,
      now,
    });
    const finished = await getSession(db, prepared.sessionId);
    if (stored === 'discarded') {
      return result('discarded', finished, null, null, null);
    }
    return result('failed', finished, null, code, message);
  }
}

function result(
  status: AskStatus,
  session: HarnessSession | null,
  proposal: StoredProposal | null,
  errorCode: string | null,
  errorMessage: string | null,
): AskResult {
  return { status, session, proposal, errorCode, errorMessage };
}

function gateFailure(code: string, message: string): HarnessError {
  if (code === 'stale_revision') {
    return new HarnessError('stale_revision', 'The chunk changed after the proposal. Ask again before saving.');
  }
  if (code === 'unconfirmed') {
    return new HarnessError('confirmation_required', message);
  }
  if (code === 'not_found') {
    return new HarnessError('not_found', message);
  }
  if (code === 'conflict') {
    return new HarnessError('proposal_mismatch', message);
  }
  return new HarnessError('invalid_shape', message);
}

function operationFromAssessment(request: FoundationAnnotationRequest) {
  return {
    opId: request.opId,
    kind: 'annotation.create' as const,
    source: 'ai' as const,
    confirmed: true as const,
    expectedRevision: request.expectedRevision,
    payload: {
      chunkId: request.payload.chunkId,
      type: 'ai_answer' as const,
      anchor: { start: request.payload.anchorStart, end: request.payload.anchorEnd },
      payload: { answer: request.payload.body, proposalId: request.payload.proposalId },
    },
  };
}

/**
 * Saves the current proposal as one confirmed AI annotation through createCommit.
 * expectedRevision is the revision stored on the proposal. A newer chunk revision
 * rejects the confirm and is not sent in its place. The operation id was stored
 * on the session before this call. A repeat of that id does not insert another
 * annotation. Demo pins in the harness file are not copied and are not deleted.
 */
export async function confirmFoundationQuestion(
  harness: SqlExecutor,
  app: Db,
  input: { sessionId: string; operationId: string; confirmed: boolean; now?: number },
): Promise<StubCommitResult> {
  const now = nowMs(input.now);
  const operationId = input.operationId.trim();
  const remembered = await readStubResult(harness, operationId);
  if (remembered) {
    return remembered;
  }
  const session = await getSession(harness, input.sessionId);
  if (!session) {
    throw new HarnessError('not_found', 'The harness session is missing');
  }
  if (!session.pendingOperationId) {
    throw new HarnessError('invalid_shape', 'This proposal has no saved operation id');
  }
  if (operationId !== session.pendingOperationId) {
    throw new HarnessError('proposal_mismatch', 'The confirmation does not match the saved operation id');
  }
  if (!session.proposal) {
    throw new HarnessError('proposal_mismatch', 'There is no proposal waiting for confirmation');
  }
  const prior = await app.get<{ kind: string; result: string }>('SELECT kind, result FROM applied_ops WHERE op_id = ?', [
    operationId,
  ]);
  if (prior) {
    if (prior.kind !== 'annotation.create') {
      throw new HarnessError('proposal_mismatch', `This operation id was already used for ${prior.kind}`);
    }
    const value = JSON.parse(prior.result) as { annotationId?: unknown };
    if (typeof value.annotationId !== 'string' || value.annotationId.length === 0) {
      throw new HarnessError('invalid_shape', 'The saved operation has no annotation');
    }
    await recordFoundationPin(harness, {
      sessionId: input.sessionId,
      operationId,
      annotationId: value.annotationId,
      now,
    });
    return { replayed: true, annotationId: value.annotationId, operationId };
  }
  if (noteIdFromChunk(session.proposal.chunkId) !== null) {
    throw new HarnessError(
      'not_found',
      'This question pointed at a demo note. Ask about a chunk. The old pin was left in place.',
    );
  }
  const current = await getChunk(app, session.proposal.chunkId);
  if (!current) {
    throw new HarnessError('not_found', 'The chunk for this proposal is not in the library');
  }
  const request = assessConfirmedAnnotation({
    confirmed: input.confirmed,
    operationId,
    proposal: session.proposal,
    sessionRoomId: session.roomId,
    sessionState: session.state,
    selectedChunkIds: session.selectedChunkIds,
    confirmedOperationId: session.confirmedOperationId,
    chunk: chunkViewFromFoundation(current),
  });
  const commit = createCommit(app, {
    now: () => now,
    newId: () => globalThis.crypto.randomUUID(),
  });
  const saved = await commit(operationFromAssessment(request));
  if (!saved.ok) {
    throw gateFailure(saved.error.code, saved.error.message);
  }
  const annotationId = saved.value.annotationId;
  await recordFoundationPin(harness, { sessionId: session.id, operationId, annotationId, now });
  return { replayed: saved.duplicate, annotationId, operationId };
}

export async function confirmQuestion(
  db: SqlExecutor,
  input: { sessionId: string; note: NoteLike; operationId: string; confirmed: boolean; now?: number },
): Promise<StubCommitResult> {
  const replay = await readStubResult(db, input.operationId.trim());
  if (replay) {
    return replay;
  }
  const session = await getSession(db, input.sessionId);
  if (!session) {
    throw new HarnessError('not_found', 'The harness session is missing');
  }
  const chunk = noteToChunk(input.note);
  const request = assessConfirmedAnnotation({
    confirmed: input.confirmed,
    operationId: input.operationId,
    proposal: session.proposal,
    sessionRoomId: session.roomId,
    sessionState: session.state,
    selectedChunkIds: session.selectedChunkIds,
    confirmedOperationId: session.confirmedOperationId,
    chunk,
  });
  return commitStubAnnotation(db, request, session.id, nowMs(input.now));
}

export async function discardQuestion(db: SqlExecutor, sessionId: string, now?: number): Promise<void> {
  await discardProposal(db, sessionId, nowMs(now));
}

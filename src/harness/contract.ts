// App-owned harness contract. This file does not write Room, chunk, or annotation rows.
// Foundation owns that schema. A confirmed pin is an Operation passed to createCommit.
// FoundationAnnotationRequest is the assessed proposal. The gate payload is built
// from it at confirm time. Older demo pins stay in the harness file.

import { LIMITS } from '../data/operations.ts';

export const SCAFFOLD_ROOM_ID = 'scaffold-notes';

export const PROVIDER_LIMITS = {
  maxRequestChars: 8_000,
  maxOutputChars: 2_000,
  timeoutMs: 30_000,
} as const;

export const PAIRING_TTL_MS = 2 * 60 * 60 * 1000;

export const HARNESS_DATABASE_NAME = 'stome-harness.db';

export const TOOL_NAME = 'notes.proposeAnnotation' as const;

export const EDIT_TOOL_NAME = 'notes.proposeChunkEdit' as const;

/** Whiteboard stroke generation (HAR.6 #74): proposes one chunk-anchored freehand stroke. */
export const STROKE_TOOL_NAME = 'whiteboard.proposeStroke' as const;

export type SessionState = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export type MockScenario = 'success' | 'timeout' | 'error' | 'cancel' | 'oversize';

export const MOCK_SCENARIOS: readonly MockScenario[] = [
  'success',
  'timeout',
  'error',
  'cancel',
  'oversize',
];

export type HarnessErrorCode =
  | 'invalid_shape'
  | 'scope_rejected'
  | 'bad_anchor'
  | 'confirmation_required'
  | 'stale_revision'
  | 'proposal_mismatch'
  | 'not_found'
  | 'already_confirmed'
  | 'request_limit'
  | 'output_limit'
  | 'cancelled'
  | 'timeout'
  | 'provider_error'
  | 'invalid_output'
  | 'interrupted'
  | 'busy';

export class HarnessError extends Error {
  readonly code: HarnessErrorCode;

  constructor(code: HarnessErrorCode, message: string) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
  }
}

export type ChunkView = {
  id: string;
  roomId: string;
  noteId: number;
  label: string;
  text: string;
  revision: number;
};

export type PriorMessage = {
  role: 'user' | 'assistant' | 'system';
  body: string;
};

export type ProposeInput = {
  roomId: string;
  prompt: string;
  chunks: readonly { id: string; roomId: string; text: string }[];
  priorMessages: readonly PriorMessage[];
};

export type ProposeOutput = {
  roomId: string;
  chunkId: string;
  type: 'ai_answer';
  body: string;
  anchorStart: number;
  anchorEnd: number;
};

export type EditProposeOutput = {
  roomId: string;
  chunkId: string;
  type: 'chunk_edit';
  body: string;
};

/** One freehand stroke in canvas units, against the same limits as the commit boundary. */
export type StrokeProposeOutput = {
  roomId: string;
  chunkId: string;
  type: 'stroke';
  points: [number, number][];
};

type ProposalBase = {
  id: string;
  roomId: string;
  chunkId: string;
  noteId: number;
  chunkRevision: number;
};

export type AnnotationProposal = ProposalBase & {
  tool: typeof TOOL_NAME;
  type: 'ai_answer';
  body: string;
  anchorStart: number;
  anchorEnd: number;
};

/** Whole-body replacement. previousBody is the text the proposal was grounded on. */
export type EditProposal = ProposalBase & {
  tool: typeof EDIT_TOOL_NAME;
  type: 'chunk_edit';
  previousBody: string;
  body: string;
};

/** A chunk-anchored whiteboard stroke. Committed as an `annotation.create` of type `stroke`. */
export type StrokeProposal = ProposalBase & {
  tool: typeof STROKE_TOOL_NAME;
  type: 'stroke';
  points: [number, number][];
};

export type StoredProposal = AnnotationProposal | EditProposal | StrokeProposal;

export function isEditProposal(proposal: StoredProposal): proposal is EditProposal {
  return proposal.tool === EDIT_TOOL_NAME;
}

export function isStrokeProposal(proposal: StoredProposal): proposal is StrokeProposal {
  return proposal.tool === STROKE_TOOL_NAME;
}

/** Assistant message stored for a completed run. Strokes have no body, so they summarize. Null reads as empty. */
export function proposalMessage(proposal: StoredProposal | null): string {
  if (!proposal) {
    return '';
  }
  if (isStrokeProposal(proposal)) {
    return `Stroke proposal (${proposal.points.length} points)`;
  }
  return proposal.body;
}

/** Shape the harness hands to FND.2, the only writer for annotations. */
export type FoundationAnnotationRequest = {
  opId: string;
  kind: 'annotation.create';
  source: 'ai';
  confirmed: true;
  expectedRevision: number;
  payload: {
    proposalId: string;
    roomId: string;
    chunkId: string;
    noteId: number;
    type: 'ai_answer';
    body: string;
    anchorStart: number;
    anchorEnd: number;
  };
};

/** Assessed stroke proposal. Committed as an `annotation.create` of type `stroke`. */
export type FoundationStrokeRequest = {
  opId: string;
  kind: 'annotation.create';
  source: 'ai';
  confirmed: true;
  expectedRevision: number;
  payload: {
    proposalId: string;
    roomId: string;
    chunkId: string;
    noteId: number;
    type: 'stroke';
    points: [number, number][];
  };
};

export type NoteLike = {
  id: number;
  title: string;
  body: string;
  updatedAt: number;
};

const NOTE_CHUNK_ID = /^note:([1-9]\d*)$/;

export function noteToChunk(note: NoteLike): ChunkView {
  return {
    id: `note:${note.id}`,
    roomId: SCAFFOLD_ROOM_ID,
    noteId: note.id,
    label: note.title,
    text: note.body,
    revision: note.updatedAt,
  };
}

/** A foundation chunk has no scaffold note. noteId stays 0 so it cannot be mistaken for note 0. */
export function chunkViewFromFoundation(chunk: { id: string; roomId: string; body: string; revision: number }): ChunkView {
  return {
    id: chunk.id,
    roomId: chunk.roomId,
    noteId: 0,
    label: chunk.body.slice(0, 80),
    text: chunk.body,
    revision: chunk.revision,
  };
}

export function noteIdFromChunk(chunkId: string): number | null {
  const match = NOTE_CHUNK_ID.exec(chunkId);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new HarnessError('invalid_shape', 'The tool payload has unexpected or missing fields');
  }
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HarnessError('invalid_shape', `${label} must be a non-empty string`);
  }
  return value;
}

export function requireInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new HarnessError('invalid_shape', `${label} must be an integer`);
  }
  return value;
}

export function requestCharCount(input: ProposeInput): number {
  const texts = input.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  const messages = input.priorMessages.reduce((sum, message) => sum + message.body.length, 0);
  return input.prompt.length + texts + messages;
}

export function parseProposeInput(value: unknown): ProposeInput {
  if (!isRecord(value)) {
    throw new HarnessError('invalid_shape', 'Tool input must be an object');
  }
  exactKeys(value, ['roomId', 'prompt', 'chunks', 'priorMessages']);
  const roomId = requireString(value.roomId, 'roomId');
  const prompt = requireString(value.prompt, 'prompt');
  if (!Array.isArray(value.chunks) || value.chunks.length === 0) {
    throw new HarnessError('invalid_shape', 'Select at least one chunk');
  }
  if (!Array.isArray(value.priorMessages)) {
    throw new HarnessError('invalid_shape', 'priorMessages must be a list');
  }
  const chunks = value.chunks.map((chunk) => {
    if (!isRecord(chunk)) {
      throw new HarnessError('invalid_shape', 'Each chunk must be an object');
    }
    exactKeys(chunk, ['id', 'roomId', 'text']);
    return {
      id: requireString(chunk.id, 'chunk id'),
      roomId: requireString(chunk.roomId, 'chunk room'),
      text: typeof chunk.text === 'string' ? chunk.text : failString('chunk text'),
    };
  });
  const priorMessages = value.priorMessages.map((message) => {
    if (!isRecord(message)) {
      throw new HarnessError('invalid_shape', 'Each message must be an object');
    }
    exactKeys(message, ['role', 'body']);
    const role = message.role;
    if (role !== 'user' && role !== 'assistant' && role !== 'system') {
      throw new HarnessError('invalid_shape', 'A message role is invalid');
    }
    if (typeof message.body !== 'string') {
      throw new HarnessError('invalid_shape', 'A message body must be text');
    }
    const parsed: PriorMessage = { role, body: message.body };
    return parsed;
  });
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (seen.has(chunk.id)) {
      throw new HarnessError('invalid_shape', 'A chunk was included twice');
    }
    seen.add(chunk.id);
    if (chunk.roomId !== roomId) {
      throw new HarnessError('scope_rejected', 'A chunk is outside the session room');
    }
  }
  return { roomId, prompt, chunks, priorMessages };
}

function failString(label: string): never {
  throw new HarnessError('invalid_shape', `${label} must be a string`);
}

export function parseEditOutput(value: unknown): EditProposeOutput {
  if (!isRecord(value)) {
    throw new HarnessError('invalid_shape', 'Tool output must be an object');
  }
  exactKeys(value, ['roomId', 'chunkId', 'type', 'body']);
  if (value.type !== 'chunk_edit') {
    throw new HarnessError('invalid_shape', 'notes.proposeChunkEdit only proposes a whole-note replacement');
  }
  const body = requireString(value.body, 'replacement');
  if (body.length > PROVIDER_LIMITS.maxOutputChars) {
    throw new HarnessError('output_limit', 'The replacement is longer than the output limit');
  }
  return {
    roomId: requireString(value.roomId, 'roomId'),
    chunkId: requireString(value.chunkId, 'chunkId'),
    type: 'chunk_edit',
    body,
  };
}

export function parseProposeOutput(value: unknown): ProposeOutput {
  if (!isRecord(value)) {
    throw new HarnessError('invalid_shape', 'Tool output must be an object');
  }
  exactKeys(value, ['roomId', 'chunkId', 'type', 'body', 'anchorStart', 'anchorEnd']);
  const type = value.type;
  if (type !== 'ai_answer') {
    throw new HarnessError('invalid_shape', 'notes.proposeAnnotation only proposes an AI answer');
  }
  const body = requireString(value.body, 'answer');
  if (body.length > PROVIDER_LIMITS.maxOutputChars) {
    throw new HarnessError('output_limit', 'The answer is longer than the output limit');
  }
  return {
    roomId: requireString(value.roomId, 'roomId'),
    chunkId: requireString(value.chunkId, 'chunkId'),
    type,
    body,
    anchorStart: requireInteger(value.anchorStart, 'anchorStart'),
    anchorEnd: requireInteger(value.anchorEnd, 'anchorEnd'),
  };
}

/**
 * The same 1–5000 finite-points limits as the commit boundary
 * (`LIMITS.strokePoints` in `src/data/operations.ts`, enforced again by
 * `checkAnchor` for `stroke` in `src/data/commit.ts`).
 */
export function parseStrokePoints(value: unknown): [number, number][] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HarnessError('invalid_shape', 'A stroke needs at least one [x, y] point');
  }
  if (value.length > LIMITS.strokePoints) {
    throw new HarnessError('output_limit', `A stroke holds at most ${LIMITS.strokePoints} points`);
  }
  return value.map((point) => {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new HarnessError('invalid_shape', 'Each stroke point must be an [x, y] pair');
    }
    const [x, y] = point;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new HarnessError('invalid_shape', 'Each stroke point must be two finite numbers');
    }
    const parsed: [number, number] = [x, y];
    return parsed;
  });
}

export function parseStrokeOutput(value: unknown): StrokeProposeOutput {
  if (!isRecord(value)) {
    throw new HarnessError('invalid_shape', 'Tool output must be an object');
  }
  exactKeys(value, ['roomId', 'chunkId', 'type', 'points']);
  if (value.type !== 'stroke') {
    throw new HarnessError('invalid_shape', 'whiteboard.proposeStroke only proposes a freehand stroke');
  }
  return {
    roomId: requireString(value.roomId, 'roomId'),
    chunkId: requireString(value.chunkId, 'chunkId'),
    type: 'stroke',
    points: parseStrokePoints(value.points),
  };
}

export const TOOL_REGISTRY = {
  [TOOL_NAME]: {
    name: TOOL_NAME,
    parseInput: parseProposeInput,
    parseOutput: parseProposeOutput,
  },
  [EDIT_TOOL_NAME]: {
    name: EDIT_TOOL_NAME,
    parseInput: parseProposeInput,
    parseOutput: parseEditOutput,
  },
  [STROKE_TOOL_NAME]: {
    name: STROKE_TOOL_NAME,
    parseInput: parseProposeInput,
    parseOutput: parseStrokeOutput,
  },
} as const;

const WRITE_TOOLS = [TOOL_NAME, EDIT_TOOL_NAME, STROKE_TOOL_NAME].sort();

/**
 * Every tool name the companion may run: the write proposals plus the
 * read-only suggestion tools in tools.ts. There is still no shell, file, or
 * plugin tool. Keep this list literal so a new tool is a reviewed change.
 */
export const ALLOWED_TOOL_NAMES = [
  TOOL_NAME,
  EDIT_TOOL_NAME,
  STROKE_TOOL_NAME,
  'review.generateQuestion',
  'board.proposeStickies',
  'import.suggestRooms',
] as const;

export function assertRegistryIsWriteTools(): void {
  const names = Object.keys(TOOL_REGISTRY).sort();
  if (names.length !== WRITE_TOOLS.length || names.some((name, index) => name !== WRITE_TOOLS[index])) {
    throw new HarnessError('invalid_shape', 'The tool registry is no longer the write-tool set');
  }
}

export function selectionFromNotes(notes: readonly NoteLike[], selectedIds: readonly number[]): ChunkView[] {
  const selected = new Set(selectedIds);
  return notes.filter((note) => selected.has(note.id)).map(noteToChunk);
}

export function assertSingleRoomSelection(chunks: readonly ChunkView[]): void {
  if (chunks.length === 0) {
    throw new HarnessError('scope_rejected', 'Select at least one note in this room');
  }
  const roomId = chunks[0]?.roomId;
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (chunk.roomId !== roomId) {
      throw new HarnessError('scope_rejected', 'A session can only include chunks from one room');
    }
    const scaffoldNoteId = noteIdFromChunk(chunk.id);
    if (scaffoldNoteId !== null && scaffoldNoteId !== chunk.noteId) {
      throw new HarnessError('invalid_shape', 'The chunk id does not match the scaffold note');
    }
    if (seen.has(chunk.id)) {
      throw new HarnessError('invalid_shape', 'A chunk was selected twice');
    }
    seen.add(chunk.id);
    if (!Number.isInteger(chunk.revision)) {
      throw new HarnessError('invalid_shape', 'The chunk revision is missing');
    }
  }
}

export function assertAnchor(text: string, start: number, end: number): void {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) {
    throw new HarnessError('bad_anchor', 'The answer anchor does not sit inside the note text');
  }
}

export function assertOutputInScope(output: ProposeOutput, chunks: readonly ChunkView[]): void {
  const roomId = chunks[0]?.roomId;
  if (!roomId || output.roomId !== roomId) {
    throw new HarnessError('scope_rejected', 'The proposal is for a different room');
  }
  const chunk = chunks.find((item) => item.id === output.chunkId);
  if (!chunk) {
    throw new HarnessError('scope_rejected', 'The proposal targets a chunk that was not selected');
  }
  if (chunk.roomId !== output.roomId) {
    throw new HarnessError('scope_rejected', 'The proposal chunk is outside the session room');
  }
  assertAnchor(chunk.text, output.anchorStart, output.anchorEnd);
}

/** Same room and selection rules as an answer, then the stroke point limits. */
export function assertStrokeOutputInScope(output: StrokeProposeOutput, chunks: readonly ChunkView[]): void {
  const roomId = chunks[0]?.roomId;
  if (!roomId || output.roomId !== roomId) {
    throw new HarnessError('scope_rejected', 'The proposal is for a different room');
  }
  const chunk = chunks.find((item) => item.id === output.chunkId);
  if (!chunk) {
    throw new HarnessError('scope_rejected', 'The proposal targets a chunk that was not selected');
  }
  if (chunk.roomId !== output.roomId) {
    throw new HarnessError('scope_rejected', 'The proposal chunk is outside the session room');
  }
  parseStrokePoints(output.points);
}

export function assessConfirmedAnnotation(input: {
  confirmed: boolean;
  operationId: string;
  proposal: StoredProposal | null;
  sessionRoomId: string;
  sessionState: SessionState;
  selectedChunkIds: readonly string[];
  confirmedOperationId: string | null;
  chunk: ChunkView;
}): FoundationAnnotationRequest {
  if (input.confirmed !== true) {
    throw new HarnessError('confirmation_required', 'An AI answer is saved only after you confirm it');
  }
  const operationId = input.operationId.trim();
  if (operationId.length === 0) {
    throw new HarnessError('invalid_shape', 'The confirmation needs an operation id');
  }
  if (input.sessionState !== 'completed' || input.proposal === null) {
    throw new HarnessError('proposal_mismatch', 'There is no proposal waiting for confirmation');
  }
  // confirmedOperationId belongs to the proposal currently stored on the session.
  // A later turn clears it when that proposal is replaced.
  if (input.confirmedOperationId) {
    throw new HarnessError('already_confirmed', 'This proposal was already saved');
  }
  const proposal = input.proposal;
  if (proposal.tool !== TOOL_NAME || proposal.roomId !== input.sessionRoomId) {
    throw new HarnessError('scope_rejected', 'The proposal is outside this session room');
  }
  if (!input.selectedChunkIds.includes(proposal.chunkId)) {
    throw new HarnessError('scope_rejected', 'The proposal targets a chunk that was not selected');
  }
  if (proposal.chunkId !== input.chunk.id || proposal.noteId !== input.chunk.noteId) {
    throw new HarnessError('proposal_mismatch', 'The open note does not match the proposal');
  }
  if (proposal.chunkRevision !== input.chunk.revision) {
    throw new HarnessError('stale_revision', 'The note changed after the proposal. Ask again before saving.');
  }
  assertAnchor(input.chunk.text, proposal.anchorStart, proposal.anchorEnd);
  if (proposal.body.length > PROVIDER_LIMITS.maxOutputChars) {
    throw new HarnessError('output_limit', 'The answer is longer than the output limit');
  }
  return {
    opId: operationId,
    kind: 'annotation.create',
    source: 'ai',
    confirmed: true,
    expectedRevision: proposal.chunkRevision,
    payload: {
      proposalId: proposal.id,
      roomId: proposal.roomId,
      chunkId: proposal.chunkId,
      noteId: proposal.noteId,
      type: 'ai_answer',
      body: proposal.body,
      anchorStart: proposal.anchorStart,
      anchorEnd: proposal.anchorEnd,
    },
  };
}

/**
 * Confirms a stroke proposal for FND.2. Same gates as an answer: explicit
 * confirmation, the stored operation id, the session room and selection, and
 * the chunk revision read at propose time. The points are revalidated so an
 * over-limit or non-finite stroke never reaches the commit.
 */
export function assessConfirmedStroke(input: {
  confirmed: boolean;
  operationId: string;
  proposal: StoredProposal | null;
  sessionRoomId: string;
  sessionState: SessionState;
  selectedChunkIds: readonly string[];
  confirmedOperationId: string | null;
  chunk: ChunkView;
}): FoundationStrokeRequest {
  if (input.confirmed !== true) {
    throw new HarnessError('confirmation_required', 'An AI stroke is saved only after you confirm it');
  }
  const operationId = input.operationId.trim();
  if (operationId.length === 0) {
    throw new HarnessError('invalid_shape', 'The confirmation needs an operation id');
  }
  if (input.sessionState !== 'completed' || input.proposal === null) {
    throw new HarnessError('proposal_mismatch', 'There is no proposal waiting for confirmation');
  }
  if (input.confirmedOperationId) {
    throw new HarnessError('already_confirmed', 'This proposal was already saved');
  }
  const proposal = input.proposal;
  if (!isStrokeProposal(proposal) || proposal.roomId !== input.sessionRoomId) {
    throw new HarnessError('scope_rejected', 'The proposal is outside this session room');
  }
  if (!input.selectedChunkIds.includes(proposal.chunkId)) {
    throw new HarnessError('scope_rejected', 'The proposal targets a chunk that was not selected');
  }
  if (proposal.chunkId !== input.chunk.id || proposal.noteId !== input.chunk.noteId) {
    throw new HarnessError('proposal_mismatch', 'The open chunk does not match the proposal');
  }
  if (proposal.chunkRevision !== input.chunk.revision) {
    throw new HarnessError('stale_revision', 'The chunk changed after the proposal. Ask again before saving.');
  }
  const points = parseStrokePoints(proposal.points);
  return {
    opId: operationId,
    kind: 'annotation.create',
    source: 'ai',
    confirmed: true,
    expectedRevision: proposal.chunkRevision,
    payload: {
      proposalId: proposal.id,
      roomId: proposal.roomId,
      chunkId: proposal.chunkId,
      noteId: proposal.noteId,
      type: 'stroke',
      points,
    },
  };
}

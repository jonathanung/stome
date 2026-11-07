// App-owned harness contract. This file does not write Room, chunk, or annotation rows.
// Foundation (#35, #36) owns that schema and the only commit implementation.
// Until those exist, chunks are scaffold notes and a confirmed write is described
// by FoundationAnnotationRequest, which the stub adapter in store.ts persists.

export const SCAFFOLD_ROOM_ID = 'scaffold-notes';

export const PROVIDER_LIMITS = {
  maxRequestChars: 8_000,
  maxOutputChars: 2_000,
  timeoutMs: 30_000,
} as const;

export const PAIRING_TTL_MS = 2 * 60 * 60 * 1000;

export const HARNESS_DATABASE_NAME = 'stome-harness.db';

export const TOOL_NAME = 'notes.proposeAnnotation' as const;

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

export type StoredProposal = {
  id: string;
  tool: typeof TOOL_NAME;
  roomId: string;
  chunkId: string;
  noteId: number;
  type: 'ai_answer';
  body: string;
  anchorStart: number;
  anchorEnd: number;
  chunkRevision: number;
};

/** Shape the harness will hand to FND.2. The stub is the only writer today. */
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

export function noteIdFromChunk(chunkId: string): number | null {
  const match = NOTE_CHUNK_ID.exec(chunkId);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new HarnessError('invalid_shape', 'The tool payload has unexpected or missing fields');
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HarnessError('invalid_shape', `${label} must be a non-empty string`);
  }
  return value;
}

function requireInteger(value: unknown, label: string): number {
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

export const TOOL_REGISTRY = {
  [TOOL_NAME]: {
    name: TOOL_NAME,
    parseInput: parseProposeInput,
    parseOutput: parseProposeOutput,
  },
} as const;

export function assertRegistryIsNotesOnly(): void {
  const names = Object.keys(TOOL_REGISTRY);
  if (names.length !== 1 || names[0] !== TOOL_NAME) {
    throw new HarnessError('invalid_shape', 'The tool registry is no longer the notes-only set');
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
    if (noteIdFromChunk(chunk.id) !== chunk.noteId) {
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
    expectedRevision: input.chunk.revision,
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

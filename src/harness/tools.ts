// Read-only harness tools beyond the two note-write proposals in contract.ts.
//
// None of these tools writes. Each returns a suggestion the app shows to the
// person, who accepts it through the existing app paths (a human review mark,
// a local board item, an import mapping choice). The companion and the live
// providers treat them like the note tools: same pairing, same limits, same
// normalized errors, and the output is parsed here before the app sees it.

import {
  HarnessError,
  PROVIDER_LIMITS,
  exactKeys,
  isRecord,
  requireString,
} from './contract';

export const REVIEW_TOOL_NAME = 'review.generateQuestion' as const;
export const BOARD_TOOL_NAME = 'board.proposeStickies' as const;
export const IMPORT_TOOL_NAME = 'import.suggestRooms' as const;

export const READ_TOOL_NAMES = [REVIEW_TOOL_NAME, BOARD_TOOL_NAME, IMPORT_TOOL_NAME] as const;
export type ReadToolName = (typeof READ_TOOL_NAMES)[number];

export function isReadTool(name: unknown): name is ReadToolName {
  return typeof name === 'string' && (READ_TOOL_NAMES as readonly string[]).includes(name);
}

/** Request size for any read tool: the serialized input, against the shared request limit. */
export function readToolRequestChars(input: unknown): number {
  return JSON.stringify(input).length;
}

function assertRequestSize(input: unknown): void {
  if (readToolRequestChars(input) > PROVIDER_LIMITS.maxRequestChars) {
    throw new HarnessError('request_limit', 'The request is over the request limit');
  }
}

function boundedText(value: unknown, label: string, max: number = PROVIDER_LIMITS.maxOutputChars): string {
  const text = requireString(value, label);
  if (text.length > max) {
    throw new HarnessError('output_limit', `${label} is longer than the output limit`);
  }
  return text;
}

function stringList(value: unknown, label: string, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new HarnessError('invalid_shape', `${label} must be a list of at most ${maxItems}`);
  }
  return value.map((item) => boundedText(item, label, maxChars));
}

// ---------------------------------------------------------------------------
// review.generateQuestion: one recall question for one chunk.

export type ReviewQuestionInput = {
  roomId: string;
  chunk: { id: string; roomId: string; text: string };
};

export type ReviewQuestionOutput = {
  chunkId: string;
  question: string;
  /** What a good recall covers. Shown only after the person reveals it. */
  answer: string;
};

export function parseReviewQuestionInput(value: unknown): ReviewQuestionInput {
  if (!isRecord(value)) throw new HarnessError('invalid_shape', 'Tool input must be an object');
  exactKeys(value, ['roomId', 'chunk']);
  const roomId = requireString(value.roomId, 'roomId');
  const chunk = value.chunk;
  if (!isRecord(chunk)) throw new HarnessError('invalid_shape', 'chunk must be an object');
  exactKeys(chunk, ['id', 'roomId', 'text']);
  const parsed = {
    roomId,
    chunk: {
      id: requireString(chunk.id, 'chunk id'),
      roomId: requireString(chunk.roomId, 'chunk room'),
      text: requireString(chunk.text, 'chunk text'),
    },
  };
  if (parsed.chunk.roomId !== roomId) throw new HarnessError('scope_rejected', 'The chunk is outside the room');
  assertRequestSize(parsed);
  return parsed;
}

export function parseReviewQuestionOutput(value: unknown, input?: ReviewQuestionInput): ReviewQuestionOutput {
  if (!isRecord(value)) throw new HarnessError('invalid_shape', 'Tool output must be an object');
  exactKeys(value, ['chunkId', 'question', 'answer']);
  const output = {
    chunkId: requireString(value.chunkId, 'chunkId'),
    question: boundedText(value.question, 'question', 600),
    answer: boundedText(value.answer, 'answer'),
  };
  if (input && output.chunkId !== input.chunk.id) {
    throw new HarnessError('scope_rejected', 'The question is about a different chunk');
  }
  return output;
}

export function mockReviewQuestionOutput(input: ReviewQuestionInput): ReviewQuestionOutput {
  const text = input.chunk.text.trim();
  return {
    chunkId: input.chunk.id,
    question: 'What should you remember from this note?',
    answer: text.slice(0, PROVIDER_LIMITS.maxOutputChars),
  };
}

// ---------------------------------------------------------------------------
// board.proposeStickies: answer a question about selected board items and
// suggest sticky notes. Nothing is on the board until the person accepts.

export type BoardItemView = { id: string; kind: 'shape' | 'sticky' | 'label' | 'stroke'; text: string };

export type BoardStickiesInput = {
  roomId: string;
  prompt: string;
  items: readonly BoardItemView[];
};

export type BoardStickiesOutput = {
  summary: string;
  stickies: { text: string }[];
};

const BOARD_KINDS = ['shape', 'sticky', 'label', 'stroke'] as const;
export const MAX_BOARD_STICKIES = 6;

export function parseBoardStickiesInput(value: unknown): BoardStickiesInput {
  if (!isRecord(value)) throw new HarnessError('invalid_shape', 'Tool input must be an object');
  exactKeys(value, ['roomId', 'prompt', 'items']);
  if (!Array.isArray(value.items) || value.items.length === 0) {
    throw new HarnessError('invalid_shape', 'Select at least one board item');
  }
  const items = value.items.map((item) => {
    if (!isRecord(item)) throw new HarnessError('invalid_shape', 'Each board item must be an object');
    exactKeys(item, ['id', 'kind', 'text']);
    const kind = item.kind;
    if (!BOARD_KINDS.some((allowed) => allowed === kind)) {
      throw new HarnessError('invalid_shape', 'A board item kind is invalid');
    }
    if (typeof item.text !== 'string') throw new HarnessError('invalid_shape', 'A board item text must be a string');
    return { id: requireString(item.id, 'item id'), kind: kind as BoardItemView['kind'], text: item.text };
  });
  const parsed = { roomId: requireString(value.roomId, 'roomId'), prompt: requireString(value.prompt, 'prompt'), items };
  assertRequestSize(parsed);
  return parsed;
}

export function parseBoardStickiesOutput(value: unknown): BoardStickiesOutput {
  if (!isRecord(value)) throw new HarnessError('invalid_shape', 'Tool output must be an object');
  exactKeys(value, ['summary', 'stickies']);
  if (!Array.isArray(value.stickies) || value.stickies.length > MAX_BOARD_STICKIES) {
    throw new HarnessError('invalid_shape', `stickies must be a list of at most ${MAX_BOARD_STICKIES}`);
  }
  return {
    summary: boundedText(value.summary, 'summary', 800),
    stickies: value.stickies.map((sticky) => {
      if (!isRecord(sticky)) throw new HarnessError('invalid_shape', 'Each sticky must be an object');
      exactKeys(sticky, ['text']);
      return { text: boundedText(sticky.text, 'sticky text', 160) };
    }),
  };
}

export function mockBoardStickiesOutput(input: BoardStickiesInput): BoardStickiesOutput {
  const named = input.items.map((item) => item.text.trim()).filter(Boolean);
  return {
    summary: `Mock board answer (${input.items.length} items): ${input.prompt.trim()}`.slice(0, 800),
    stickies: [{ text: `Mock sticky: ${named[0] ?? input.prompt.trim()}`.slice(0, 160) }],
  };
}

// ---------------------------------------------------------------------------
// import.suggestRooms: suggest a room and subjects per imported note. The
// import screen shows each suggestion; the person still picks the mapping.

export type ImportNoteView = { id: string; title: string; text: string };
export type ImportRoomView = { id: string; name: string };

export type ImportSuggestInput = {
  notes: readonly ImportNoteView[];
  rooms: readonly ImportRoomView[];
};

export type ImportSuggestion = {
  noteId: string;
  /** An existing room id from the input, or null to suggest a new room. */
  roomId: string | null;
  /** Set only when roomId is null. */
  newRoomName: string | null;
  subjects: string[];
};

export type ImportSuggestOutput = { suggestions: ImportSuggestion[] };

/** Per-note excerpt the app sends. Longer notes are cut before the request. */
export const IMPORT_EXCERPT_CHARS = 500;
export const MAX_IMPORT_NOTES = 12;

export function parseImportSuggestInput(value: unknown): ImportSuggestInput {
  if (!isRecord(value)) throw new HarnessError('invalid_shape', 'Tool input must be an object');
  exactKeys(value, ['notes', 'rooms']);
  if (!Array.isArray(value.notes) || value.notes.length === 0 || value.notes.length > MAX_IMPORT_NOTES) {
    throw new HarnessError('invalid_shape', `Send between 1 and ${MAX_IMPORT_NOTES} notes`);
  }
  if (!Array.isArray(value.rooms)) throw new HarnessError('invalid_shape', 'rooms must be a list');
  const notes = value.notes.map((note) => {
    if (!isRecord(note)) throw new HarnessError('invalid_shape', 'Each note must be an object');
    exactKeys(note, ['id', 'title', 'text']);
    if (typeof note.title !== 'string' || typeof note.text !== 'string') {
      throw new HarnessError('invalid_shape', 'A note title and text must be strings');
    }
    if (note.text.length > IMPORT_EXCERPT_CHARS) {
      throw new HarnessError('request_limit', 'A note excerpt is longer than the import excerpt limit');
    }
    return { id: requireString(note.id, 'note id'), title: note.title, text: note.text };
  });
  const rooms = value.rooms.map((room) => {
    if (!isRecord(room)) throw new HarnessError('invalid_shape', 'Each room must be an object');
    exactKeys(room, ['id', 'name']);
    return { id: requireString(room.id, 'room id'), name: requireString(room.name, 'room name') };
  });
  const parsed = { notes, rooms };
  assertRequestSize(parsed);
  return parsed;
}

export function parseImportSuggestOutput(value: unknown, input?: ImportSuggestInput): ImportSuggestOutput {
  if (!isRecord(value)) throw new HarnessError('invalid_shape', 'Tool output must be an object');
  exactKeys(value, ['suggestions']);
  if (!Array.isArray(value.suggestions) || value.suggestions.length > MAX_IMPORT_NOTES) {
    throw new HarnessError('invalid_shape', 'suggestions must be a list');
  }
  const noteIds = input ? new Set(input.notes.map((note) => note.id)) : null;
  const roomIds = input ? new Set(input.rooms.map((room) => room.id)) : null;
  const suggestions = value.suggestions.map((entry) => {
    if (!isRecord(entry)) throw new HarnessError('invalid_shape', 'Each suggestion must be an object');
    exactKeys(entry, ['noteId', 'roomId', 'newRoomName', 'subjects']);
    const noteId = requireString(entry.noteId, 'noteId');
    if (noteIds && !noteIds.has(noteId)) throw new HarnessError('scope_rejected', 'A suggestion names an unknown note');
    const roomId = entry.roomId === null ? null : requireString(entry.roomId, 'roomId');
    if (roomId !== null && roomIds && !roomIds.has(roomId)) {
      throw new HarnessError('scope_rejected', 'A suggestion names an unknown room');
    }
    const newRoomName = entry.newRoomName === null ? null : boundedText(entry.newRoomName, 'newRoomName', 80);
    if ((roomId === null) === (newRoomName === null)) {
      throw new HarnessError('invalid_shape', 'A suggestion needs exactly one of roomId or newRoomName');
    }
    return { noteId, roomId, newRoomName, subjects: stringList(entry.subjects, 'subjects', 6, 40) };
  });
  return { suggestions };
}

export function mockImportSuggestOutput(input: ImportSuggestInput): ImportSuggestOutput {
  return {
    suggestions: input.notes.map((note) => {
      const haystack = `${note.title}\n${note.text}`.toLowerCase();
      const room = input.rooms.find((candidate) => haystack.includes(candidate.name.toLowerCase()));
      return room
        ? { noteId: note.id, roomId: room.id, newRoomName: null, subjects: [] }
        : { noteId: note.id, roomId: null, newRoomName: 'Imported notes', subjects: [] };
    }),
  };
}

// ---------------------------------------------------------------------------

export function parseReadToolInput(tool: ReadToolName, value: unknown): unknown {
  switch (tool) {
    case REVIEW_TOOL_NAME:
      return parseReviewQuestionInput(value);
    case BOARD_TOOL_NAME:
      return parseBoardStickiesInput(value);
    case IMPORT_TOOL_NAME:
      return parseImportSuggestInput(value);
  }
}

/** Parse a provider's raw output. Pass the parsed input to also check scope. */
export function parseReadToolOutput(tool: ReadToolName, value: unknown, input?: unknown): unknown {
  switch (tool) {
    case REVIEW_TOOL_NAME:
      return parseReviewQuestionOutput(value, input as ReviewQuestionInput | undefined);
    case BOARD_TOOL_NAME:
      return parseBoardStickiesOutput(value);
    case IMPORT_TOOL_NAME:
      return parseImportSuggestOutput(value, input as ImportSuggestInput | undefined);
  }
}

export function mockReadToolOutput(tool: ReadToolName, input: unknown): unknown {
  switch (tool) {
    case REVIEW_TOOL_NAME:
      return mockReviewQuestionOutput(input as ReviewQuestionInput);
    case BOARD_TOOL_NAME:
      return mockBoardStickiesOutput(input as BoardStickiesInput);
    case IMPORT_TOOL_NAME:
      return mockImportSuggestOutput(input as ImportSuggestInput);
  }
}

// ---------------------------------------------------------------------------
// Companion status, served by GET /v1/status (token required, no secrets).

/** Another vendor is a new member here plus a provider in companion/providers/. */
export type ProviderKind = 'mock' | 'anthropic' | 'openai' | 'xai';

export type CompanionStatus = {
  provider: ProviderKind;
  /** Model id the companion sends, or null for the mock. */
  model: string | null;
  /** True when answers come from a live model. Scenario chips are mock-only. */
  live: boolean;
  tools: string[];
};

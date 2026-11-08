// App-owned harness contract. This file does not write Room, chunk, or annotation rows.
// Foundation owns that schema. A confirmed pin is an Operation passed to createCommit.
// FoundationAnnotationRequest is the assessed proposal. The gate payload is built
// from it at confirm time. Older demo pins stay in the harness file.
import type {
  GeneratedCard,
  GeneratedQuestion,
  GeneratedSlide,
  StudyDeckDraft,
  StudyDifficulty,
  StudyQuizDraft,
  StudySlideOutlineDraft,
} from '../features/study/generator.ts';
import { LIMITS } from '../data/operations.ts';

export type {
  StudyDeckDraft,
  StudyDifficulty,
  StudyQuizDraft,
  StudySlideOutlineDraft,
} from '../features/study/generator.ts';

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

/**
 * STUDY.5 (#135) tools. The mock provider runs these by calling the STUDY.2
 * generator; the live companion providers never see them (they are not in
 * ALLOWED_TOOL_NAMES) and the api-key stub stays disabled.
 */
export const STUDY_DECK_TOOL_NAME = 'study.proposeDeck' as const;

export const STUDY_QUIZ_TOOL_NAME = 'study.proposeQuiz' as const;

export const STUDY_OUTLINE_TOOL_NAME = 'study.proposeOutline' as const;

export const STUDY_TOOL_NAMES = [STUDY_DECK_TOOL_NAME, STUDY_QUIZ_TOOL_NAME, STUDY_OUTLINE_TOOL_NAME] as const;

export type StudyToolName = (typeof STUDY_TOOL_NAMES)[number];

export type StudyKind = 'deck' | 'quiz' | 'outline';

export function isStudyToolName(name: unknown): name is StudyToolName {
  return typeof name === 'string' && (STUDY_TOOL_NAMES as readonly string[]).includes(name);
}

export function studyToolFor(kind: StudyKind): StudyToolName {
  switch (kind) {
    case 'deck':
      return STUDY_DECK_TOOL_NAME;
    case 'quiz':
      return STUDY_QUIZ_TOOL_NAME;
    case 'outline':
      return STUDY_OUTLINE_TOOL_NAME;
  }
}

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

export type StoredProposal = AnnotationProposal | EditProposal | StudyDeckProposal | StudyQuizProposal | StudyOutlineProposal;

export function isEditProposal(proposal: StoredProposal): proposal is EditProposal {
  return proposal.tool === EDIT_TOOL_NAME;
}

export function isAnnotationProposal(proposal: StoredProposal): proposal is AnnotationProposal {
  return proposal.tool === TOOL_NAME;
}

/** One study draft grounded on whole chunks. Per-item provenance mirrors the generator draft. */
type StudyProposalBase = {
  id: string;
  roomId: string;
  title: string;
  sourceChunkIds: string[];
  /** Revision of every source chunk at propose time; the confirm gate compares these. */
  chunkRevisions: Record<string, number>;
  /** Max snapshot; equals the generator draft sourceRevision. */
  sourceRevision: number;
};

export type StudyDeckProposal = StudyProposalBase & {
  tool: typeof STUDY_DECK_TOOL_NAME;
  type: 'study_deck';
  cards: GeneratedCard[];
};

export type StudyQuizProposal = StudyProposalBase & {
  tool: typeof STUDY_QUIZ_TOOL_NAME;
  type: 'study_quiz';
  questions: GeneratedQuestion[];
};

export type StudyOutlineProposal = StudyProposalBase & {
  tool: typeof STUDY_OUTLINE_TOOL_NAME;
  type: 'study_outline';
  slides: GeneratedSlide[];
};

export type StudyProposal = StudyDeckProposal | StudyQuizProposal | StudyOutlineProposal;

export function isStudyProposal(proposal: StoredProposal): proposal is StudyProposal {
  return isStudyToolName(proposal.tool);
}

export function isStudyDeckProposal(proposal: StoredProposal): proposal is StudyDeckProposal {
  return proposal.tool === STUDY_DECK_TOOL_NAME;
}

export function isStudyQuizProposal(proposal: StoredProposal): proposal is StudyQuizProposal {
  return proposal.tool === STUDY_QUIZ_TOOL_NAME;
}

export function isStudyOutlineProposal(proposal: StoredProposal): proposal is StudyOutlineProposal {
  return proposal.tool === STUDY_OUTLINE_TOOL_NAME;
}

/** One-line summary stored as the assistant message; study drafts have no single body. */
export function proposalMessageBody(proposal: StoredProposal): string {
  switch (proposal.type) {
    case 'ai_answer':
    case 'chunk_edit':
      return proposal.body;
    case 'study_deck':
      return `Study deck proposal: ${proposal.title} (${proposal.cards.length} cards)`;
    case 'study_quiz':
      return `Study quiz proposal: ${proposal.title} (${proposal.questions.length} questions)`;
    case 'study_outline':
      return `Study outline proposal: ${proposal.title} (${proposal.slides.length} slides)`;
  }
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
} as const;

// ---------------------------------------------------------------------------
// STUDY.5 (#135) propose/confirm seam. The mock provider calls the STUDY.2
// generator and these parses validate the draft before it reaches the
// session row, so a draft that could not commit never becomes a proposal.

/**
 * Serialized cap for one study draft in the session row. The generator bounds
 * its input at 1MiB and each text field at LIMITS.studyText, so a bounded
 * draft stays near the input size; anything far above it is not a generator
 * draft.
 */
export const STUDY_DRAFT_MAX_CHARS = 2 * 1024 * 1024;

export type StudyChunkInput = {
  id: string;
  roomId: string;
  text: string;
  revision: number;
};

export type StudyProposeOptions = {
  title?: string;
  difficulty?: StudyDifficulty;
};

export type StudyProposeInput = {
  roomId: string;
  prompt: string;
  chunks: readonly StudyChunkInput[];
  priorMessages: readonly PriorMessage[];
  options?: StudyProposeOptions;
};

function parseStudyChunk(value: unknown, index: number): StudyChunkInput {
  if (!isRecord(value)) {
    throw new HarnessError('invalid_shape', `Study chunk ${index + 1} must be an object`);
  }
  exactKeys(value, ['id', 'roomId', 'text', 'revision']);
  const revision = requireInteger(value.revision, 'chunk revision');
  if (revision < 1) {
    throw new HarnessError('invalid_shape', `Study chunk ${index + 1} is missing its revision`);
  }
  return {
    id: requireString(value.id, 'chunk id'),
    roomId: requireString(value.roomId, 'chunk room'),
    text: requireString(value.text, 'chunk text'),
    revision,
  };
}

function parseStudyOptions(value: unknown): StudyProposeOptions {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new HarnessError('invalid_shape', 'Study options must be an object');
  }
  for (const key of Object.keys(value)) {
    if (key !== 'title' && key !== 'difficulty') {
      throw new HarnessError('invalid_shape', 'The study options have an unexpected field');
    }
  }
  const options: StudyProposeOptions = {};
  if (value.title !== undefined) {
    options.title = requireString(value.title, 'study title');
  }
  if (value.difficulty !== undefined) {
    if (typeof value.difficulty !== 'string') {
      throw new HarnessError('invalid_shape', 'Study difficulty must be text');
    }
    options.difficulty = value.difficulty as StudyDifficulty;
  }
  return options;
}

export function parseStudyProposeInput(value: unknown): StudyProposeInput {
  if (!isRecord(value)) {
    throw new HarnessError('invalid_shape', 'Tool input must be an object');
  }
  const { options, ...rest } = value;
  exactKeys(rest, ['roomId', 'prompt', 'chunks', 'priorMessages']);
  const roomId = requireString(value.roomId, 'roomId');
  const prompt = requireString(value.prompt, 'prompt');
  if (!Array.isArray(value.chunks) || value.chunks.length === 0) {
    throw new HarnessError('invalid_shape', 'Select at least one chunk in this room');
  }
  if (!Array.isArray(value.priorMessages)) {
    throw new HarnessError('invalid_shape', 'priorMessages must be a list');
  }
  const chunks = value.chunks.map((chunk, index) => parseStudyChunk(chunk, index));
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
  // The corpus follows the generator bounds (200 chunks / 1MiB); the
  // conversational part stays inside the shared request budget.
  const conversationChars = prompt.length + priorMessages.reduce((sum, message) => sum + message.body.length, 0);
  if (conversationChars > PROVIDER_LIMITS.maxRequestChars) {
    throw new HarnessError('request_limit', 'The study prompt and history are over the request limit');
  }
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
  return { roomId, prompt, chunks, priorMessages, options: parseStudyOptions(options) };
}

function draftSourceIds(value: unknown, label: string): { roomId: string; sourceChunkIds: string[]; sourceRevision: number } {
  if (!isRecord(value)) {
    throw new HarnessError('invalid_shape', 'Tool output must be an object');
  }
  const roomId = requireString(value.roomId, 'roomId');
  if (!Array.isArray(value.sourceChunkIds) || value.sourceChunkIds.length === 0) {
    throw new HarnessError('invalid_shape', `${label} needs at least one source chunk`);
  }
  const sourceChunkIds = value.sourceChunkIds.map((id) => requireString(id, 'source chunk id'));
  if (new Set(sourceChunkIds).size !== sourceChunkIds.length) {
    throw new HarnessError('invalid_shape', `${label} lists a source chunk twice`);
  }
  const sourceRevision = requireInteger(value.sourceRevision, 'sourceRevision');
  if (sourceRevision < 1) {
    throw new HarnessError('invalid_shape', `${label} is missing its source revision`);
  }
  return { roomId, sourceChunkIds, sourceRevision };
}

function studyText(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (text.length > LIMITS.studyText) {
    throw new HarnessError('output_limit', `${label} is longer than the study text limit`);
  }
  return text;
}

function studyDifficulty(value: unknown, label: string): StudyDifficulty {
  if (value !== 'easy' && value !== 'medium' && value !== 'hard') {
    throw new HarnessError('invalid_shape', `${label} has an unknown difficulty`);
  }
  return value;
}

/** A draft that could not commit is not a proposal. Caps mirror the commit boundary. */
function assertDraftSize(value: unknown, label: string): void {
  if (JSON.stringify(value).length > STUDY_DRAFT_MAX_CHARS) {
    throw new HarnessError('output_limit', `${label} is larger than the study proposal limit`);
  }
}

function parseStudyCard(value: unknown, index: number): GeneratedCard {
  if (!isRecord(value)) {
    throw new HarnessError('invalid_shape', `Study card ${index + 1} must be an object`);
  }
  exactKeys(value, ['front', 'back', 'position', 'difficulty', 'sourceChunkIds', 'sourceRevision']);
  const position = requireInteger(value.position, 'card position');
  if (position < 0) {
    throw new HarnessError('invalid_shape', `Study card ${index + 1} has a negative position`);
  }
  if (!Array.isArray(value.sourceChunkIds)) {
    throw new HarnessError('invalid_shape', `Study card ${index + 1} needs source chunks`);
  }
  return {
    front: studyText(value.front, `study card ${index + 1} front`),
    back: studyText(value.back, `study card ${index + 1} back`),
    position,
    difficulty: studyDifficulty(value.difficulty, `study card ${index + 1}`),
    sourceChunkIds: value.sourceChunkIds.map((id) => requireString(id, 'card source chunk id')),
    sourceRevision: requireInteger(value.sourceRevision, 'card sourceRevision'),
  };
}

export function parseStudyDeckOutput(value: unknown): StudyDeckDraft {
  if (!isRecord(value)) {
    throw new HarnessError('invalid_shape', 'Tool output must be an object');
  }
  exactKeys(value, ['roomId', 'title', 'sourceChunkIds', 'sourceRevision', 'cards']);
  assertDraftSize(value, 'The study deck draft');
  const sources = draftSourceIds(value, 'The study deck draft');
  if (!Array.isArray(value.cards) || value.cards.length === 0) {
    throw new HarnessError('invalid_shape', 'The study deck draft has no cards');
  }
  const title = requireString(value.title, 'deck title');
  if (title.length > LIMITS.studyTitle) {
    throw new HarnessError('output_limit', 'The deck title is longer than the study title limit');
  }
  return { ...sources, title, cards: value.cards.map((card, index) => parseStudyCard(card, index)) };
}

function parseStudyQuestion(value: unknown, index: number): GeneratedQuestion {
  if (!isRecord(value)) {
    throw new HarnessError('invalid_shape', `Study question ${index + 1} must be an object`);
  }
  exactKeys(value, ['kind', 'stem', 'choices', 'answer', 'explanation', 'position', 'difficulty', 'sourceChunkIds', 'sourceRevision']);
  const kind = value.kind;
  if (kind !== 'mcq' && kind !== 'true_false' && kind !== 'fill') {
    throw new HarnessError('invalid_shape', `Study question ${index + 1} has an unknown kind`);
  }
  if (!Array.isArray(value.choices)) {
    throw new HarnessError('invalid_shape', `Study question ${index + 1} needs a choices list`);
  }
  if (kind === 'mcq') {
    if (value.choices.length < 2 || value.choices.length > LIMITS.studyChoices) {
      throw new HarnessError('invalid_shape', `Study question ${index + 1} needs 2 to ${LIMITS.studyChoices} choices`);
    }
  } else if (value.choices.length !== 0) {
    throw new HarnessError('invalid_shape', `Study question ${index + 1} takes no choices`);
  }
  const choices = value.choices.map((choice) => {
    const text = requireString(choice, `study question ${index + 1} choice`);
    if (text.length > LIMITS.studyChoice) {
      throw new HarnessError('output_limit', `Study question ${index + 1} choice is too long`);
    }
    return text;
  });
  const answer = requireString(value.answer, `study question ${index + 1} answer`);
  if (answer.length > LIMITS.studyChoice) {
    throw new HarnessError('output_limit', `Study question ${index + 1} answer is too long`);
  }
  const position = requireInteger(value.position, 'question position');
  if (position < 0) {
    throw new HarnessError('invalid_shape', `Study question ${index + 1} has a negative position`);
  }
  if (!Array.isArray(value.sourceChunkIds)) {
    throw new HarnessError('invalid_shape', `Study question ${index + 1} needs source chunks`);
  }
  return {
    kind,
    stem: studyText(value.stem, `study question ${index + 1} stem`),
    choices,
    answer,
    explanation: value.explanation === undefined ? '' : studyText(value.explanation, `study question ${index + 1} explanation`),
    position,
    difficulty: studyDifficulty(value.difficulty, `study question ${index + 1}`),
    sourceChunkIds: value.sourceChunkIds.map((id) => requireString(id, 'question source chunk id')),
    sourceRevision: requireInteger(value.sourceRevision, 'question sourceRevision'),
  };
}

export function parseStudyQuizOutput(value: unknown): StudyQuizDraft {
  if (!isRecord(value)) {
    throw new HarnessError('invalid_shape', 'Tool output must be an object');
  }
  exactKeys(value, ['roomId', 'title', 'sourceChunkIds', 'sourceRevision', 'questions']);
  assertDraftSize(value, 'The study quiz draft');
  const sources = draftSourceIds(value, 'The study quiz draft');
  if (!Array.isArray(value.questions) || value.questions.length === 0) {
    throw new HarnessError('invalid_shape', 'The study quiz draft has no questions');
  }
  const title = requireString(value.title, 'quiz title');
  if (title.length > LIMITS.studyTitle) {
    throw new HarnessError('output_limit', 'The quiz title is longer than the study title limit');
  }
  return { ...sources, title, questions: value.questions.map((question, index) => parseStudyQuestion(question, index)) };
}

function parseStudySlide(value: unknown, index: number): GeneratedSlide {
  if (!isRecord(value)) {
    throw new HarnessError('invalid_shape', `Study slide ${index + 1} must be an object`);
  }
  exactKeys(value, ['title', 'bullets', 'notes', 'difficulty', 'sourceChunkIds', 'sourceRevision']);
  const title = requireString(value.title, `study slide ${index + 1} title`);
  if (title.length > LIMITS.studyTitle) {
    throw new HarnessError('output_limit', `Study slide ${index + 1} title is too long`);
  }
  if (!Array.isArray(value.bullets) || value.bullets.length === 0 || value.bullets.length > LIMITS.studyBullets) {
    throw new HarnessError('invalid_shape', `Study slide ${index + 1} needs 1 to ${LIMITS.studyBullets} bullets`);
  }
  const bullets = value.bullets.map((bullet) => {
    const text = requireString(bullet, `study slide ${index + 1} bullet`);
    if (text.length > LIMITS.studyBullet) {
      throw new HarnessError('output_limit', `Study slide ${index + 1} bullet is too long`);
    }
    return text;
  });
  if (!Array.isArray(value.sourceChunkIds)) {
    throw new HarnessError('invalid_shape', `Study slide ${index + 1} needs source chunks`);
  }
  return {
    title,
    bullets,
    notes: studyText(value.notes, `study slide ${index + 1} notes`),
    difficulty: studyDifficulty(value.difficulty, `study slide ${index + 1}`),
    sourceChunkIds: value.sourceChunkIds.map((id) => requireString(id, 'slide source chunk id')),
    sourceRevision: requireInteger(value.sourceRevision, 'slide sourceRevision'),
  };
}

export function parseStudyOutlineOutput(value: unknown): StudySlideOutlineDraft {
  if (!isRecord(value)) {
    throw new HarnessError('invalid_shape', 'Tool output must be an object');
  }
  exactKeys(value, ['roomId', 'title', 'sourceChunkIds', 'sourceRevision', 'slides']);
  assertDraftSize(value, 'The study outline draft');
  const sources = draftSourceIds(value, 'The study outline draft');
  if (!Array.isArray(value.slides) || value.slides.length === 0) {
    throw new HarnessError('invalid_shape', 'The study outline draft has no slides');
  }
  // The commit boundary saves at most LIMITS.studySlides slides in one
  // outline; a larger selection must be split before it becomes a proposal.
  if (value.slides.length > LIMITS.studySlides) {
    throw new HarnessError('output_limit', 'The study outline draft has more slides than one outline can save');
  }
  const title = requireString(value.title, 'outline title');
  if (title.length > LIMITS.studyTitle) {
    throw new HarnessError('output_limit', 'The outline title is longer than the study title limit');
  }
  return { ...sources, title, slides: value.slides.map((slide, index) => parseStudySlide(slide, index)) };
}

/** Parse a provider's raw study output. Pass the tool so the shape is checked. */
export function parseStudyDraft(
  tool: StudyToolName,
  value: unknown,
): StudyDeckDraft | StudyQuizDraft | StudySlideOutlineDraft {
  switch (tool) {
    case STUDY_DECK_TOOL_NAME:
      return parseStudyDeckOutput(value);
    case STUDY_QUIZ_TOOL_NAME:
      return parseStudyQuizOutput(value);
    case STUDY_OUTLINE_TOOL_NAME:
      return parseStudyOutlineOutput(value);
  }
}

export const STUDY_TOOL_REGISTRY = {
  [STUDY_DECK_TOOL_NAME]: {
    name: STUDY_DECK_TOOL_NAME,
    parseInput: parseStudyProposeInput,
    parseOutput: parseStudyDeckOutput,
  },
  [STUDY_QUIZ_TOOL_NAME]: {
    name: STUDY_QUIZ_TOOL_NAME,
    parseInput: parseStudyProposeInput,
    parseOutput: parseStudyQuizOutput,
  },
  [STUDY_OUTLINE_TOOL_NAME]: {
    name: STUDY_OUTLINE_TOOL_NAME,
    parseInput: parseStudyProposeInput,
    parseOutput: parseStudyOutlineOutput,
  },
} as const;

const STUDY_TOOLS = [...STUDY_TOOL_NAMES].sort();

export function assertStudyRegistry(): void {
  const names = Object.keys(STUDY_TOOL_REGISTRY).sort();
  if (names.length !== STUDY_TOOLS.length || names.some((name, index) => name !== STUDY_TOOLS[index])) {
    throw new HarnessError('invalid_shape', 'The study tool registry is no longer the study-only set');
  }
}

const NOTE_TOOLS = [TOOL_NAME, EDIT_TOOL_NAME].sort();

/**
 * Every tool name the companion may run: the two note proposals plus the
 * read-only suggestion tools in tools.ts. There is still no shell, file, or
 * plugin tool. Keep this list literal so a new tool is a reviewed change.
 */
export const ALLOWED_TOOL_NAMES = [
  TOOL_NAME,
  EDIT_TOOL_NAME,
  'review.generateQuestion',
  'board.proposeStickies',
  'import.suggestRooms',
] as const;

export function assertRegistryIsNotesOnly(): void {
  const names = Object.keys(TOOL_REGISTRY).sort();
  if (names.length !== NOTE_TOOLS.length || names.some((name, index) => name !== NOTE_TOOLS[index])) {
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

/**
 * STUDY.2 (#131): deterministic mock study generator.
 *
 * Pure functions only: no DB, no network, no clock, no randomness. The same
 * input chunks always produce byte-identical output, so the library UI track
 * (STUDY.3 #132) and the harness track (STUDY.5 #135) can preview, propose,
 * and retry without touching storage. Nothing here writes rows; callers
 * persist through the FND.2 `study.*` ops, whose shapes the drafts below
 * mirror field for field (see `src/data/operations.ts` and the STUDY.1
 * validation in `src/data/commit.ts`).
 *
 * Shape contract (fixed, per issue scope):
 * - `generateDeck` returns one deck draft plus one overview card first and
 *   then exactly one card per chunk, in chunk-id order.
 * - `generateQuiz` returns one quiz draft plus one overview MCQ first and
 *   then exactly one question per chunk, cycling `mcq` / `true_false` /
 *   `fill` by chunk index.
 * - `generateSlideOutline` returns one outline draft plus one overview slide
 *   first and then exactly one slide per chunk, in chunk-id order.
 * Every draft, card, question, and slide carries its own `sourceChunkIds`
 * plus the `sourceRevision` snapshot (the maximum chunk revision seen), so a
 * later source edit can be flagged stale on read without rewriting history.
 *
 * `difficulty` is a caller hint that passes straight through onto every
 * generated item and into each explanation; it never changes which items are
 * produced. `scenario` selects the mock provider outcome so callers can
 * exercise typed error paths (`timeout`, `provider_error`, `oversize`).
 */

import type { StudyQuestionKind } from '../../db/schema.ts';

export const STUDY_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export type StudyDifficulty = (typeof STUDY_DIFFICULTIES)[number];

export const STUDY_MOCK_SCENARIOS = ['success', 'timeout', 'error', 'oversize'] as const;

export type StudyMockScenario = (typeof STUDY_MOCK_SCENARIOS)[number];

/** Fail-closed input bounds: more than this is rejected with no output. */
export const GENERATOR_LIMITS = {
  /** Mirrors the commit `bodiesPerOp` bound so one selection stays committable. */
  maxChunks: 200,
  /** Total UTF-8 bytes across all chunk bodies. */
  maxInputBytes: 1024 * 1024,
  /** Fixed MCQ shape: the answer plus three distractors. */
  choicesPerMcq: 4,
  /** Sentence bullets derived from one chunk body. */
  bulletsPerSlide: 3,
  /** Sentence bullets on the overview slide (plus one `+ N more` line). */
  overviewBullets: 11,
} as const;

const TITLE_LIMIT = 120;
const LONG_TEXT_LIMIT = 10_000;
const SHORT_TEXT_LIMIT = 500;
const SENTENCE_LIMIT = 280;
const ID_LIMIT = 64;

type StudySourceChunkBase = {
  id: string;
  roomId: string;
  revision: number;
  subjects?: readonly string[];
};

/**
 * One grounded note. Foundation chunks carry `body` (`src/data/models.ts`);
 * harness proposal chunks carry `text` (`src/harness/contract.ts`). Both are
 * accepted so STUDY.3 and STUDY.5 share this interface; when both are present
 * `body` wins. Anything else on the object is ignored.
 */
export type StudySourceChunk =
  | (StudySourceChunkBase & { body: string })
  | (StudySourceChunkBase & { text: string });

export type StudyGeneratorOptions = {
  /** Overrides `Study deck from N notes` style defaults. */
  title?: string;
  /** Passed through onto every generated item and explanation. */
  difficulty?: StudyDifficulty;
  /** Mock provider outcome; anything but `success` throws a typed error. */
  scenario?: StudyMockScenario;
};

export type GeneratedCard = {
  front: string;
  back: string;
  position: number;
  difficulty: StudyDifficulty;
  sourceChunkIds: string[];
  sourceRevision: number;
};

export type StudyDeckDraft = {
  roomId: string;
  title: string;
  sourceChunkIds: string[];
  sourceRevision: number;
  cards: GeneratedCard[];
};

export type GeneratedQuestion = {
  kind: StudyQuestionKind;
  stem: string;
  /** Required for `mcq` (always four); empty otherwise. */
  choices: string[];
  answer: string;
  explanation: string;
  position: number;
  difficulty: StudyDifficulty;
  sourceChunkIds: string[];
  sourceRevision: number;
};

export type StudyQuizDraft = {
  roomId: string;
  title: string;
  sourceChunkIds: string[];
  sourceRevision: number;
  questions: GeneratedQuestion[];
};

export type GeneratedSlide = {
  title: string;
  bullets: string[];
  notes: string;
  difficulty: StudyDifficulty;
  sourceChunkIds: string[];
  sourceRevision: number;
};

export type StudySlideOutlineDraft = {
  roomId: string;
  title: string;
  sourceChunkIds: string[];
  sourceRevision: number;
  slides: GeneratedSlide[];
};

export type StudyGeneratorErrorCode =
  | 'empty_selection'
  | 'scope_rejected'
  | 'too_many_chunks'
  | 'input_too_large'
  | 'invalid_chunk'
  | 'invalid_options'
  | 'timeout'
  | 'provider_error'
  | 'oversize';

export class StudyGeneratorError extends Error {
  readonly code: StudyGeneratorErrorCode;

  constructor(code: StudyGeneratorErrorCode, message: string) {
    super(message);
    this.name = 'StudyGeneratorError';
    this.code = code;
  }
}

function fail(code: StudyGeneratorErrorCode, message: string): never {
  throw new StudyGeneratorError(code, message);
}

type NormalizedChunk = {
  id: string;
  roomId: string;
  revision: number;
  body: string;
};

type NormalizedSelection = {
  roomId: string;
  sourceRevision: number;
  sourceChunkIds: string[];
  ordered: NormalizedChunk[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Code-point safe truncation; plain slicing can split a surrogate pair. */
function truncatePoints(value: string, max: number): string {
  const points = Array.from(value);
  return points.length > max ? points.slice(0, max).join('') : value;
}

function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function firstSentence(body: string): string {
  const line = body
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return truncatePoints(line ?? body.trim(), SENTENCE_LIMIT);
}

function splitSentences(body: string): string[] {
  const matches = body.match(/[^.!?…\r\n]+[.!?…]+|[^.!?…\r\n]+/g) ?? [];
  const parts = matches.map((part) => part.trim()).filter((part) => part.length > 0);
  const base = parts.length > 0 ? parts : [body.trim()];
  return base.filter((part) => part.length > 0).map((part) => truncatePoints(part, SENTENCE_LIMIT));
}

/** Longest word wins, earliest on ties; deterministic for any input. */
function keyTerm(body: string): string {
  const words = body.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) ?? [];
  let best = '';
  for (const word of words) {
    const clean = word.replace(/[-']+$/u, '');
    if (clean.length > best.length) {
      best = clean;
    }
  }
  return truncatePoints(best.length > 0 ? best : 'note', SHORT_TEXT_LIMIT);
}

function withPeriod(sentence: string): string {
  const stripped = sentence.replace(/[.!?…\s]+$/u, '');
  return `${stripped.length > 0 ? stripped : sentence}.`;
}

function fillStem(sentence: string, term: string): string {
  const index = sentence.indexOf(term);
  if (index >= 0) {
    return `${sentence.slice(0, index)}___${sentence.slice(index + term.length)}`;
  }
  return `${withPeriod(sentence)} ___`;
}

/** Answer plus sibling terms, padded with mock fillers to a fixed width. */
function mcqChoices(answer: string, siblings: readonly string[]): string[] {
  const seen = new Set([answer.toLowerCase()]);
  const distractors: string[] = [];
  for (const term of siblings) {
    const clean = truncatePoints(term, SHORT_TEXT_LIMIT);
    if (clean.length === 0 || seen.has(clean.toLowerCase())) {
      continue;
    }
    seen.add(clean.toLowerCase());
    distractors.push(clean);
    if (distractors.length >= GENERATOR_LIMITS.choicesPerMcq - 1) {
      break;
    }
  }
  let filler = 1;
  while (distractors.length < GENERATOR_LIMITS.choicesPerMcq - 1) {
    const candidate = `Mock alternative ${filler}`;
    filler += 1;
    if (seen.has(candidate.toLowerCase())) {
      continue;
    }
    seen.add(candidate.toLowerCase());
    distractors.push(candidate);
  }
  return [answer, ...distractors].sort(codeUnitCompare);
}

function explanationFor(chunkId: string, difficulty: StudyDifficulty, sentence: string): string {
  return truncatePoints(`Grounded on ${chunkId} (${difficulty}): ${sentence}`, LONG_TEXT_LIMIT);
}

function readOptions(options: StudyGeneratorOptions | undefined, label: string): {
  difficulty: StudyDifficulty;
  title: string;
} {
  const input: Record<string, unknown> =
    options === undefined ? {} : isRecord(options) ? options : fail('invalid_options', `${label}: options must be an object`);
  const difficulty = input.difficulty ?? 'medium';
  if (typeof difficulty !== 'string' || !(STUDY_DIFFICULTIES as readonly string[]).includes(difficulty)) {
    fail('invalid_options', `${label}: difficulty must be one of easy, medium, hard`);
  }
  const scenario = input.scenario ?? 'success';
  if (typeof scenario !== 'string' || !(STUDY_MOCK_SCENARIOS as readonly string[]).includes(scenario)) {
    fail('invalid_options', `${label}: scenario must be one of success, timeout, error, oversize`);
  }
  const rawTitle = input.title;
  if (rawTitle !== undefined) {
    if (typeof rawTitle !== 'string' || normalizeTitle(rawTitle).length === 0) {
      fail('invalid_options', `${label}: title must be non-empty text`);
    }
    if (normalizeTitle(rawTitle).length > TITLE_LIMIT) {
      fail('invalid_options', `${label}: title is longer than ${TITLE_LIMIT} characters`);
    }
  }
  return { difficulty: difficulty as StudyDifficulty, title: rawTitle === undefined ? '' : normalizeTitle(rawTitle) };
}

function readChunks(input: unknown, label: string): NormalizedSelection {
  if (!Array.isArray(input) || input.length === 0) {
    fail('empty_selection', `${label}: select at least one chunk in this room`);
  }
  const items: NormalizedChunk[] = (input as unknown[]).map((raw, index) => {
    const position = `chunk ${index + 1}`;
    if (!isRecord(raw)) {
      fail('invalid_chunk', `${label}: ${position} must be an object`);
    }
    const record = raw as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== 'string' || id.length === 0 || id.length > ID_LIMIT) {
      fail('invalid_chunk', `${label}: ${position} is missing its id`);
    }
    const roomId = record.roomId;
    if (typeof roomId !== 'string' || roomId.length === 0) {
      fail('invalid_chunk', `${label}: ${position} is missing its room`);
    }
    const revision = record.revision;
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) {
      fail('invalid_chunk', `${label}: ${position} is missing its revision`);
    }
    const text = record.body ?? record.text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      fail('invalid_chunk', `${label}: ${position} has no text to study`);
    }
    return { id: id as string, roomId: roomId as string, revision: revision as number, body: text as string };
  });
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      fail('invalid_chunk', `${label}: chunk ${item.id} was included twice`);
    }
    seen.add(item.id);
  }
  const roomId = items[0].roomId;
  for (const item of items) {
    if (item.roomId !== roomId) {
      fail('scope_rejected', `${label}: study materials come from a single room`);
    }
  }
  if (items.length > GENERATOR_LIMITS.maxChunks) {
    fail('too_many_chunks', `${label}: select at most ${GENERATOR_LIMITS.maxChunks} chunks`);
  }
  const encoder = new TextEncoder();
  const bytes = items.reduce((sum, item) => sum + encoder.encode(item.body).length, 0);
  if (bytes > GENERATOR_LIMITS.maxInputBytes) {
    fail('input_too_large', `${label}: the selected notes exceed the 1MiB input limit`);
  }
  const ordered = [...items].sort((left, right) => codeUnitCompare(left.id, right.id));
  return {
    roomId,
    sourceRevision: Math.max(...ordered.map((item) => item.revision)),
    sourceChunkIds: ordered.map((item) => item.id),
    ordered,
  };
}

function applyScenario(scenario: unknown, label: string): void {
  if (scenario === undefined || scenario === 'success') {
    return;
  }
  if (scenario === 'timeout') {
    fail('timeout', `${label}: the mock generator timed out before answering`);
  }
  if (scenario === 'error') {
    fail('provider_error', `${label}: the mock generator failed before answering`);
  }
  fail('oversize', `${label}: the mock output exceeded the output limit`);
}

/**
 * One deck draft: an overview card first, then one recall card per chunk.
 * Output is a pure function of the input chunks plus options.
 */
export function generateDeck(chunks: readonly StudySourceChunk[], options?: StudyGeneratorOptions): StudyDeckDraft {
  const label = 'generateDeck';
  const { difficulty, title } = readOptions(options, label);
  const selection = readChunks(chunks, label);
  applyScenario(options?.scenario, label);
  const count = selection.ordered.length;
  const sentences = selection.ordered.map((item) => firstSentence(item.body));
  const overviewBack = truncatePoints(
    sentences.map((sentence, index) => `${index + 1}. ${sentence}`).join('\n'),
    LONG_TEXT_LIMIT,
  );
  const cards: GeneratedCard[] = [
    {
      front: `What are the main ideas across ${count} note${count === 1 ? '' : 's'}?`,
      back: overviewBack,
      position: 0,
      difficulty,
      sourceChunkIds: [...selection.sourceChunkIds],
      sourceRevision: selection.sourceRevision,
    },
    ...selection.ordered.map((item, index) => ({
      front: `Recall: ${firstSentence(item.body)}`,
      back: truncatePoints(item.body, LONG_TEXT_LIMIT),
      position: index + 1,
      difficulty,
      sourceChunkIds: [item.id],
      sourceRevision: selection.sourceRevision,
    })),
  ];
  return {
    roomId: selection.roomId,
    title: title.length > 0 ? title : `Study deck from ${count} notes`,
    sourceChunkIds: [...selection.sourceChunkIds],
    sourceRevision: selection.sourceRevision,
    cards,
  };
}

const QUESTION_KINDS: readonly StudyQuestionKind[] = ['mcq', 'true_false', 'fill'];

/**
 * One quiz draft: an overview MCQ first, then one question per chunk cycling
 * through the fixed `mcq` / `true_false` / `fill` shapes by chunk index.
 */
export function generateQuiz(chunks: readonly StudySourceChunk[], options?: StudyGeneratorOptions): StudyQuizDraft {
  const label = 'generateQuiz';
  const { difficulty, title } = readOptions(options, label);
  const selection = readChunks(chunks, label);
  applyScenario(options?.scenario, label);
  const count = selection.ordered.length;
  const terms = selection.ordered.map((item) => keyTerm(item.body));
  const firstTerm = terms[0];
  if (firstTerm === undefined) {
    fail('provider_error', 'generateQuiz: the mock generator produced no terms');
  }
  const overviewAnswer = firstTerm;
  const overviewQuestion: GeneratedQuestion = {
    kind: 'mcq',
    stem: 'Which term appears in these notes?',
    choices: mcqChoices(overviewAnswer, terms.slice(1)),
    answer: overviewAnswer,
    explanation: truncatePoints(
      `Grounded on ${count} notes (${difficulty}): ${selection.ordered.map((item) => firstSentence(item.body)).join(' / ')}`,
      LONG_TEXT_LIMIT,
    ),
    position: 0,
    difficulty,
    sourceChunkIds: [...selection.sourceChunkIds],
    sourceRevision: selection.sourceRevision,
  };
  const questions: GeneratedQuestion[] = selection.ordered.map((item, index) => {
    const kind = QUESTION_KINDS[index % QUESTION_KINDS.length] as StudyQuestionKind;
    const sentence = firstSentence(item.body);
    const term = keyTerm(item.body);
    const siblings = terms.filter((_, other) => other !== index);
    if (kind === 'mcq') {
      return {
        kind,
        stem: `What is the key term in: "${sentence}"?`,
        choices: mcqChoices(term, siblings),
        answer: term,
        explanation: explanationFor(item.id, difficulty, sentence),
        position: index + 1,
        difficulty,
        sourceChunkIds: [item.id],
        sourceRevision: selection.sourceRevision,
      };
    }
    if (kind === 'true_false') {
      return {
        kind,
        stem: `True or false: ${withPeriod(sentence)}`,
        choices: [],
        answer: index % 2 === 0 ? 'true' : 'false',
        explanation: explanationFor(item.id, difficulty, sentence),
        position: index + 1,
        difficulty,
        sourceChunkIds: [item.id],
        sourceRevision: selection.sourceRevision,
      };
    }
    return {
      kind: 'fill',
      stem: `Complete the idea: ${fillStem(sentence, term)}`,
      choices: [],
      answer: term,
      explanation: explanationFor(item.id, difficulty, sentence),
      position: index + 1,
      difficulty,
      sourceChunkIds: [item.id],
      sourceRevision: selection.sourceRevision,
    };
  });
  return {
    roomId: selection.roomId,
    title: title.length > 0 ? title : `Study quiz from ${count} notes`,
    sourceChunkIds: [...selection.sourceChunkIds],
    sourceRevision: selection.sourceRevision,
    questions: [overviewQuestion, ...questions],
  };
}

/**
 * One slide outline draft: an overview slide first, then one slide per chunk.
 * Slide count is chunks + 1; selections above 49 chunks stay deterministic
 * here but the commit boundary caps outlines at 50 slides, so callers split
 * larger selections before saving.
 */
export function generateSlideOutline(
  chunks: readonly StudySourceChunk[],
  options?: StudyGeneratorOptions,
): StudySlideOutlineDraft {
  const label = 'generateSlideOutline';
  const { difficulty, title } = readOptions(options, label);
  const selection = readChunks(chunks, label);
  applyScenario(options?.scenario, label);
  const count = selection.ordered.length;
  const sentences = selection.ordered.map((item) => firstSentence(item.body));
  const overviewBullets = sentences.slice(0, GENERATOR_LIMITS.overviewBullets);
  if (count > GENERATOR_LIMITS.overviewBullets) {
    overviewBullets.push(`+ ${count - GENERATOR_LIMITS.overviewBullets} more notes in this outline`);
  }
  const slides: GeneratedSlide[] = [
    {
      title: 'Overview',
      bullets: overviewBullets,
      notes: `Present the key point of each of the ${count} notes.`,
      difficulty,
      sourceChunkIds: [...selection.sourceChunkIds],
      sourceRevision: selection.sourceRevision,
    },
    ...selection.ordered.map((item, index) => {
      const sentence = firstSentence(item.body);
      const bullets = splitSentences(item.body).slice(0, GENERATOR_LIMITS.bulletsPerSlide);
      return {
        title: truncatePoints(sentence, TITLE_LIMIT),
        bullets: bullets.length > 0 ? bullets : [sentence],
        notes: truncatePoints(`Say: ${sentence}`, LONG_TEXT_LIMIT),
        difficulty,
        sourceChunkIds: [item.id],
        sourceRevision: selection.sourceRevision,
      };
    }),
  ];
  return {
    roomId: selection.roomId,
    title: title.length > 0 ? title : `Slide outline from ${count} notes`,
    sourceChunkIds: [...selection.sourceChunkIds],
    sourceRevision: selection.sourceRevision,
    slides,
  };
}

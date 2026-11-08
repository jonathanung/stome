/**
 * Pure study-session helpers (STUDY.4 #134).
 *
 * No DB, no commits, no navigation here. The screen owns loading and
 * `review.mark` writes; these helpers only decide order, deterministic
 * fixtures, answer checking, and staleness.
 *
 * Until the STUDY.2 generator lands, the session UI falls back to
 * deterministic fixtures derived from chunk text so the same chunk always
 * shows the same mock card/question.
 */

import type { Chunk, StudyCard, StudyQuestion } from '../../data/models.ts';
import type { ReviewState } from '../../db/schema.ts';

export type StudyRating = 'again' | 'hard' | 'good' | 'easy';

export const RATING_LABEL: Record<StudyRating, string> = {
  again: 'Again',
  hard: 'Hard',
  good: 'Good',
  easy: 'Easy',
};

export const RATING_HINT: Record<StudyRating, string> = {
  again: 'missed',
  hard: 'unclear',
  good: 'got it',
  easy: 'got it',
};

/** Four-button ratings collapse onto the three review states. */
export function ratingToMark(rating: StudyRating): ReviewState {
  if (rating === 'again') return 'missed';
  if (rating === 'hard') return 'unclear';
  return 'got_it';
}

/** FNV-1a over UTF-16 code units. Deterministic across reloads. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function excerpt(body: string, max = 120): string {
  const oneLine = body.trim().replace(/\s+/g, ' ');
  if (oneLine.length <= max) return oneLine || 'This note';
  return `${oneLine.slice(0, max - 1).trimEnd()}…`;
}

function firstSentence(body: string): string {
  const text = body.trim().replace(/\s+/g, ' ');
  if (!text) return 'What should you remember from this note?';
  const match = text.match(/^(.+?[.?!])(?:\s|$)/);
  const sentence = (match?.[1] ?? text.split('\n')[0] ?? text).trim();
  return sentence.length > 140 ? excerpt(sentence, 140) : sentence;
}

/**
 * Deterministic card fixture for one chunk. Same id+body always yields the
 * same front/back; an empty body yields a reviewable placeholder, never a
 * throw.
 */
export function mockCardForChunk(chunk: Pick<Chunk, 'id' | 'body' | 'revision'>, position: number): StudyCard {
  const text = chunk.body.trim();
  const front = text ? `What should you remember from this note?\n\n${excerpt(firstSentence(text), 140)}` : 'This note is empty. Mark it so it leaves the session.';
  return {
    id: `mock-card-${chunk.id}`,
    deckId: `mock-deck-${chunk.id}`,
    roomId: '',
    position,
    front,
    back: text || 'Empty note — nothing to remember.',
    sourceChunkIds: [chunk.id],
    sourceRevision: chunk.revision,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** Deterministic deck fixture: one card per chunk, input order kept. */
export function mockDeckForChunks(chunks: readonly Pick<Chunk, 'id' | 'body' | 'revision'>[]): StudyCard[] {
  return chunks.map((chunk, index) => mockCardForChunk(chunk, index));
}

export type MockQuestionKind = StudyQuestion['kind'];

function mockKind(chunkId: string): MockQuestionKind {
  const kinds: MockQuestionKind[] = ['mcq', 'true_false', 'fill'];
  return kinds[hashString(chunkId) % kinds.length]!;
}

/**
 * Deterministic question fixture for one chunk. Same id+body always yields
 * the same kind/stem/choices/answer/explanation. Used only until STUDY.2
 * lands; saved quizzes take precedence whenever they exist.
 */
export function mockQuestionForChunk(
  chunk: Pick<Chunk, 'id' | 'body' | 'revision'>,
  position: number,
): StudyQuestion {
  const kind = mockKind(chunk.id);
  const text = chunk.body.trim();
  const short = excerpt(text || 'this note', 80);
  const seed = hashString(`${chunk.id}:${text}`);
  if (kind === 'mcq') {
    const correct = short;
    const distractors = [
      excerpt(`A different note in this room`, 80),
      excerpt(`The opposite of ${short}`, 80),
      excerpt(`An unrelated reminder`, 80),
    ];
    // Deterministic rotation so the answer is not always first.
    const choices = [correct, distractors[seed % distractors.length]!, distractors[(seed + 1) % distractors.length]!];
    const rotate = seed % choices.length;
    const ordered = [...choices.slice(rotate), ...choices.slice(0, rotate)];
    return {
      id: `mock-q-${chunk.id}`,
      quizId: `mock-quiz-${chunk.id}`,
      roomId: '',
      position,
      kind: 'mcq',
      stem: text ? `Which best matches this note?\n\n${excerpt(firstSentence(text), 140)}` : 'This note is empty — pick the honest answer.',
      choices: ordered,
      answer: correct,
      explanation: text ? `The note says: ${excerpt(text, 160)}` : 'Empty notes have nothing to match.',
      sourceChunkIds: [chunk.id],
      sourceRevision: chunk.revision,
      createdAt: 0,
      updatedAt: 0,
    };
  }
  if (kind === 'true_false') {
    const truthy = seed % 2 === 0;
    return {
      id: `mock-q-${chunk.id}`,
      quizId: `mock-quiz-${chunk.id}`,
      roomId: '',
      position,
      kind: 'true_false',
      stem: text ? `True or false: ${excerpt(firstSentence(text), 160)}` : 'True or false: this note is empty.',
      choices: [],
      answer: text ? (truthy ? 'true' : 'false') : 'false',
      explanation: text ? `Check the note: ${excerpt(text, 160)}` : 'An empty note is false — there is nothing to affirm.',
      sourceChunkIds: [chunk.id],
      sourceRevision: chunk.revision,
      createdAt: 0,
      updatedAt: 0,
    };
  }
  const words = short.split(' ').filter(Boolean);
  const answer = words.length > 1 ? words[Math.min(words.length - 1, seed % words.length)]! : short;
  return {
    id: `mock-q-${chunk.id}`,
    quizId: `mock-quiz-${chunk.id}`,
    roomId: '',
    position,
    kind: 'fill',
    stem: text ? `Fill in the blank from this note:\n\n${excerpt(firstSentence(text), 140)}` : 'This note is empty — type “empty”.',
    choices: [],
    answer: text ? answer : 'empty',
    explanation: text ? `The note says: ${excerpt(text, 160)}` : 'Empty notes accept “empty”.',
    sourceChunkIds: [chunk.id],
    sourceRevision: chunk.revision,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** Deterministic quiz fixture: one question per chunk, input order kept. */
export function mockQuizForChunks(chunks: readonly Pick<Chunk, 'id' | 'body' | 'revision'>[]): StudyQuestion[] {
  return chunks.map((chunk, index) => mockQuestionForChunk(chunk, index));
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

const TRUE_SET = new Set(['true', 't', 'yes', 'y', '1']);
const FALSE_SET = new Set(['false', 'f', 'no', 'n', '0']);

/** Accepts the common true/false spellings; anything else is wrong. */
export function normalizeTrueFalse(input: string): 'true' | 'false' | null {
  const next = norm(input);
  if (TRUE_SET.has(next)) return 'true';
  if (FALSE_SET.has(next)) return 'false';
  return null;
}

/**
 * Pending answer text for the runner. Choice questions (mcq/true_false) read
 * the selected choice; fill reads the typed input. Regression guard: an early
 * version read `input` for true_false, so selecting True/False never enabled
 * "Check answer".
 */
export function pendingAnswerInput(
  kind: Pick<StudyQuestion, 'kind'>['kind'],
  choice: string | null,
  input: string,
): string {
  return kind === 'fill' ? input : (choice ?? '');
}

/**
 * Checks one answer. MCQ compares against choices/answer case-insensitively;
 * T/F accepts t/f/yes/no spellings; fill compares case-insensitively after
 * trimming. Empty input never counts as correct.
 */
export function checkAnswer(
  question: Pick<StudyQuestion, 'kind' | 'answer' | 'choices'>,
  input: string,
): { correct: boolean } {
  if (!input.trim()) return { correct: false };
  if (question.kind === 'mcq') {
    const want = norm(question.answer);
    return { correct: norm(input) === want };
  }
  if (question.kind === 'true_false') {
    const got = normalizeTrueFalse(input);
    if (got === null) return { correct: false };
    return { correct: got === norm(question.answer) };
  }
  return { correct: norm(input) === norm(question.answer) };
}

/** Saved rows carry a revision snapshot; a source edit marks them stale. */
export function isStale(
  savedRevision: number,
  sourceChunkIds: readonly string[],
  revisionByChunk: ReadonlyMap<string, number>,
): boolean {
  for (const id of sourceChunkIds) {
    const current = revisionByChunk.get(id);
    if (current === undefined || current !== savedRevision) return true;
  }
  return false;
}

/** Cards/questions step in position order, then id. Never mutates input. */
export function inStudyOrder<T extends { position: number; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

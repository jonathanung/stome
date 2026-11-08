/**
 * Study library helpers (STUDY.3 #132). Pure draft shaping, staleness checks,
 * and the human-confirmed save path for the library UI.
 *
 * The previews here are local mock stand-ins so the picker, review sheet and
 * lists work before the STUDY.2 deterministic generator lands. They never touch
 * the network, the harness, or SQLite: reads go through `src/data/queries.ts`
 * and saves go through the FND.2 commit boundary (`source: 'human'` with
 * `confirmed: true`). Nothing here writes SQL, so `npm run check:writes` stays
 * green. The STUDY.2 generator will live in `generator.ts`, not here.
 */

import type { Commit } from '../../data/commit.ts';
import type { Chunk } from '../../data/models.ts';
import { LIMITS } from '../../data/operations.ts';

export type StudyDraftKind = 'deck' | 'quiz' | 'outline';
export const STUDY_DRAFT_KINDS: StudyDraftKind[] = ['deck', 'quiz', 'outline'];

export const STUDY_DRAFT_LABEL: Record<StudyDraftKind, string> = {
  deck: 'Flashcards',
  quiz: 'Quiz',
  outline: 'Slides',
};

/** Hard cap mirrors the STUDY.2 input limit so previews never outgrow a save. */
export const MAX_PREVIEW_CHUNKS = 200;
const MAX_PREVIEW_BYTES = 1024 * 1024;

export interface DraftCard {
  key: string;
  front: string;
  back: string;
  sourceChunkIds: string[];
  sourceRevision: number;
}

export type DraftQuestionKind = 'mcq' | 'true_false' | 'fill';

export interface DraftQuestion {
  key: string;
  kind: DraftQuestionKind;
  stem: string;
  choices: string[];
  answer: string;
  explanation: string;
  sourceChunkIds: string[];
  sourceRevision: number;
}

export interface DraftSlide {
  key: string;
  title: string;
  bullets: string[];
  notes: string;
  sourceChunkIds: string[];
  sourceRevision: number;
}

export type StudyDraft =
  | { kind: 'deck'; title: string; cards: DraftCard[] }
  | { kind: 'quiz'; title: string; questions: DraftQuestion[] }
  | { kind: 'outline'; title: string; slides: DraftSlide[] };

export type PreviewError =
  | { code: 'empty_selection' }
  | { code: 'mixed_rooms' }
  | { code: 'bad_chunk' }
  | { code: 'too_large' };

export function previewErrorMessage(error: PreviewError): string {
  switch (error.code) {
    case 'empty_selection':
      return 'Select at least one chunk to generate a preview.';
    case 'mixed_rooms':
      return 'Study sets come from one room. Pick chunks from a single room.';
    case 'bad_chunk':
      return 'One of the selected chunks is missing its text or revision. Reload and try again.';
    case 'too_large':
      return 'That selection is too large to preview. Pick fewer chunks.';
  }
}

export type PreviewResult = { ok: true; draft: StudyDraft } | { ok: false; error: PreviewError };

function validChunk(chunk: Chunk): boolean {
  return (
    typeof chunk.id === 'string' && chunk.id.length > 0 &&
    typeof chunk.roomId === 'string' && chunk.roomId.length > 0 &&
    typeof chunk.body === 'string' &&
    Number.isInteger(chunk.revision) && chunk.revision >= 1
  );
}

/** Snapshot taken at preview time; a later source edit pushes a revision past it. */
export function snapshotRevision(chunks: Chunk[]): number {
  return chunks.reduce((max, chunk) => Math.max(max, chunk.revision), 1);
}

/** First sentence of a body, for fronts, stems and slide titles. */
function leadSentence(body: string): string {
  const match = body.replace(/\s+/g, ' ').trim().match(/^.*?[.!?…](?=\s|$)|^.{1,140}/);
  return (match?.[0] ?? body).trim().slice(0, 140) || 'Untitled';
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Sentences after the lead, for slide bullets. */
function tailSentences(body: string, max: number): string[] {
  const flat = body.replace(/\s+/g, ' ').trim();
  const parts = flat.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
  const tail = parts.length > 1 ? parts.slice(1) : parts;
  return tail.slice(0, max).map((s) => clip(s, LIMITS.studyBullet));
}

function firstLongWord(body: string): string | null {
  const word = body.replace(/\s+/g, ' ').trim().split(' ').find((w) => w.replace(/[^A-Za-z0-9]/g, '').length >= 4);
  return word ?? null;
}

/**
 * Deterministic mock preview of one deck: one recall card per chunk.
 * Shape only — the STUDY.2 generator replaces the wording, not the flow.
 */
function previewDeck(title: string, chunks: Chunk[], snapshot: number): StudyDraft {
  return {
    kind: 'deck',
    title,
    cards: chunks.map((chunk, index) => ({
      key: `card-${index}`,
      front: clip(`Recall: ${leadSentence(chunk.body)}`, LIMITS.studyText),
      back: clip(chunk.body.trim() || '(empty chunk)', LIMITS.studyText),
      sourceChunkIds: [chunk.id],
      sourceRevision: snapshot,
    })),
  };
}

/**
 * Deterministic mock preview of one quiz: one question per chunk, cycling
 * through the three supported kinds so the review sheet exercises each shape.
 */
function previewQuiz(title: string, chunks: Chunk[], snapshot: number): StudyDraft {
  const kinds: DraftQuestionKind[] = ['mcq', 'true_false', 'fill'];
  return {
    kind: 'quiz',
    title,
    questions: chunks.map((chunk, index) => {
      const kind = kinds[index % kinds.length]!;
      const lead = leadSentence(chunk.body);
      const ref = { sourceChunkIds: [chunk.id], sourceRevision: snapshot };
      if (kind === 'mcq') {
        const answer = clip(lead, LIMITS.studyChoice);
        return {
          key: `question-${index}`, kind, ...ref,
          stem: clip(`Which statement matches the note?`, LIMITS.studyText),
          choices: [answer, 'None of the above'],
          answer,
          explanation: clip(`From: ${lead}`, LIMITS.studyText),
        };
      }
      if (kind === 'true_false') {
        return {
          key: `question-${index}`, kind, ...ref,
          stem: clip(`True or false: ${lead}`, LIMITS.studyText),
          choices: [],
          answer: 'true',
          explanation: clip(`From: ${lead}`, LIMITS.studyText),
        };
      }
      const word = firstLongWord(chunk.body);
      if (!word) {
        return {
          key: `question-${index}`, kind: 'true_false' as const, ...ref,
          stem: clip(`True or false: ${lead}`, LIMITS.studyText),
          choices: [],
          answer: 'true',
          explanation: clip(`From: ${lead}`, LIMITS.studyText),
        };
      }
      return {
        key: `question-${index}`, kind, ...ref,
        stem: clip(chunk.body.replace(word, '___'), LIMITS.studyText),
        choices: [],
        answer: clip(word.slice(0, LIMITS.studyChoice), LIMITS.studyChoice),
        explanation: clip(`From: ${lead}`, LIMITS.studyText),
      };
    }),
  };
}

/** Deterministic mock preview of one slide outline: one slide per chunk. */
function previewOutline(title: string, chunks: Chunk[], snapshot: number): StudyDraft {
  return {
    kind: 'outline',
    title,
    slides: chunks.map((chunk, index) => ({
      key: `slide-${index}`,
      title: clip(leadSentence(chunk.body), LIMITS.studyTitle),
      bullets: tailSentences(chunk.body, LIMITS.studyBullets),
      notes: '',
      sourceChunkIds: [chunk.id],
      sourceRevision: snapshot,
    })),
  };
}

/**
 * Builds a reviewable mock draft from the ticked chunks. Pure and
 * deterministic: the same chunks always produce byte-identical JSON, so a
 * retry after a failed save previews exactly what was kept.
 */
export function previewStudyDraft(kind: StudyDraftKind, title: string, chunks: Chunk[]): PreviewResult {
  if (chunks.length === 0) return { ok: false, error: { code: 'empty_selection' } };
  if (chunks.some((chunk) => !validChunk(chunk))) return { ok: false, error: { code: 'bad_chunk' } };
  const roomId = chunks[0]!.roomId;
  if (chunks.some((chunk) => chunk.roomId !== roomId)) return { ok: false, error: { code: 'mixed_rooms' } };
  if (chunks.length > MAX_PREVIEW_CHUNKS) return { ok: false, error: { code: 'too_large' } };
  const bytes = chunks.reduce((size, chunk) => size + new TextEncoder().encode(chunk.body).length, 0);
  if (bytes > MAX_PREVIEW_BYTES) return { ok: false, error: { code: 'too_large' } };
  const cleanTitle = title.trim().replace(/\s+/g, ' ');
  if (!cleanTitle) return { ok: false, error: { code: 'empty_selection' } };
  // One snapshot for the whole selection — the maximum source revision, exactly
  // like the STUDY.2 generator stamps it, so the shared STUDY.6 staleness rule
  // reads generator-built and library-built rows identically.
  const snapshot = snapshotRevision(chunks);
  const draft =
    kind === 'deck' ? previewDeck(cleanTitle, chunks, snapshot)
    : kind === 'quiz' ? previewQuiz(cleanTitle, chunks, snapshot)
    : previewOutline(cleanTitle, chunks, snapshot);
  return { ok: true, draft };
}

/** Distinct subjects across chunks, in first-seen order. */
export function distinctSubjects(chunks: { subjects: string[] }[]): string[] {
  const seen = new Set<string>();
  for (const chunk of chunks) for (const subject of chunk.subjects) if (subject.trim()) seen.add(subject);
  return [...seen];
}

export function draftItemCount(draft: StudyDraft): number {
  return draft.kind === 'deck' ? draft.cards.length : draft.kind === 'quiz' ? draft.questions.length : draft.slides.length;
}

/**
 * Read-time staleness is owned by STUDY.6 (`scheduling.ts`): a derived row is
 * stale when any grounding chunk is gone or its current revision no longer
 * equals the snapshot taken at generation. The library lists use that same
 * rule so badges never disagree with the due queue. Note the snapshot is the
 * maximum source revision, so sources saved at mixed revisions read stale —
 * that conservative reading is pinned by STUDY.6 and shared here.
 */

/** Revision lookup for every chunk in one room, for stale badges. */
export function revisionMap(chunks: Chunk[]): Map<string, number> {
  return new Map(chunks.map((chunk) => [chunk.id, chunk.revision]));
}

export interface SaveContext {
  roomId: string;
  commit: Commit;
  /** Caller-supplied id factory (`randomUUID` in screens, counting ids in tests). */
  newId: () => string;
  /**
   * Stable base for op ids. Retrying a failed save reuses the same op ids, so
   * the boundary replays them as `duplicate: true` instead of adding rows.
   */
  opIdBase: string;
}

export type SaveResult = { ok: true; duplicate: boolean } | { ok: false; error: string };

function confirmedHuman() {
  return { source: 'human' as const, confirmed: true };
}

/**
 * Saves a reviewed draft through human-confirmed ops. Sequential, in study
 * order: the deck/quiz row first, then its children. A failure stops at the
 * first rejected op and reports it; nothing is rolled back (study rows have
 * no delete op), but the draft is returned untouched so Retry reuses the same
 * op ids and lands exactly the missing rows.
 *
 * Op ids are keyed by draft item key, not position, so removing or reordering
 * unsaved items between failure and retry still lands each item once. Study
 * rows have no update op: edits made to an already-saved item after a partial
 * failure do not re-apply on retry — Retry resumes the same plan.
 */
export async function saveStudyDraft(draft: StudyDraft, ctx: SaveContext): Promise<SaveResult> {
  const items = draftItemCount(draft);
  if (items === 0) return { ok: false, error: 'Nothing to save: every item was removed in review.' };
  const roomId = ctx.roomId;
  const selectedIds = draft.kind === 'deck'
    ? draft.cards.flatMap((card) => card.sourceChunkIds)
    : draft.kind === 'quiz'
      ? draft.questions.flatMap((question) => question.sourceChunkIds)
      : draft.slides.flatMap((slide) => slide.sourceChunkIds);
  const sourceChunkIds = [...new Set(selectedIds)];
  if (sourceChunkIds.length === 0) return { ok: false, error: 'Nothing to save: the draft lost its source chunks.' };

  if (draft.kind === 'deck') {
    const deckId = ctx.newId();
    const deckRevision = snapshotRevisionFrom(draft.cards);
    const deck = await ctx.commit({
      opId: `${ctx.opIdBase}:deck`, kind: 'study.deck.create', ...confirmedHuman(),
      payload: { deckId, roomId, title: draft.title, sourceChunkIds, sourceRevision: deckRevision },
    });
    if (!deck.ok) return { ok: false, error: deck.error.message };
    // A replayed deck op returns the original id; fresh local ids only fit a first save.
    const savedDeckId = deck.duplicate ? deck.value.deckId : deckId;
    let duplicate = deck.duplicate;
    for (const [i, card] of draft.cards.entries()) {
      const saved = await ctx.commit({
        opId: `${ctx.opIdBase}:card:${card.key}`, kind: 'study.card.create', ...confirmedHuman(),
        payload: {
          deckId: savedDeckId, roomId, front: card.front, back: card.back, position: i,
          sourceChunkIds: card.sourceChunkIds, sourceRevision: card.sourceRevision,
        },
      });
      if (!saved.ok) return { ok: false, error: saved.error.message };
      duplicate = duplicate && saved.duplicate;
    }
    return { ok: true, duplicate };
  }

  if (draft.kind === 'quiz') {
    const quizId = ctx.newId();
    const quizRevision = snapshotRevisionFrom(draft.questions);
    const quiz = await ctx.commit({
      opId: `${ctx.opIdBase}:quiz`, kind: 'study.quiz.create', ...confirmedHuman(),
      payload: { quizId, roomId, title: draft.title, sourceChunkIds, sourceRevision: quizRevision },
    });
    if (!quiz.ok) return { ok: false, error: quiz.error.message };
    // A replayed quiz op returns the original id; fresh local ids only fit a first save.
    const savedQuizId = quiz.duplicate ? quiz.value.quizId : quizId;
    let duplicate = quiz.duplicate;
    for (const [i, question] of draft.questions.entries()) {
      const saved = await ctx.commit({
        opId: `${ctx.opIdBase}:question:${question.key}`, kind: 'study.question.create', ...confirmedHuman(),
        payload: {
          quizId: savedQuizId, roomId, kind: question.kind, stem: question.stem,
          choices: question.kind === 'mcq' ? question.choices : undefined,
          answer: question.answer, explanation: question.explanation || undefined, position: i,
          sourceChunkIds: question.sourceChunkIds, sourceRevision: question.sourceRevision,
        },
      });
      if (!saved.ok) return { ok: false, error: saved.error.message };
      duplicate = duplicate && saved.duplicate;
    }
    return { ok: true, duplicate };
  }

  const outlineId = ctx.newId();
  const outlineRevision = snapshotRevisionFrom(draft.slides);
  const outline = await ctx.commit({
    opId: `${ctx.opIdBase}:outline`, kind: 'study.slide-outline.create', ...confirmedHuman(),
    payload: {
      outlineId, roomId, title: draft.title, sourceChunkIds, sourceRevision: outlineRevision,
      slides: draft.slides.map((slide) => ({
        title: slide.title, bullets: slide.bullets, notes: slide.notes,
        sourceChunkIds: slide.sourceChunkIds, sourceRevision: slide.sourceRevision,
      })),
    },
  });
  if (!outline.ok) return { ok: false, error: outline.error.message };
  return { ok: true, duplicate: outline.duplicate };
}

/** Snapshot for a parent row: the newest source revision across its children. */
function snapshotRevisionFrom(items: { sourceRevision: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.sourceRevision), 1);
}

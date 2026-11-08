/**
 * Review questions from the companion's review.generateQuestion tool, with a
 * local fallback. No writes here: a question never changes a note or a mark.
 */

import { HarnessError, type MockScenario } from '../../harness/contract';
import { completeReadTool, type Provider } from '../../harness/provider';
import { REVIEW_TOOL_NAME, type ReviewQuestionOutput } from '../../harness/tools';

export type CompanionQuestion = { source: 'companion'; question: string; answer: string };

export async function requestReviewQuestion(input: {
  roomId: string;
  chunk: { id: string; roomId: string; body: string };
  provider: Provider;
  scenario: MockScenario;
  signal: AbortSignal;
}): Promise<CompanionQuestion> {
  const { chunk } = input;
  const out = await completeReadTool<ReviewQuestionOutput>(
    input.provider,
    {
      tool: REVIEW_TOOL_NAME,
      input: { roomId: input.roomId, chunk: { id: chunk.id, roomId: chunk.roomId, text: chunk.body } },
      scenario: input.scenario,
    },
    input.signal,
  );
  return { source: 'companion', question: out.question, answer: out.answer };
}

export type QuestionChoice =
  | { source: 'companion'; question: string; answer: string; notice: null }
  | { source: 'local'; notice: string };

export const NOT_PAIRED_NOTICE = 'Companion not paired: using the note as the prompt.';

/** Pick the companion question or the local fallback, and say why in one line. */
export function chooseReviewQuestion(input: {
  token: string;
  result: CompanionQuestion | { error: unknown } | null;
}): QuestionChoice {
  if (!input.token.trim()) return { source: 'local', notice: NOT_PAIRED_NOTICE };
  const result = input.result;
  if (result && 'source' in result) {
    return { source: 'companion', question: result.question, answer: result.answer, notice: null };
  }
  if (result) {
    const error = result.error;
    const message = error instanceof HarnessError || error instanceof Error ? error.message : '';
    return { source: 'local', notice: message ? `${message} Using the note as the prompt.` : 'The companion did not answer. Using the note as the prompt.' };
  }
  return { source: 'local', notice: 'The companion did not answer. Using the note as the prompt.' };
}

/** Cache key: the question is for this note text at this revision. */
export function questionCacheKey(chunk: { id: string; revision: number; body: string }): string {
  return `${chunk.id}:${chunk.revision}:${chunk.body}`;
}

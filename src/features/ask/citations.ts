import { HarnessError } from '../../harness/contract.ts';

export type SourceChunk = {
  id: string;
  body: string;
  revision: number;
};

export type CitationProposal = {
  chunkId: string;
  anchorStart: number;
  anchorEnd: number;
  chunkRevision: number;
};

export type ChunkFocus = {
  chunkId: string;
  start: number;
  end: number;
};

export type AnswerCitation = {
  chunkId: string;
  label: string;
  quote: string;
  anchorStart: number;
  anchorEnd: number;
  anchored: boolean;
};

export type CitationProblem = {
  chunkId: string;
  code: 'missing_chunk' | 'bad_anchor' | 'stale_revision';
  message: string;
};

export const BAD_ANCHOR_MESSAGE = 'Bad anchor: the cited passage does not sit inside this chunk.';
export const MISSING_CHUNK_MESSAGE = 'This citation does not match a chunk in this room.';
export const STALE_REVISION_MESSAGE = 'Stale revision: this chunk changed after the answer. Ask again before pinning.';
export const STALE_PASSAGE_MESSAGE = 'Stale revision: the saved passage no longer matches this spot in the chunk.';
export const UNVERIFIED_PASSAGE_MESSAGE = 'This saved answer has no verified passage, so the current text is not shown as the citation.';

export function chunkLabel(body: string): string {
  const line = body.split('\n')[0]?.trim() ?? '';
  if (line.length === 0) return 'Empty chunk';
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

/** The quote is the chunk text inside the anchor, or null when the range is unusable. */
export function anchorQuote(body: string, start: number, end: number): string | null {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > body.length) {
    return null;
  }
  return body.slice(start, end);
}

export function citationsForProposal(
  selectedChunkIds: readonly string[],
  chunks: readonly SourceChunk[],
  proposal: CitationProposal,
): { citations: AnswerCitation[]; problems: CitationProblem[] } {
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const citations: AnswerCitation[] = [];
  const problems: CitationProblem[] = [];
  const seen = new Set<string>();

  function consider(chunkId: string, requireAnchor: boolean): void {
    if (seen.has(chunkId)) return;
    seen.add(chunkId);
    const chunk = byId.get(chunkId);
    if (!chunk) {
      problems.push({ chunkId, code: 'missing_chunk', message: MISSING_CHUNK_MESSAGE });
      return;
    }
    if (requireAnchor) {
      if (chunk.revision !== proposal.chunkRevision) {
        problems.push({ chunkId, code: 'stale_revision', message: STALE_REVISION_MESSAGE });
        return;
      }
      const quote = anchorQuote(chunk.body, proposal.anchorStart, proposal.anchorEnd);
      if (quote === null) {
        problems.push({ chunkId, code: 'bad_anchor', message: BAD_ANCHOR_MESSAGE });
        return;
      }
      citations.push({
        chunkId,
        label: chunkLabel(chunk.body),
        quote,
        anchorStart: proposal.anchorStart,
        anchorEnd: proposal.anchorEnd,
        anchored: true,
      });
      return;
    }
    citations.push({
      chunkId,
      label: chunkLabel(chunk.body),
      quote: '',
      anchorStart: 0,
      anchorEnd: 0,
      anchored: false,
    });
  }

  for (const chunkId of selectedChunkIds) consider(chunkId, chunkId === proposal.chunkId);
  if (!seen.has(proposal.chunkId)) consider(proposal.chunkId, true);
  return { citations, problems };
}

export type CitationRead =
  | { ok: true; start: number; end: number; quote: string }
  | { ok: false; code: 'bad_anchor' | 'stale_passage' | 'unverified'; message: string; savedQuote: string | null };

function savedQuoteFrom(grounding: unknown): string | null {
  if (typeof grounding !== 'object' || grounding === null || Array.isArray(grounding)) return null;
  const quote = (grounding as { quote?: unknown }).quote;
  return typeof quote === 'string' && quote.length > 0 ? quote : null;
}

/**
 * A pin is grounded only by the passage stored when it was confirmed.
 * Offsets alone never describe the current body. Older pins with no stored
 * passage stay unverified. A later edit that keeps the range in bounds is
 * stale when the current slice differs from that passage.
 */
export function citationFromAnnotation(body: string, anchor: unknown, grounding?: unknown): CitationRead {
  const savedQuote = savedQuoteFrom(grounding);
  if (!savedQuote) return { ok: false, code: 'unverified', message: UNVERIFIED_PASSAGE_MESSAGE, savedQuote: null };
  if (typeof anchor !== 'object' || anchor === null || Array.isArray(anchor)) {
    return { ok: false, code: 'bad_anchor', message: BAD_ANCHOR_MESSAGE, savedQuote };
  }
  const { start, end } = anchor as { start?: unknown; end?: unknown };
  if (typeof start !== 'number' || typeof end !== 'number') {
    return { ok: false, code: 'bad_anchor', message: BAD_ANCHOR_MESSAGE, savedQuote };
  }
  const current = anchorQuote(body, start, end);
  if (current === null || current !== savedQuote) {
    return { ok: false, code: 'stale_passage', message: STALE_PASSAGE_MESSAGE, savedQuote };
  }
  return { ok: true, start, end, quote: savedQuote };
}

export function visiblePinError(error: unknown): string {
  if (error instanceof HarnessError) {
    if (error.code === 'stale_revision') return `Stale revision: ${error.message}`;
    if (error.code === 'bad_anchor') return `Bad anchor: ${error.message}`;
    if (error.code === 'invalid_shape' && /anchor/i.test(error.message)) return `Bad anchor: ${error.message}`;
    if (error.code === 'invalid_shape' && /changed elsewhere/i.test(error.message)) {
      return `Stale revision: ${error.message}`;
    }
    return error.message;
  }
  if (error instanceof Error) {
    if (/anchor must be a range|bad anchor/i.test(error.message)) return `Bad anchor: ${error.message}`;
    if (/changed elsewhere|stale revision/i.test(error.message)) return `Stale revision: ${error.message}`;
    return error.message;
  }
  return 'Could not save the answer';
}

/**
 * Slide workspace data shape (#13 Slide workspace). The PDF import and
 * per-slide mark storage are not built yet (#44 is a deferred spike), so the
 * workspace renders against this interface and local state.
 */
export type SlideCell = { text: string; strong?: boolean; mark?: 'highlight' | 'question' };

export type SlideMark = {
  id: string;
  kind: 'question' | 'pinned-answer';
  /** Small caption above the body, e.g. "area · type ii cell". */
  caption: string;
  body: string;
};

export type SlidePage = {
  number: number;
  eyebrow: string;
  title: string;
  /** Header row first, then body rows; first column is the row header. */
  table: SlideCell[][];
  marks: SlideMark[];
  linkedNotes: string[];
  chunks: number;
};

export type SlideDeck = {
  title: string;
  course: string;
  source: 'pdf';
  pageCount: number;
  pages: SlidePage[];
};

export type PageStatus = 'none' | 'answered' | 'open';

export function pageStatus(page: SlidePage | undefined): PageStatus {
  if (!page || page.marks.length === 0) return 'none';
  return page.marks.some((mark) => mark.kind === 'pinned-answer') ? 'answered' : 'open';
}

/** Typed shape for the phone slide viewer. No slide backend exists yet; callers supply a deck. */
export type SlideCell = { text: string; bold?: string; header?: boolean; flagged?: boolean };

export type SlidePage = {
  eyebrow: string;
  title: string;
  /** Table rows, first row is the header. */
  rows: SlideCell[][];
  questionPin?: boolean;
};

export type PageNote =
  | { kind: 'question'; text: string }
  | { kind: 'pinnedAnswer'; text: string }
  | { kind: 'linkedNote'; text: string };

export type SlideDeck = {
  title: string;
  roomName: string;
  pageCount: number;
  pages: Record<number, { slide: SlidePage; notes: PageNote[] }>;
};

const h = (text: string): SlideCell => ({ text, header: true });

/** Local sample deck until slide import lands. */
export const SAMPLE_DECK: SlideDeck = {
  title: 'lecture 9.pdf',
  roomName: 'stat 330',
  pageCount: 28,
  pages: {
    12: {
      slide: {
        eyebrow: 'LECTURE 9',
        title: 'Type I and Type II errors',
        questionPin: true,
        rows: [
          [h(''), h('H₀ true'), h('H₀ false')],
          [h('reject'), { text: 'α', bold: 'Type I' }, { text: 'power 1 − β' }],
          [h('fail to reject'), { text: '1 − α' }, { text: 'β', bold: 'Type II', flagged: true }],
        ],
      },
      notes: [
        { kind: 'question', text: 'how do i lower β without raising α?' },
        { kind: 'pinnedAnswer', text: 'increase n. power goes up at the same α.' },
        { kind: 'linkedNote', text: 'type i is rejecting a true null. "false alarm".' },
      ],
    },
  },
};

export function clampPage(page: number, count: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.trunc(page), 1), Math.max(count, 1));
}

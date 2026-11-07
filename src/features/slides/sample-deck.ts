import type { SlideDeck } from './types';

/** Placeholder deck until PDF import lands (#44). */
export const SAMPLE_DECK: SlideDeck = {
  title: 'lecture 9.pdf',
  course: 'stat 330',
  source: 'pdf',
  pageCount: 28,
  pages: [
    {
      number: 12,
      eyebrow: 'LECTURE 9',
      title: 'Type I and Type II errors',
      table: [
        [{ text: '' }, { text: 'H₀ true' }, { text: 'H₀ false' }],
        [
          { text: 'reject H₀' },
          { text: 'Type I error\nprobability α', strong: true },
          { text: 'correct\npower = 1 − β' },
        ],
        [
          { text: 'fail to reject' },
          { text: 'correct\nprobability 1 − α' },
          { text: 'Type II error\nprobability β', strong: true, mark: 'question' },
        ],
      ],
      marks: [
        { id: 'm1', kind: 'question', caption: 'area · type ii cell', body: 'how do i lower β without raising α?' },
        {
          id: 'm2',
          kind: 'pinned-answer',
          caption: 'pinned answer · from page 14',
          body: 'increase n. a smaller standard error raises power at the same α.',
        },
      ],
      linkedNotes: ['type i is rejecting a true null. think "false alarm".'],
      chunks: 1,
    },
  ],
};

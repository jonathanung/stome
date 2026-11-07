import type { SemanticColors } from '../../../design-theme/src/tokens';

/**
 * Colour roles for the Ask/harness panel and the citation list it renders
 * inside a proposal. Keeping the mapping here makes the rendered foreground
 * and background pairs explicit, so `tests/harness-colors.test.ts` can prove
 * the 4.5:1 contrast target for both schemes instead of trusting a hex value.
 */
export type HarnessColors = {
  panelSurface: string;
  proposalSurface: string;
  heading: string;
  label: string;
  help: string;
  state: string;
  input: string;
  border: string;
  selectedFill: string;
  selectedText: string;
  proposalTitle: string;
  proposalBody: string;
  sourceLabel: string;
  citationLabel: string;
  citationQuote: string;
  error: string;
};

export type HarnessContrastPair = {
  name: string;
  foreground: string;
  background: string;
};

export function harnessColors(colors: SemanticColors): HarnessColors {
  return {
    panelSurface: colors.bg.canvas,
    proposalSurface: colors.bg.inset,
    heading: colors.text.primary,
    label: colors.text.secondary,
    help: colors.text.secondary,
    state: colors.text.secondary,
    input: colors.text.primary,
    border: colors.border.hairline,
    selectedFill: colors.accent.bg,
    selectedText: colors.accent.fg,
    proposalTitle: colors.text.primary,
    proposalBody: colors.text.primary,
    sourceLabel: colors.text.primary,
    citationLabel: colors.text.primary,
    citationQuote: colors.text.secondary,
    error: colors.status.danger.text,
  };
}

/** The text/surface pairs that must clear 4.5:1 in both schemes. */
export function harnessContrastPairs(colors: SemanticColors): HarnessContrastPair[] {
  const palette = harnessColors(colors);
  return [
    { name: 'heading', foreground: palette.heading, background: palette.panelSurface },
    { name: 'labels', foreground: palette.label, background: palette.panelSurface },
    { name: 'help', foreground: palette.help, background: palette.panelSurface },
    { name: 'session state', foreground: palette.state, background: palette.panelSurface },
    { name: 'input text', foreground: palette.input, background: palette.panelSurface },
    { name: 'proposal title', foreground: palette.proposalTitle, background: palette.proposalSurface },
    { name: 'proposal body', foreground: palette.proposalBody, background: palette.proposalSurface },
    { name: 'Sources', foreground: palette.sourceLabel, background: palette.proposalSurface },
    { name: 'citation label', foreground: palette.citationLabel, background: palette.proposalSurface },
    { name: 'citation quote', foreground: palette.citationQuote, background: palette.proposalSurface },
  ];
}

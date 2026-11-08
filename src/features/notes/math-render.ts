import katex from 'katex';

export type RenderedMath = { ok: true; html: string } | { ok: false; message: string };

const UNSAFE = /<\s*script\b|javascript:|on[a-z]+\s*=|<\s*(?:iframe|object|embed|foreignObject)\b/i;

/**
 * Typesets one formula to MathML with KaTeX, bundled locally. `trust` stays
 * off, so commands that fetch or inject HTML are rejected. A bad formula
 * returns a message instead of throwing.
 */
export function renderMath(tex: string, display: boolean): RenderedMath {
  try {
    const html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: 'ignore',
      output: 'mathml',
      maxSize: 10,
      maxExpand: 80,
    });
    if (UNSAFE.test(html)) return { ok: false, message: 'This formula was rejected.' };
    return { ok: true, html };
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : 'This formula could not be read.';
    return { ok: false, message };
  }
}

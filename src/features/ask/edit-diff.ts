export type DiffPart = { text: string; changed: boolean };

/** Word-level diff of two bodies. `before` marks removed words, `after` marks added ones. */
export function diffWords(previous: string, next: string): { before: DiffPart[]; after: DiffPart[] } {
  const a = previous.split(/(\s+)/).filter((part) => part.length > 0);
  const b = next.split(/(\s+)/).filter((part) => part.length > 0);
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const before: DiffPart[] = [];
  const after: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      before.push({ text: a[i], changed: false });
      after.push({ text: b[j], changed: false });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      before.push({ text: a[i], changed: true });
      i += 1;
    } else {
      after.push({ text: b[j], changed: true });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) before.push({ text: a[i], changed: true });
  for (; j < b.length; j += 1) after.push({ text: b[j], changed: true });
  return { before: mergeRuns(before), after: mergeRuns(after) };
}

/** Whitespace between two changed words belongs to the change. */
function mergeRuns(parts: DiffPart[]): DiffPart[] {
  const marked = parts.map((part, index) => {
    if (part.changed || !/^\s+$/.test(part.text)) return part;
    const prev = parts[index - 1];
    const next = parts[index + 1];
    return prev?.changed && next?.changed ? { ...part, changed: true } : part;
  });
  const merged: DiffPart[] = [];
  for (const part of marked) {
    const last = merged[merged.length - 1];
    if (last && last.changed === part.changed) last.text += part.text;
    else merged.push({ ...part });
  }
  return merged;
}

export function countChanges(parts: DiffPart[]): number {
  return parts.filter((part) => part.changed).length;
}

import { LIMITS } from '../data/operations.ts';

export const MAX_IMPORT_BYTES = 1024 * 1024;

export interface ImportInput {
  path: string;
  text: string;
}

export interface ParsedNote {
  path: string;
  title: string;
  bodies: string[];
  subjects: string[];
  warnings: string[];
}

export function normalizePath(raw: string): string {
  const path = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!path || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..') || /[:\x00-\x1f]/.test(path)) {
    throw new Error('Use a relative source path without empty folders, .. or control characters.');
  }
  if (!/\.md$/i.test(path)) throw new Error('Only UTF-8 .md files are supported in v1.');
  return path;
}

export function sourceIdentity(collection: string, path: string): string {
  const name = collection.trim();
  if (!name || name.length > 80) throw new Error('Choose a collection name of 1–80 characters.');
  const identity = `markdown:${encodeURIComponent(name)}/${normalizePath(path).split('/').map(encodeURIComponent).join('/')}`;
  if (identity.length > 2048) throw new Error('The source path is too long.');
  return identity;
}

/** No rendering, link resolution or general YAML evaluation: preserve the source. */
export function parseMarkdown(input: ImportInput): ParsedNote {
  const path = normalizePath(input.path);
  if (new TextEncoder().encode(input.text).length > MAX_IMPORT_BYTES) throw new Error('Each note must be at most 1 MiB.');
  if (input.text.includes('\0') || input.text.includes('\ufffd')) throw new Error('This file is not valid UTF-8 text.');
  const text = input.text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!text.trim()) throw new Error('This note is empty.');
  const warnings = new Set<string>();
  const candidates: string[] = [];
  const addValues = (raw: string) => {
    const value = raw.trim();
    if (/[{}&*|>]/.test(value) || (/^\[/.test(value) && !/\]$/.test(value))) {
      warnings.add('Complex YAML is preserved as text; check the suggested subjects.');
      return;
    }
    const values = value.startsWith('[') ? value.slice(1, -1).split(',') : [value];
    for (const item of values) {
      const clean = item.trim().replace(/^(['"])(.*)\1$/, '$2').replace(/^#/, '');
      if (clean) candidates.push(clean);
    }
  };
  const lines = text.split('\n');
  let frontmatterEnd = -1;
  if (lines[0] === '---') {
    frontmatterEnd = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (frontmatterEnd < 0) warnings.add('Unclosed frontmatter is preserved as text; check the suggested subjects.');
    else {
      let list = false;
      for (const line of lines.slice(1, frontmatterEnd)) {
        const field = /^(tags|subjects):\s*(.*)$/.exec(line);
        if (field) {
          list = !field[2].trim();
          if (!list) addValues(field[2]);
        } else if (list && /^\s*-\s+/.test(line)) addValues(line.replace(/^\s*-\s+/, ''));
        else if (line.trim() && !/^\s*#/.test(line)) list = false;
      }
      warnings.add('Frontmatter is preserved in the note; subject suggestions use simple tags/subjects only.');
    }
  }

  const sections: string[] = [];
  let section: string[] = [];
  let fence: { char: string; size: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inYaml = frontmatterEnd >= 0 && i <= frontmatterEnd;
    const marker = !inYaml ? /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line) : null;
    if (marker) {
      if (!fence) fence = { char: marker[1][0], size: marker[1].length };
      else if (marker[1][0] === fence.char && marker[1].length >= fence.size && !marker[2].trim()) fence = null;
      section.push(line);
      continue;
    }
    if (!inYaml && !fence) {
      if (/^ {0,3}#{1,6}\s+\S/.test(line) && section.join('\n').trim()) {
        sections.push(section.join('\n'));
        section = [];
      }
      // Inline code is literal too: avoid inferring subjects from code examples.
      const prose = line.replace(/(`+)[\s\S]*?\1/g, '');
      for (const match of prose.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) candidates.push(match[1]);
    }
    section.push(line);
  }
  if (section.join('\n').trim()) sections.push(section.join('\n'));
  if (/!?\[\[/.test(text)) warnings.add('Wikilinks and embeds stay as text. Linked notes and attachments are not copied.');
  if (/!\[[^\]]*\]\(/.test(text)) warnings.add('Images stay as Markdown references. Image files are not copied.');
  if (fence) warnings.add('An unclosed code fence was preserved.');

  const bodies: string[] = [];
  for (const raw of sections) {
    let body = raw.trim();
    while (body.length > LIMITS.body) {
      let end: number = LIMITS.body;
      const last = body.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end--;
      bodies.push(body.slice(0, end));
      body = body.slice(end);
      warnings.add('Long sections were split into smaller chunks.');
    }
    if (body.trim()) bodies.push(body);
  }
  if (bodies.length > LIMITS.bodiesPerOp) throw new Error(`This note exceeds ${LIMITS.bodiesPerOp} chunks. Split it into smaller files.`);
  const folders = path.split('/');
  if (folders.length > 1) candidates.push(folders[folders.length - 2]);
  const subjects: string[] = [];
  for (const candidate of candidates) {
    const subject = candidate.trim().replace(/\s+/g, ' ');
    if (subject.length > LIMITS.subject || subjects.length >= LIMITS.subjects) {
      warnings.add('Some subject suggestions exceeded the limits and were omitted. Review the subjects.');
    } else if (subject && !subjects.some((s) => s.toLowerCase() === subject.toLowerCase())) subjects.push(subject);
  }
  if (!subjects.length) warnings.add('No subjects were inferred. You can add subjects before saving.');
  return { path, title: folders[folders.length - 1].replace(/\.md$/i, ''), bodies, subjects, warnings: [...warnings] };
}

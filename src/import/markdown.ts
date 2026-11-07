import { LIMITS } from '../data/operations.ts';

export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_FRONTMATTER_LINES = 200;
export const MAX_VAULT_PATHS = 200;

const MAX_META_LINKS = 50;
const MAX_PROPERTIES = 40;
const MAX_PROPERTY_VALUES = 30;
const MAX_LINK_CHARS = 240;
const COMPLEX_YAML = 'Complex YAML is preserved as text; check the suggested subjects.';
const COMMENT_YAML = 'An inline frontmatter comment was preserved as text and was not used as a subject.';
const PRESERVED_YAML = 'Frontmatter is preserved in the note; subject suggestions use simple tags/subjects only.';
const UNCLOSED_YAML = 'Unclosed frontmatter is preserved as text; check the suggested subjects.';
const LIMITED_YAML = 'Frontmatter exceeded 200 lines and was preserved as text; subjects were not inferred from it.';

export interface ImportInput {
  path: string;
  text: string;
}

export interface FrontmatterProperty {
  key: string;
  values: string[];
}

export interface WikilinkMeta {
  raw: string;
  target: string;
  heading: string | null;
  alias: string | null;
  embed: boolean;
}

export interface SkippedAttachment {
  raw: string;
  name: string;
}

/** Review metadata. Persisted notes keep the same bodies, subjects and source identity. */
export interface MarkdownMetadata {
  headings: { level: number; text: string }[];
  properties: FrontmatterProperty[];
  tags: string[];
  wikilinks: WikilinkMeta[];
  skippedAttachments: SkippedAttachment[];
}

export interface ParsedNote {
  path: string;
  title: string;
  bodies: string[];
  subjects: string[];
  warnings: string[];
  metadata: MarkdownMetadata;
}

export interface VaultPathEntry {
  path: string;
  kind: 'note' | 'attachment' | 'config' | 'unsupported' | 'unsafe';
}

const ATTACHMENT_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'pdf', 'mp3', 'm4a', 'wav', 'mp4', 'webm', 'mov', 'canvas', 'heic']);

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

/** Classify a vault listing. This does not open, copy or execute any file. */
export function accountVaultPaths(paths: readonly string[]): { entries: VaultPathEntry[]; warnings: string[] } {
  const warnings: string[] = [];
  const source = paths.length > MAX_VAULT_PATHS ? paths.slice(0, MAX_VAULT_PATHS) : paths;
  if (paths.length > MAX_VAULT_PATHS) {
    warnings.push(`Accounted for the first ${MAX_VAULT_PATHS} vault paths. ${paths.length - MAX_VAULT_PATHS} additional paths were not imported.`);
  }
  const entries = source.map(classifyVaultPath);
  const groups: { kind: VaultPathEntry['kind']; one: string; many: string }[] = [
    { kind: 'attachment', one: 'attachment', many: 'attachments' },
    { kind: 'config', one: 'config file', many: 'config files' },
    { kind: 'unsupported', one: 'unsupported file', many: 'unsupported files' },
    { kind: 'unsafe', one: 'unsafe path', many: 'unsafe paths' },
  ];
  const parts: string[] = [];
  for (const group of groups) {
    const items = entries.filter((entry) => entry.kind === group.kind);
    if (!items.length) continue;
    const names = items.slice(0, 8).map((item) => item.path);
    const more = items.length > 8 ? `, and ${items.length - 8} more` : '';
    parts.push(`${items.length} ${items.length === 1 ? group.one : group.many} (${names.join(', ')}${more})`);
  }
  if (parts.length) warnings.push(`Skipped ${parts.join(', ')}. These files were not copied or executed.`);
  return { entries, warnings };
}

export function classifyVaultPath(raw: string): VaultPathEntry {
  const path = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!path || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..') || /[:\x00-\x1f]/.test(path)) {
    return { path: raw.trim() || raw, kind: 'unsafe' };
  }
  if (path.split('/').some((part) => part.startsWith('.'))) return { path, kind: 'config' };
  const base = path.split('/').pop() ?? path;
  const ext = (/\.([A-Za-z0-9]+)$/.exec(base)?.[1] ?? '').toLowerCase();
  if (ext === 'md') return { path, kind: 'note' };
  if (ATTACHMENT_EXT.has(ext)) return { path, kind: 'attachment' };
  return { path, kind: 'unsupported' };
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
  const metadata: MarkdownMetadata = { headings: [], properties: [], tags: [], wikilinks: [], skippedAttachments: [] };
  const lines = text.split('\n');
  const frontmatterEnd = readFrontmatter(lines, warnings, candidates, metadata);

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
    if (!fence) {
      const prose = line.replace(/(`+)[\s\S]*?\1/g, '');
      if (!inYaml) {
        const heading = /^(#{1,6})\s+(\S.*)$/.exec(line.trimStart());
        const atx = /^ {0,3}#{1,6}\s+\S/.test(line);
        if (heading && atx) rememberHeading(heading[1].length, heading[2], metadata, warnings);
        if (atx && section.join('\n').trim()) {
          sections.push(section.join('\n'));
          section = [];
        }
        // Inline code is literal too: avoid inferring subjects from code examples.
        for (const match of prose.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) {
          candidates.push(match[1]);
          rememberTag(metadata.tags, match[1]);
        }
      }
      rememberLinks(prose, metadata, warnings);
    }
    section.push(line);
  }
  if (section.join('\n').trim()) sections.push(section.join('\n'));
  if (/!?\[\[/.test(text)) warnings.add('Wikilinks and embeds stay as text. Linked notes and attachments are not copied.');
  if (/!\[[^\]]*\]\(/.test(text)) warnings.add('Images stay as Markdown references. Image files are not copied.');
  if (metadata.wikilinks.length) warnings.add(wikilinkWarning(metadata.wikilinks));
  if (metadata.skippedAttachments.length) warnings.add(attachmentWarning(metadata.skippedAttachments));
  if (fence) warnings.add('An unclosed code fence was preserved.');
  metadata.properties = metadata.properties.filter((property) => property.values.length > 0);

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
    } else if (subject && !subjects.some((item) => item.toLowerCase() === subject.toLowerCase())) subjects.push(subject);
  }
  if (!subjects.length) warnings.add('No subjects were inferred from the file. You can add subjects or a source folder before saving.');
  return { path, title: folders[folders.length - 1].replace(/\.md$/i, ''), bodies, subjects, warnings: [...warnings], metadata };
}

function readFrontmatter(lines: string[], warnings: Set<string>, candidates: string[], metadata: MarkdownMetadata): number {
  if (lines[0] !== '---') return -1;
  const frontmatterEnd = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
  if (frontmatterEnd < 0) {
    warnings.add(UNCLOSED_YAML);
    if (lines.length - 1 > MAX_FRONTMATTER_LINES) warnings.add(LIMITED_YAML);
    return -1;
  }
  warnings.add(PRESERVED_YAML);
  if (frontmatterEnd - 1 > MAX_FRONTMATTER_LINES) {
    warnings.add(LIMITED_YAML);
    return frontmatterEnd;
  }
  let listKey: string | null = null;
  let listProperty: FrontmatterProperty | null = null;
  for (const line of lines.slice(1, frontmatterEnd)) {
    if (line.includes('\t')) {
      warnings.add(COMPLEX_YAML);
      listKey = null;
      listProperty = null;
      continue;
    }
    const field = /^([A-Za-z][A-Za-z0-9_/-]*):\s*(.*)$/.exec(line);
    if (field) {
      const key = field[1];
      const raw = field[2];
      if (!raw.trim()) {
        listKey = key;
        listProperty = propertyFor(metadata.properties, key, warnings);
        continue;
      }
      listKey = null;
      listProperty = null;
      const parsed = parseSimpleValue(raw);
      if (!parsed.ok) {
        warnings.add(parsed.reason === 'comment' ? COMMENT_YAML : COMPLEX_YAML);
        continue;
      }
      pushPropertyValues(propertyFor(metadata.properties, key, warnings), parsed.values, warnings);
      collectSubjects(key, parsed.values, candidates, metadata.tags);
      continue;
    }
    if (listKey && /^\s*-\s+/.test(line)) {
      const parsed = parseSimpleValue(line.replace(/^\s*-\s+/, ''));
      if (!parsed.ok) {
        warnings.add(parsed.reason === 'comment' ? COMMENT_YAML : COMPLEX_YAML);
        continue;
      }
      pushPropertyValues(listProperty, parsed.values, warnings);
      collectSubjects(listKey, parsed.values, candidates, metadata.tags);
      continue;
    }
    if (line.trim() && !/^\s*#/.test(line)) {
      if (/^\s+\S/.test(line)) warnings.add(COMPLEX_YAML);
      listKey = null;
      listProperty = null;
    }
  }
  return frontmatterEnd;
}

function collectSubjects(key: string, values: string[], candidates: string[], tags: string[]): void {
  if (key !== 'tags' && key !== 'subjects') return;
  for (const value of values) {
    candidates.push(value);
    if (key === 'tags') rememberTag(tags, value);
  }
}

type SimpleValue = { ok: true; values: string[] } | { ok: false; reason: 'complex' | 'comment' };

function parseSimpleValue(raw: string): SimpleValue {
  const value = raw.trim();
  if (!value) return { ok: true, values: [] };
  if (value.length > 2000) return { ok: false, reason: 'complex' };
  if (value.startsWith('[')) {
    if (!value.endsWith(']')) return { ok: false, reason: 'complex' };
    return parseFlow(value.slice(1, -1));
  }
  if (/[{}&*|>]|!!/.test(value)) return { ok: false, reason: 'complex' };
  if (unquotedHash(value) > 0) return { ok: false, reason: 'comment' };
  const clean = unquote(value).trim().replace(/^#/, '');
  if (!clean) return { ok: true, values: [] };
  if (clean.includes(',') || /[{}&*|>]|!!/.test(clean) || clean.length > 500) return { ok: false, reason: 'complex' };
  return { ok: true, values: [clean] };
}

function parseFlow(inner: string): SimpleValue {
  const values: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ',') {
      const clean = current.trim().replace(/^#/, '');
      if (clean) values.push(clean);
      current = '';
      continue;
    }
    if ('{}&*|>!'.includes(ch)) return { ok: false, reason: 'complex' };
    current += ch;
  }
  if (quote) return { ok: false, reason: 'complex' };
  const tail = current.trim().replace(/^#/, '');
  if (tail) values.push(tail);
  if (values.some((item) => item.includes(',') || item.length > 500)) return { ok: false, reason: 'complex' };
  return { ok: true, values };
}

function unquote(value: string): string {
  const match = /^(['"])([\s\S]*)\1$/.exec(value.trim());
  return match ? match[2] : value.trim();
}

function unquotedHash(value: string): number {
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && i > 0 && /\s/.test(value[i - 1])) return i;
  }
  return -1;
}

function propertyFor(properties: FrontmatterProperty[], key: string, warnings: Set<string>): FrontmatterProperty | null {
  const found = properties.find((item) => item.key === key);
  if (found) return found;
  if (properties.length >= MAX_PROPERTIES) {
    warnings.add('Some frontmatter properties were omitted from metadata and preserved as text.');
    return null;
  }
  const created = { key, values: [] };
  properties.push(created);
  return created;
}

function pushPropertyValues(property: FrontmatterProperty | null, values: string[], warnings: Set<string>): void {
  if (!property) return;
  for (const value of values) {
    if (property.values.length >= MAX_PROPERTY_VALUES) {
      warnings.add('Some frontmatter values were omitted from metadata and preserved as text.');
      return;
    }
    if (!property.values.some((item) => item.toLowerCase() === value.toLowerCase())) property.values.push(value);
  }
}

function rememberTag(tags: string[], value: string): void {
  if (!tags.some((item) => item.toLowerCase() === value.toLowerCase())) tags.push(value);
}

function rememberHeading(level: number, raw: string, metadata: MarkdownMetadata, warnings: Set<string>): void {
  if (metadata.headings.length >= LIMITS.bodiesPerOp) {
    warnings.add('Additional headings stay in the note and were omitted from metadata.');
    return;
  }
  const full = raw.trim();
  metadata.headings.push({ level, text: full.length > 300 ? full.slice(0, 300) : full });
  if (full.length > 300) warnings.add('A long heading was shortened in metadata; the full heading stays in the note.');
}

function rememberLinks(prose: string, metadata: MarkdownMetadata, warnings: Set<string>): void {
  let cursor = 0;
  while (cursor < prose.length) {
    const start = prose.indexOf('[[', cursor);
    if (start < 0) break;
    const close = prose.indexOf(']]', start + 2);
    if (close < 0) {
      warnings.add('An unclosed wikilink was preserved as text.');
      break;
    }
    const inner = prose.slice(start + 2, close);
    const embed = start > 0 && prose[start - 1] === '!';
    const raw = `${embed ? '!' : ''}[[${inner}]]`;
    if (inner.length > MAX_LINK_CHARS || inner.includes('[') || inner.includes(']')) {
      warnings.add('A malformed wikilink was preserved as text.');
    } else {
      const link = describeWikilink(raw, inner, embed);
      if (link.embed && isAttachmentTarget(link.target)) {
        rememberAttachment(metadata, warnings, { raw, name: attachmentName(link.target) });
      } else if (metadata.wikilinks.length >= MAX_META_LINKS) {
        warnings.add('Additional wikilinks were preserved as text and omitted from metadata.');
      } else metadata.wikilinks.push(link);
    }
    cursor = close + 2;
  }
  for (const match of prose.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    const raw = match[0];
    const name = match[2].length > MAX_LINK_CHARS ? `${match[2].slice(0, MAX_LINK_CHARS)}…` : match[2];
    if (match[2].length > MAX_LINK_CHARS) warnings.add('A long attachment reference was shortened in metadata; the full reference stays in the note.');
    rememberAttachment(metadata, warnings, { raw, name });
  }
}

function describeWikilink(raw: string, inner: string, embed: boolean): WikilinkMeta {
  let pipe = -1;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '|' && inner[i - 1] !== '\\') {
      pipe = i;
      break;
    }
  }
  const left = unescapePipe(pipe < 0 ? inner : inner.slice(0, pipe)).trim();
  let alias = pipe < 0 ? null : unescapePipe(inner.slice(pipe + 1)).trim();
  if (!alias || /^\d+(?:x\d+)?$/.test(alias)) alias = null;
  const hash = left.indexOf('#');
  const target = (hash < 0 ? left : left.slice(0, hash)).trim();
  const heading = hash < 0 ? null : left.slice(hash + 1).trim() || null;
  return { raw, target, heading, alias, embed };
}

function unescapePipe(value: string): string {
  return value.replace(/\\\|/g, '|');
}

function isAttachmentTarget(target: string): boolean {
  const base = target.split('/').pop() ?? target;
  const ext = (/\.([A-Za-z0-9]+)$/.exec(base)?.[1] ?? '').toLowerCase();
  return ext !== '' && ext !== 'md';
}

function attachmentName(target: string): string {
  return target.length > MAX_LINK_CHARS ? `${target.slice(0, MAX_LINK_CHARS)}…` : target;
}

function rememberAttachment(metadata: MarkdownMetadata, warnings: Set<string>, item: SkippedAttachment): void {
  if (metadata.skippedAttachments.length >= MAX_META_LINKS) {
    warnings.add('Additional attachment references stay in the note and were omitted from the skip count.');
    return;
  }
  metadata.skippedAttachments.push(item);
}

function wikilinkWarning(links: readonly WikilinkMeta[]): string {
  const shown = links.slice(0, 8).map(describeLink);
  const more = links.length > 8 ? `; and ${links.length - 8} more` : '';
  const noun = links.length === 1 ? 'wikilink' : 'wikilinks';
  const pronoun = links.length === 1 ? 'it' : 'them';
  return `Preserved ${links.length} ${noun} as text without resolving ${pronoun}: ${shown.join('; ')}${more}.`;
}

function describeLink(link: WikilinkMeta): string {
  const name = link.target || '(empty target)';
  const extra: string[] = [];
  if (!link.target) extra.push('empty target');
  if (link.heading) extra.push(`heading "${link.heading}"`);
  if (link.alias) extra.push(`alias "${link.alias}"`);
  if (link.embed) extra.push('embed');
  const detail = extra.filter((item) => item !== 'empty target');
  if (!link.target) return detail.length ? `(empty target, ${detail.join(', ')})` : '(empty target)';
  return detail.length ? `${name} (${detail.join(', ')})` : name;
}

function attachmentWarning(items: readonly SkippedAttachment[]): string {
  const shown = items.slice(0, 8).map((item) => item.name);
  const more = items.length > 8 ? `, and ${items.length - 8} more` : '';
  const noun = items.length === 1 ? 'attachment' : 'attachments';
  return `Skipped ${items.length} ${noun} (${shown.join(', ')}${more}). The reference stays in the note and the file was not copied.`;
}

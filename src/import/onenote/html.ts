import { assertTextBudget, decodeEntities } from './shared.ts';

const SKIP = new Set(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'applet', 'template', 'svg', 'math', 'noframes']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const MAX_TAGS = 20_000;
const MAX_TAG_CHARS = 65_536;

export interface HtmlPage {
  title: string | null;
  sections: string[][];
  warnings: Set<string>;
}

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  raw: string;
  next: number;
}

function localName(raw: string): string {
  const name = raw.toLowerCase();
  const colon = name.lastIndexOf(':');
  return colon >= 0 ? name.slice(colon + 1) : name;
}

function readTag(text: string, start: number): Tag {
  let quote: '"' | "'" | null = null;
  let end = -1;
  const limit = Math.min(text.length, start + MAX_TAG_CHARS);
  for (let i = start + 1; i < limit; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('This HTML export has a tag that is too long or unclosed.');
  const raw = text.slice(start, end + 1);
  const match = /^<\s*(\/?)\s*([^\s/>]+)/.exec(raw);
  const name = match ? localName(match[2]) : '';
  return { name, closing: match?.[1] === '/', selfClosing: raw.endsWith('/>') || VOID.has(name), raw, next: end + 1 };
}

function quotedAttr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  if (!match) return null;
  return decodeEntities(match[2] ?? match[3] ?? '');
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Turn untrusted HTML into text sections. Tags are scanned, never rendered.
 * Script, style, and embedded content are dropped. No URL is requested.
 */
export function htmlToSections(text: string): HtmlPage {
  assertTextBudget(text);
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const sections: string[][] = [[]];
  const warnings = new Set<string>();
  let line = '';
  let heading = '';
  let headingLevel: number | null = null;
  let skip: string | null = null;
  let inHead = false;
  let inTitle = false;
  let title = '';
  let listDepth = 0;
  let tags = 0;
  let sawActive = false;
  let sawMedia = false;
  let sawLink = false;
  let sawTable = false;

  const current = () => sections[sections.length - 1];
  const flushLine = () => {
    const value = collapse(line);
    line = '';
    if (!value || headingLevel !== null) return;
    current().push(listDepth > 0 ? `- ${value}` : value);
  };
  const commitHeading = (level: number) => {
    const value = collapse(heading);
    heading = '';
    headingLevel = null;
    if (!value) return;
    if (current().length) sections.push([]);
    current().push(`${'#'.repeat(level)} ${value}`);
  };

  const onStart = (tag: Tag) => {
    if (tag.name === 'script' || tag.name === 'style' || tag.name === 'iframe' || tag.name === 'object' || tag.name === 'embed' || tag.name === 'applet') sawActive = true;
    if (tag.name === 'img' || tag.name === 'image' || tag.name === 'audio' || tag.name === 'video' || tag.name === 'source') {
      sawMedia = true;
      const alt = quotedAttr(tag.raw, 'alt');
      if (alt && headingLevel === null) {
        flushLine();
        current().push(`[image: ${collapse(alt)}]`);
      }
      return;
    }
    if (tag.name === 'a') sawLink = true;
    if (tag.name === 'table') sawTable = true;
    if (SKIP.has(tag.name)) {
      if (!tag.closing && !tag.selfClosing) skip = tag.name;
      return;
    }
    if (tag.name === 'head') {
      flushLine();
      inHead = true;
      return;
    }
    if (tag.name === 'title') {
      inTitle = true;
      return;
    }
    if (/^h[1-6]$/.test(tag.name)) {
      flushLine();
      headingLevel = Number(tag.name.slice(1));
      heading = '';
      if (tag.selfClosing) commitHeading(headingLevel);
      return;
    }
    if (tag.name === 'li') listDepth++;
    if (tag.name === 'br' || tag.name === 'p' || tag.name === 'div' || tag.name === 'tr' || tag.name === 'td' || tag.name === 'th' || tag.name === 'blockquote' || tag.name === 'section' || tag.name === 'li') flushLine();
  };

  const onEnd = (tag: Tag) => {
    if (skip) {
      if (tag.name === skip) skip = null;
      return;
    }
    if (tag.name === 'title') {
      inTitle = false;
      return;
    }
    if (tag.name === 'head') {
      inHead = false;
      return;
    }
    if (/^h[1-6]$/.test(tag.name) && headingLevel !== null) {
      commitHeading(headingLevel);
      return;
    }
    if (tag.name === 'li') {
      flushLine();
      listDepth = Math.max(0, listDepth - 1);
      return;
    }
    if (tag.name === 'p' || tag.name === 'div' || tag.name === 'tr' || tag.name === 'td' || tag.name === 'th' || tag.name === 'blockquote' || tag.name === 'section') flushLine();
  };

  let i = 0;
  while (i < source.length) {
    if (source.startsWith('<!--', i)) {
      const close = source.indexOf('-->', i + 4);
      if (close < 0) throw new Error('This HTML export has an unclosed comment.');
      i = close + 3;
      continue;
    }
    if (source.startsWith('<!', i) || source.startsWith('<?', i)) {
      const close = source.indexOf('>', i + 2);
      if (close < 0) throw new Error('This HTML export has an unclosed declaration.');
      i = close + 1;
      continue;
    }
    if (source[i] === '<') {
      const tag = readTag(source, i);
      tags++;
      if (tags > MAX_TAGS) throw new Error('This HTML export has too many tags to import safely.');
      if (skip) {
        if (tag.closing) onEnd(tag);
      } else if (tag.closing) onEnd(tag);
      else onStart(tag);
      i = tag.next;
      continue;
    }
    const next = source.indexOf('<', i);
    const chunk = source.slice(i, next < 0 ? source.length : next);
    i = next < 0 ? source.length : next;
    if (skip) continue;
    if (inTitle) {
      title += chunk;
      continue;
    }
    if (inHead) continue;
    if (headingLevel !== null) heading += chunk;
    else line += chunk;
  }
  if (skip) throw new Error('This HTML export has an unclosed script, style, or embedded object.');
  flushLine();
  if (headingLevel !== null) commitHeading(headingLevel);

  if (sawActive) warnings.add('Scripts, styles, and active content were removed and were not run.');
  if (sawMedia) warnings.add('Images, drawings, audio, and video were left out. Their files were not fetched or copied.');
  if (sawLink) warnings.add('Links stay as visible text. Their targets were not opened or fetched.');
  if (sawTable) warnings.add('Tables were flattened into text.');
  const cleanedTitle = collapse(title);
  return { title: cleanedTitle || null, sections: sections.filter((section) => section.some((item) => item.trim())), warnings };
}

import type { PdfDocument } from './document.ts';
import { binaryString, dict, Lexer, name, num, stringBytes, type PdfDict } from './syntax.ts';

export interface DecodedText {
  text: string;
  /** Codes this font could not map to Unicode. Reported, never guessed. */
  unknown: number;
}

export interface FontDecoder {
  decode(bytes: Uint8Array): DecodedText;
}

const CP1252_HIGH: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018,
  0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

// Mac OS Roman, bytes 0x80–0xFF.
const MAC_ROMAN =
  'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';

// Adobe glyph names that /Differences commonly uses for text.
const GLYPHS: Record<string, string> = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&',
  quotesingle: "'", quoteright: '’', quoteleft: '‘', parenleft: '(', parenright: ')', asterisk: '*', plus: '+',
  comma: ',', hyphen: '-', minus: '−', period: '.', slash: '/', colon: ':', semicolon: ';', less: '<',
  equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']',
  asciicircum: '^', underscore: '_', grave: '`', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  bullet: '•', endash: '–', emdash: '—', quotedblleft: '“', quotedblright: '”', ellipsis: '…',
  fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl', degree: '°', copyright: '©', registered: '®',
  trademark: '™', section: '§', paragraph: '¶', dagger: '†', daggerdbl: '‡', multiply: '×', divide: '÷',
  eacute: 'é', egrave: 'è', ecircumflex: 'ê', aacute: 'á', agrave: 'à', ccedilla: 'ç', udieresis: 'ü',
  odieresis: 'ö', adieresis: 'ä', germandbls: 'ß', ntilde: 'ñ', nbspace: ' ', periodcentered: '·',
};

function glyphToUnicode(glyph: string): string | null {
  if (glyph in GLYPHS) return GLYPHS[glyph];
  if (/^[A-Za-z]$/.test(glyph)) return glyph;
  const uni = /^uni([0-9A-Fa-f]{4})+$/.exec(glyph);
  if (uni) return glyph.slice(3).match(/.{4}/g)!.map((hex) => String.fromCharCode(parseInt(hex, 16))).join('');
  const u = /^u([0-9A-Fa-f]{4,6})$/.exec(glyph);
  if (u) return String.fromCodePoint(parseInt(u[1], 16));
  return null;
}

function baseTable(encoding: string | null): (string | null)[] {
  const table: (string | null)[] = new Array(256).fill(null);
  for (let code = 0x20; code < 0x7f; code += 1) table[code] = String.fromCharCode(code);
  if (encoding === 'MacRomanEncoding') {
    for (let i = 0; i < MAC_ROMAN.length; i += 1) table[0x80 + i] = MAC_ROMAN[i];
    return table;
  }
  if (encoding === 'StandardEncoding') {
    table[0x27] = '’';
    table[0x60] = '‘';
    return table;
  }
  for (let code = 0x80; code <= 0xff; code += 1) {
    const mapped = CP1252_HIGH[code];
    if (mapped) table[code] = String.fromCharCode(mapped);
    else if (code >= 0xa0) table[code] = String.fromCharCode(code);
  }
  return table;
}

function utf16be(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  return out;
}

function codeOf(bytes: Uint8Array): number {
  let value = 0;
  for (const byte of bytes) value = value * 256 + byte;
  return value;
}

/** Parses the bfchar/bfrange and codespace sections of a ToUnicode CMap. */
export function parseToUnicode(cmap: string): { map: Map<string, string>; widths: number[] } {
  const map = new Map<string, string>();
  const widths = new Set<number>();
  const lexer = new Lexer(cmap);
  const strings = (count: number) => {
    const out: Uint8Array[] = [];
    for (let i = 0; i < count; i += 1) {
      const token = lexer.next();
      if (token.type !== 'value') return null;
      const bytes = stringBytes(token.value);
      if (!bytes) return null;
      out.push(bytes);
    }
    return out;
  };
  let guard = 0;
  for (;;) {
    if ((guard += 1) > 200_000) break;
    const token = lexer.next();
    if (token.type === 'eof') break;
    if (token.type !== 'op') continue;
    if (token.op === 'begincodespacerange') {
      for (;;) {
        const pair = strings(2);
        if (!pair) break;
        widths.add(pair[0].length);
      }
    } else if (token.op === 'beginbfchar') {
      for (;;) {
        const pair = strings(2);
        if (!pair) break;
        map.set(`${pair[0].length}:${codeOf(pair[0])}`, utf16be(pair[1]));
        widths.add(pair[0].length);
      }
    } else if (token.op === 'beginbfrange') {
      for (;;) {
        const range = strings(2);
        if (!range) break;
        const [lo, hi] = range;
        const length = lo.length;
        widths.add(length);
        const start = codeOf(lo);
        const end = Math.min(codeOf(hi), start + 65_535);
        const target = lexer.next();
        if (target.type !== 'value') break;
        const dst = stringBytes(target.value);
        if (dst) {
          const base = Array.from(dst);
          for (let code = start; code <= end; code += 1) {
            const offset = code - start;
            const bytes = Uint8Array.from(base);
            const last = bytes.length - 1;
            if (last >= 1) {
              const value = ((bytes[last - 1] << 8) | bytes[last]) + offset;
              bytes[last - 1] = (value >> 8) & 0xff;
              bytes[last] = value & 0xff;
            }
            map.set(`${length}:${code}`, utf16be(bytes));
          }
        } else if (Array.isArray(target.value)) {
          target.value.forEach((item, index) => {
            const bytes = stringBytes(item);
            if (bytes && start + index <= end) map.set(`${length}:${start + index}`, utf16be(bytes));
          });
        }
      }
    }
  }
  return { map, widths: [...widths].filter((width) => width >= 1 && width <= 4).sort((a, b) => b - a) };
}

/** Builds the decoder for one font resource. */
export async function fontDecoder(doc: PdfDocument, fontValue: PdfDict | null): Promise<FontDecoder> {
  const font = fontValue;
  const subtype = name(font?.entries.get('Subtype'));
  const composite = subtype === 'Type0';
  let toUnicode: { map: Map<string, string>; widths: number[] } | null = null;
  try {
    const cmapBytes = await doc.streamBytes(font?.entries.get('ToUnicode'));
    if (cmapBytes) toUnicode = parseToUnicode(binaryString(cmapBytes));
  } catch {
    toUnicode = null;
  }

  if (toUnicode && toUnicode.map.size) {
    const widths = toUnicode.widths.length ? toUnicode.widths : [composite ? 2 : 1];
    const map = toUnicode.map;
    return {
      decode(bytes) {
        let text = '';
        let unknown = 0;
        for (let i = 0; i < bytes.length; ) {
          let matched = false;
          for (const width of widths) {
            if (i + width > bytes.length) continue;
            const hit = map.get(`${width}:${codeOf(bytes.subarray(i, i + width))}`);
            if (hit !== undefined) {
              text += hit;
              i += width;
              matched = true;
              break;
            }
          }
          if (!matched) {
            unknown += 1;
            i += widths[widths.length - 1];
          }
        }
        return { text, unknown };
      },
    };
  }

  if (composite) {
    // Identity-H and similar CID fonts carry glyph ids, not characters.
    return { decode: (bytes) => ({ text: '', unknown: Math.ceil(bytes.length / 2) }) };
  }

  const encodingValue = doc.resolve(font?.entries.get('Encoding'));
  const encodingDict = dict(encodingValue);
  const table = baseTable(name(encodingValue) ?? name(encodingDict?.entries.get('BaseEncoding')));
  const differences = doc.resolve(encodingDict?.entries.get('Differences'));
  if (Array.isArray(differences)) {
    let code = 0;
    for (const item of differences) {
      const at = num(item);
      if (at !== null) {
        code = at;
        continue;
      }
      const glyph = name(item);
      if (glyph !== null && code >= 0 && code < 256) {
        table[code] = glyphToUnicode(glyph);
        code += 1;
      }
    }
  }
  const symbolic = /Symbol|Dingbats/i.test(name(font?.entries.get('BaseFont')) ?? '');
  return {
    decode(bytes) {
      if (symbolic) return { text: '', unknown: bytes.length };
      let text = '';
      let unknown = 0;
      for (const byte of bytes) {
        const mapped = table[byte];
        if (mapped === null) {
          if (byte === 0x0a || byte === 0x0d || byte === 0x09) text += ' ';
          else unknown += 1;
        } else text += mapped;
      }
      return { text, unknown };
    },
  };
}

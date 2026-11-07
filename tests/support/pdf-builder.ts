import { deflateSync } from 'node:zlib';

/**
 * Builds small, valid PDFs for tests. Synthetic only: these are not exports
 * from GoodNotes, OneNote or Freeform.
 */
export class PdfBuilder {
  private readonly bodies: (Buffer | null)[] = [];
  private tail: Buffer[] = [];

  /** Reserves an object number; fill it later with `set`. */
  reserve(): number {
    this.bodies.push(null);
    return this.bodies.length;
  }

  set(num: number, body: string | Buffer): number {
    this.bodies[num - 1] = typeof body === 'string' ? Buffer.from(body, 'latin1') : body;
    return num;
  }

  add(body: string | Buffer): number {
    return this.set(this.reserve(), body);
  }

  /** A stream object. `compress` applies FlateDecode with a real zlib stream. */
  stream(dict: string, data: string | Buffer, compress = false): number {
    const raw = typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
    const bytes = compress ? deflateSync(raw) : raw;
    const filter = compress ? ' /Filter /FlateDecode' : '';
    return this.add(Buffer.concat([
      Buffer.from(`<< ${dict}${filter} /Length ${bytes.length} >>\nstream\n`, 'latin1'),
      bytes,
      Buffer.from('\nendstream', 'latin1'),
    ]));
  }

  /** Raw bytes appended after the main body (an incremental update, garbage…). */
  append(text: string | Buffer): void {
    this.tail.push(typeof text === 'string' ? Buffer.from(text, 'latin1') : text);
  }

  build(trailer: string, { brokenXref = false } = {}): Uint8Array {
    const parts: Buffer[] = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    const offsets: number[] = [];
    let at = parts[0].length;
    this.bodies.forEach((body, index) => {
      if (!body) throw new Error(`object ${index + 1} was reserved but not set`);
      const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
      offsets.push(brokenXref ? 9 : at);
      parts.push(chunk);
      at += chunk.length;
    });
    const xref = [`xref\n0 ${this.bodies.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    parts.push(Buffer.from(`${xref}trailer\n<< /Size ${this.bodies.length + 1} ${trailer} >>\nstartxref\n${at}\n%%EOF\n`, 'latin1'));
    parts.push(...this.tail);
    return new Uint8Array(Buffer.concat(parts));
  }
}

/** Escapes text for a PDF literal string. */
export function lit(text: string): string {
  return `(${text.replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

export const HELVETICA = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

/** A one-font document with one page per content string. Returns the builder too. */
export function simplePdf(pages: string[], opts: { compress?: boolean; title?: string } = {}): Uint8Array {
  const b = new PdfBuilder();
  const font = b.add(HELVETICA);
  const pagesId = b.reserve();
  const kids = pages.map((content) => {
    const contentId = b.stream('', content, opts.compress);
    return b.add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
  });
  b.set(pagesId, `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  const catalog = b.add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const info = opts.title ? b.add(`<< /Title ${lit(opts.title)} >>`) : null;
  return b.build(`/Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ''}`);
}

/** Text lines drawn the way most writers do: one BT block, Td between lines. */
export function lines(...text: string[]): string {
  return `BT /F1 12 Tf 72 720 Td ${text.map((t, i) => `${i ? '0 -14 Td ' : ''}${lit(t)} Tj`).join(' ')} ET`;
}

export const BOARD_WIDTH = 1000;
export const BOARD_HEIGHT = 700;

export type Point = [number, number];
export type BoardItem =
  | { id: string; kind: 'text'; x: number; y: number; text: string }
  | { id: string; kind: 'rect' | 'ellipse' | 'arrow'; x: number; y: number; width: number; height: number }
  | { id: string; kind: 'pencil'; points: Point[] };

export interface Board {
  roomId: string;
  revision: number;
  items: BoardItem[];
  updatedAt: number;
}

const inBounds = (x: unknown, y: unknown): boolean =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= BOARD_WIDTH &&
  typeof y === 'number' && Number.isFinite(y) && y >= 0 && y <= BOARD_HEIGHT;

export function validBoardItems(value: unknown): value is BoardItem[] {
  if (!Array.isArray(value) || value.length > 500) return false;
  const ids = new Set<string>();
  return value.every((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const v = item as Record<string, unknown>;
    if (typeof v.id !== 'string' || !v.id || v.id.length > 64 || ids.has(v.id)) return false;
    ids.add(v.id);
    if (v.kind === 'text') return inBounds(v.x, v.y) && typeof v.text === 'string' && v.text.trim().length > 0 && v.text.length <= 500;
    if (v.kind === 'pencil') return Array.isArray(v.points) && v.points.length > 0 && v.points.length <= 5000 &&
      v.points.every((p: unknown) => Array.isArray(p) && p.length === 2 && inBounds(p[0], p[1]));
    if (v.kind === 'rect' || v.kind === 'ellipse' || v.kind === 'arrow') return inBounds(v.x, v.y) &&
      typeof v.width === 'number' && typeof v.height === 'number' &&
      inBounds((v.x as number) + v.width, (v.y as number) + v.height) &&
      (Math.abs(v.width) >= 3 || Math.abs(v.height) >= 3);
    return false;
  });
}

export function boardToNote(items: readonly BoardItem[]): string {
  const lines = items.flatMap((item) => item.kind === 'text' ? [item.text.trim()] : []);
  const counts = { rect: 0, ellipse: 0, arrow: 0, pencil: 0 };
  for (const item of items) if (item.kind !== 'text') counts[item.kind]++;
  const drawing = Object.entries(counts).filter(([, count]) => count).map(([kind, count]) => `${count} ${kind}${count === 1 ? '' : 's'}`);
  return ['Whiteboard notes', ...lines, drawing.length ? `Drawing: ${drawing.join(', ')}.` : ''].filter(Boolean).join('\n\n');
}

import type { CanvasTransform, WhiteboardElement } from './types';

export function screenToBoard(
  screenX: number,
  screenY: number,
  transform: CanvasTransform,
): [number, number] {
  return [
    (screenX - transform.offsetX) / transform.scale,
    (screenY - transform.offsetY) / transform.scale,
  ];
}

export function boardToScreen(
  boardX: number,
  boardY: number,
  transform: CanvasTransform,
): [number, number] {
  return [
    boardX * transform.scale + transform.offsetX,
    boardY * transform.scale + transform.offsetY,
  ];
}

export function pointsToPath(points: [number, number][]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const [x, y] = points[0];
    return `M ${x} ${y} L ${x} ${y}`;
  }
  const [first, ...rest] = points;
  const parts = [`M ${first[0]} ${first[1]}`];
  for (const [x, y] of rest) {
    parts.push(`L ${x} ${y}`);
  }
  return parts.join(' ');
}

export function smoothPath(points: [number, number][]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const [x, y] = points[0];
    return `M ${x} ${y} L ${x + 0.1} ${y + 0.1}`;
  }
  if (points.length === 2) {
    return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`;
  }
  const [first] = points;
  const parts = [`M ${first[0]} ${first[1]}`];
  for (let i = 1; i < points.length - 1; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const cpx = (x0 + x1) / 2;
    const cpy = (y0 + y1) / 2;
    const cpx2 = (x1 + x2) / 2;
    const cpy2 = (y1 + y2) / 2;
    parts.push(`Q ${x1} ${y1} ${cpx2} ${cpy2}`);
    void cpx;
    void cpy;
  }
  const last = points[points.length - 1];
  parts.push(`L ${last[0]} ${last[1]}`);
  return parts.join(' ');
}

export function arrowHeadPoints(
  from: [number, number],
  to: [number, number],
  size = 12,
): string {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const angle = Math.atan2(dy, dx);
  const spread = Math.PI / 7;
  const ax = to[0] - size * Math.cos(angle - spread);
  const ay = to[1] - size * Math.sin(angle - spread);
  const bx = to[0] - size * Math.cos(angle + spread);
  const by = to[1] - size * Math.sin(angle + spread);
  return `${ax},${ay} ${to[0]},${to[1]} ${bx},${by}`;
}

export function elementBounds(el: WhiteboardElement): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  if (el.type === 'freedraw' || el.type === 'line' || el.type === 'arrow') {
    if (el.points.length === 0) return { x: el.x, y: el.y, w: 0, h: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [px, py] of el.points) {
      minX = Math.min(minX, el.x + px);
      minY = Math.min(minY, el.y + py);
      maxX = Math.max(maxX, el.x + px);
      maxY = Math.max(maxY, el.y + py);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return { x: el.x, y: el.y, w: (el as { width: number }).width, h: (el as { height: number }).height };
}

export function hitTest(
  el: WhiteboardElement,
  bx: number,
  by: number,
  threshold = 8,
): boolean {
  const bounds = elementBounds(el);
  return (
    bx >= bounds.x - threshold &&
    bx <= bounds.x + bounds.w + threshold &&
    by >= bounds.y - threshold &&
    by <= bounds.y + bounds.h + threshold
  );
}

let _idCounter = 0;
export function newId(): string {
  return `el-${Date.now()}-${++_idCounter}`;
}

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
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const cpx2 = (x1 + x2) / 2;
    const cpy2 = (y1 + y2) / 2;
    parts.push(`Q ${x1} ${y1} ${cpx2} ${cpy2}`);
  }
  const last = points[points.length - 1];
  parts.push(`L ${last[0]} ${last[1]}`);
  return parts.join(' ');
}

/** Diamond SVG polygon points string given bounding box top-left + size. */
export function diamondPoints(x: number, y: number, w: number, h: number): string {
  const ax = Math.abs(w);
  const ay = Math.abs(h);
  const ox = w < 0 ? x + w : x;
  const oy = h < 0 ? y + h : y;
  const cx = ox + ax / 2;
  const cy = oy + ay / 2;
  return `${cx},${oy} ${ox + ax},${cy} ${cx},${oy + ay} ${ox},${cy}`;
}

/** Curved arrow path: slight quadratic arc perpendicular to the midpoint. */
export function curvedArrowPath(
  from: [number, number],
  to: [number, number],
): string {
  const mx = (from[0] + to[0]) / 2;
  const my = (from[1] + to[1]) / 2;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return `M ${from[0]} ${from[1]} L ${to[0]} ${to[1]}`;
  // Offset control point perpendicular to the line, scaled to 15% of length
  const perp = 0.15;
  const cpx = mx - dy * perp;
  const cpy = my + dx * perp;
  return `M ${from[0]} ${from[1]} Q ${cpx} ${cpy} ${to[0]} ${to[1]}`;
}

/** Arrow head polygon points string. */
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
  const e = el as { x: number; y: number; width: number; height: number };
  const x = e.width < 0 ? e.x + e.width : e.x;
  const y = e.height < 0 ? e.y + e.height : e.y;
  return { x, y, w: Math.abs(e.width), h: Math.abs(e.height) };
}

export function hitTest(
  el: WhiteboardElement,
  bx: number,
  by: number,
  threshold = 8,
): boolean {
  const bounds = elementBounds(el);
  const inBox =
    bx >= bounds.x - threshold &&
    bx <= bounds.x + bounds.w + threshold &&
    by >= bounds.y - threshold &&
    by <= bounds.y + bounds.h + threshold;
  if (!inBox) return false;

  // Diamond needs a tighter check: point-in-diamond
  if (el.type === 'diamond') {
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    const hw = bounds.w / 2 + threshold;
    const hh = bounds.h / 2 + threshold;
    if (hw === 0 || hh === 0) return false;
    return Math.abs(bx - cx) / hw + Math.abs(by - cy) / hh <= 1;
  }

  return true;
}

/** Move an element by (dx, dy) in board space. */
export function moveElement(el: WhiteboardElement, dx: number, dy: number): WhiteboardElement {
  if (el.type === 'freedraw' || el.type === 'line' || el.type === 'arrow') {
    return { ...el, x: el.x + dx, y: el.y + dy };
  }
  return { ...el, x: el.x + dx, y: el.y + dy };
}

let _idCounter = 0;
export function newId(): string {
  return `el-${Date.now()}-${++_idCounter}`;
}

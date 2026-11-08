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
  return { ...el, x: el.x + dx, y: el.y + dy };
}

let _idCounter = 0;
export function newId(): string {
  return `el-${Date.now()}-${++_idCounter}`;
}

'use no memo';

import { PanResponder, type PanResponderInstance } from 'react-native';

import { boardToScreen, hitTest, moveElement, newId, screenToBoard } from './geometry';
import type { ElementStyle } from './StylePanel';
import type {
  ArrowElement,
  CanvasTransform,
  DiamondElement,
  EllipseElement,
  FreedrawElement,
  LineElement,
  RectangleElement,
  TextElement,
  Tool,
  WhiteboardElement,
} from './types';

export type TextEditState = {
  id: string;
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  value: string;
  /** True when editing an existing text element (update), false when creating new. */
  isEditing: boolean;
};

type DragState = {
  id: string;
  /** Board position at pointer-down — never updated. */
  initialBx: number;
  initialBy: number;
  /** Original element position at pointer-down — never updated. */
  origEl: WhiteboardElement;
  /** True once we've moved past DRAG_THRESHOLD. */
  isDragging: boolean;
};

const MIN_SCALE = 0.1;
const MAX_SCALE = 20;
const DRAG_THRESHOLD = 4;
const DOUBLE_TAP_MS = 300;

type Refs = {
  transformRef: React.RefObject<CanvasTransform>;
  elementsRef: React.RefObject<WhiteboardElement[]>;
  toolRef: React.RefObject<Tool>;
  currentStyleRef: React.RefObject<ElementStyle>;
  selectedIdRef: React.RefObject<string | null>;
  drawingRef: React.MutableRefObject<WhiteboardElement | null>;
  dragRef: React.MutableRefObject<DragState | null>;
  lastTapRef: React.MutableRefObject<{ time: number; id: string | null } | null>;
  panStartRef: React.MutableRefObject<{ ox: number; oy: number; tx: number; ty: number } | null>;
  pinchRef: React.MutableRefObject<{ dist: number; scale: number; ox: number; oy: number } | null>;
  pushHistoryRef: React.RefObject<(els: WhiteboardElement[]) => void>;
  setSelectedIdRef: React.RefObject<(id: string | null) => void>;
  setTextEditRef: React.RefObject<(state: TextEditState) => void>;
  setTransform: (t: CanvasTransform) => void;
  setElements: React.Dispatch<React.SetStateAction<WhiteboardElement[]>>;
  canvasOriginRef: React.RefObject<{ x: number; y: number }>;
};

export function createWhiteboardPanResponder(refs: Refs): PanResponderInstance {
  // Subtract canvas DOM offset so coords are canvas-relative (fixes web cursor drift)
  function toCanvasXY(px: number, py: number): [number, number] {
    const o = refs.canvasOriginRef.current ?? { x: 0, y: 0 };
    return [px - o.x, py - o.y];
  }
  // Convert board coords to screen coords relative to the root View (for TextInput placement)
  function boardToRootScreen(bx: number, by: number, t: { offsetX: number; offsetY: number; scale: number }): [number, number] {
    const o = refs.canvasOriginRef.current ?? { x: 0, y: 0 };
    return [bx * t.scale + t.offsetX + o.x, by * t.scale + t.offsetY + o.y];
  }

  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,

    onPanResponderGrant: (evt) => {
      const { nativeEvent } = evt;
      const t = refs.transformRef.current!;

      if (nativeEvent.touches && nativeEvent.touches.length === 2) {
        const [t1, t2] = nativeEvent.touches;
        const [t1x, t1y] = toCanvasXY(t1.pageX, t1.pageY);
        const [t2x, t2y] = toCanvasXY(t2.pageX, t2.pageY);
        const dx = t1x - t2x;
        const dy = t1y - t2y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        refs.pinchRef.current = { dist, scale: t.scale, ox: t.offsetX, oy: t.offsetY };
        refs.panStartRef.current = null;
        return;
      }

      const [sx, sy] = toCanvasXY(nativeEvent.pageX, nativeEvent.pageY);
      const [bx, by] = screenToBoard(sx, sy, t);
      const activeTool = refs.toolRef.current!;
      const style = refs.currentStyleRef.current!;

      if (activeTool === 'hand') {
        refs.panStartRef.current = { ox: sx, oy: sy, tx: t.offsetX, ty: t.offsetY };
        return;
      }

      if (activeTool === 'select') {
        const hit = [...refs.elementsRef.current!].reverse().find((el) => hitTest(el, bx, by));
        const now = Date.now();
        const last = refs.lastTapRef.current;

        // Double-tap on a text element → edit it
        if (
          hit?.type === 'text' &&
          last?.id === hit.id &&
          now - last.time < DOUBLE_TAP_MS
        ) {
          refs.lastTapRef.current = null;
          const el = hit as TextElement;
          const [sxEl, syEl] = boardToRootScreen(el.x, el.y, t);
          refs.setTextEditRef.current!({
            id: el.id,
            x: el.x,
            y: el.y,
            screenX: sxEl,
            screenY: syEl,
            value: el.text,
            isEditing: true,
          });
          refs.dragRef.current = null;
          return;
        }

        // Double-tap on a shape → open text label editor centered on the shape
        if (
          hit &&
          hit.type !== 'text' &&
          hit.type !== 'freedraw' &&
          last?.id === hit.id &&
          now - last.time < DOUBLE_TAP_MS
        ) {
          refs.lastTapRef.current = null;
          const labelId = `${hit.id}__label`;
          const existing = refs.elementsRef.current!.find((e) => e.id === labelId) as TextElement | undefined;
          let cx = hit.x, cy = hit.y;
          if ('width' in hit && 'height' in hit) {
            const w = hit.width as number;
            const h = hit.height as number;
            cx = (w < 0 ? hit.x + w : hit.x) + Math.abs(w) / 2;
            cy = (h < 0 ? hit.y + h : hit.y) + Math.abs(h) / 2;
          }
          const [sxLabel, syLabel] = boardToRootScreen(cx, cy, t);
          refs.setTextEditRef.current!({
            id: labelId,
            x: cx,
            y: cy,
            screenX: sxLabel,
            screenY: syLabel,
            value: existing?.text ?? '',
            isEditing: Boolean(existing),
          });
          refs.dragRef.current = null;
          return;
        }

        refs.lastTapRef.current = { time: now, id: hit?.id ?? null };

        if (hit) {
          refs.setSelectedIdRef.current!(hit.id);
          refs.dragRef.current = { id: hit.id, initialBx: bx, initialBy: by, origEl: hit, isDragging: false };
        } else {
          refs.setSelectedIdRef.current!(null);
          refs.dragRef.current = null;
        }
        return;
      }

      if (activeTool === 'text') return;

      const id = newId();
      const base = {
        id,
        x: bx,
        y: by,
        angle: 0,
        strokeColor: style.strokeColor,
        backgroundColor: style.backgroundColor,
        strokeWidth: style.strokeWidth,
        strokeStyle: style.strokeStyle,
        opacity: 1,
        roughness: style.roughness,
        fillStyle: style.fillStyle,
      };

      let el: WhiteboardElement | null = null;
      if (activeTool === 'freedraw') {
        el = { ...base, type: 'freedraw', points: [[0, 0]], width: 0, height: 0 };
      } else if (activeTool === 'rectangle') {
        el = { ...base, type: 'rectangle', width: 0, height: 0 };
      } else if (activeTool === 'diamond') {
        el = { ...base, type: 'diamond', width: 0, height: 0 };
      } else if (activeTool === 'ellipse') {
        el = { ...base, type: 'ellipse', width: 0, height: 0 };
      } else if (activeTool === 'line') {
        el = { ...base, type: 'line', points: [[0, 0], [0, 0]] };
      } else if (activeTool === 'arrow') {
        el = { ...base, type: 'arrow', points: [[0, 0], [0, 0]] };
      }

      if (el) {
        refs.drawingRef.current = el;
        refs.setElements((prev) => [...prev, el!]);
      }
    },

    onPanResponderMove: (evt) => {
      const { nativeEvent } = evt;
      const t = refs.transformRef.current!;

      if (nativeEvent.touches && nativeEvent.touches.length === 2 && refs.pinchRef.current) {
        const [t1, t2] = nativeEvent.touches;
        const [t1x, t1y] = toCanvasXY(t1.pageX, t1.pageY);
        const [t2x, t2y] = toCanvasXY(t2.pageX, t2.pageY);
        const dx = t1x - t2x;
        const dy = t1y - t2y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const scaleFactor = dist / refs.pinchRef.current.dist;
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, refs.pinchRef.current.scale * scaleFactor));
        const mx = (t1x + t2x) / 2;
        const my = (t1y + t2y) / 2;
        const newOffsetX = mx - (mx - refs.pinchRef.current.ox) * (newScale / refs.pinchRef.current.scale);
        const newOffsetY = my - (my - refs.pinchRef.current.oy) * (newScale / refs.pinchRef.current.scale);
        const next = { offsetX: newOffsetX, offsetY: newOffsetY, scale: newScale };
        refs.transformRef.current = next;
        refs.setTransform(next);
        return;
      }

      const [sx, sy] = toCanvasXY(nativeEvent.pageX, nativeEvent.pageY);

      if (refs.toolRef.current === 'hand' && refs.panStartRef.current) {
        const { ox, oy, tx, ty } = refs.panStartRef.current;
        const next = { ...t, offsetX: tx + (sx - ox), offsetY: ty + (sy - oy) };
        refs.transformRef.current = next;
        refs.setTransform(next);
        return;
      }

      if (refs.toolRef.current === 'select' && refs.dragRef.current) {
        const [bx, by] = screenToBoard(sx, sy, t);
        const { initialBx, initialBy, origEl, isDragging } = refs.dragRef.current;
        const totalDx = bx - initialBx;
        const totalDy = by - initialBy;
        if (!isDragging && Math.abs(totalDx) < DRAG_THRESHOLD && Math.abs(totalDy) < DRAG_THRESHOLD) {
          return;
        }
        refs.dragRef.current = { ...refs.dragRef.current, isDragging: true };
        const moved = moveElement(origEl, totalDx, totalDy);
        refs.elementsRef.current = refs.elementsRef.current!.map((e) => (e.id === moved.id ? moved : e));
        refs.setElements((prev) => prev.map((e) => (e.id === moved.id ? moved : e)));
        return;
      }

      if (!refs.drawingRef.current) return;
      const [bx, by] = screenToBoard(sx, sy, t);
      const el = refs.drawingRef.current;

      if (el.type === 'freedraw') {
        const updated: FreedrawElement = { ...el, points: [...el.points, [bx - el.x, by - el.y]] };
        refs.drawingRef.current = updated;
        refs.setElements((prev) => prev.map((e) => (e.id === el.id ? updated : e)));
      } else if (el.type === 'rectangle') {
        const updated: RectangleElement = { ...el, width: bx - el.x, height: by - el.y };
        refs.drawingRef.current = updated;
        refs.setElements((prev) => prev.map((e) => (e.id === el.id ? updated : e)));
      } else if (el.type === 'diamond') {
        const updated: DiamondElement = { ...el, width: bx - el.x, height: by - el.y };
        refs.drawingRef.current = updated;
        refs.setElements((prev) => prev.map((e) => (e.id === el.id ? updated : e)));
      } else if (el.type === 'ellipse') {
        const updated: EllipseElement = { ...el, width: bx - el.x, height: by - el.y };
        refs.drawingRef.current = updated;
        refs.setElements((prev) => prev.map((e) => (e.id === el.id ? updated : e)));
      } else if (el.type === 'line' || el.type === 'arrow') {
        const updated = { ...el, points: [[0, 0], [bx - el.x, by - el.y]] } as LineElement | ArrowElement;
        refs.drawingRef.current = updated;
        refs.setElements((prev) => prev.map((e) => (e.id === el.id ? updated : e)));
      }
    },

    onPanResponderRelease: (evt) => {
      const { nativeEvent } = evt;
      refs.pinchRef.current = null;
      refs.panStartRef.current = null;

      if (refs.toolRef.current === 'select' && refs.dragRef.current) {
        const { id, isDragging } = refs.dragRef.current;
        refs.dragRef.current = null;
        if (!isDragging) return;
        const finalEl = refs.elementsRef.current!.find((e) => e.id === id);
        if (finalEl) {
          refs.pushHistoryRef.current!([
            ...refs.elementsRef.current!.filter((e) => e.id !== id),
            finalEl,
          ]);
        }
        return;
      }

      if (refs.toolRef.current === 'text') {
        const t = refs.transformRef.current!;
        const [sx, sy] = toCanvasXY(nativeEvent.pageX, nativeEvent.pageY);
        const [bx, by] = screenToBoard(sx, sy, t);
        // If tapping on an existing text element, edit it instead of creating new
        const hit = [...refs.elementsRef.current!].reverse().find((el) => hitTest(el, bx, by));
        if (hit?.type === 'text') {
          const el = hit as TextElement;
          const [sxEl, syEl] = boardToRootScreen(el.x, el.y, t);
          refs.setTextEditRef.current!({
            id: el.id,
            x: el.x,
            y: el.y,
            screenX: sxEl,
            screenY: syEl,
            value: el.text,
            isEditing: true,
          });
        } else {
          const o = refs.canvasOriginRef.current ?? { x: 0, y: 0 };
          refs.setTextEditRef.current!({
            id: newId(),
            x: bx,
            y: by,
            screenX: sx + o.x,
            screenY: sy + o.y,
            value: '',
            isEditing: false,
          });
        }
        return;
      }

      if (refs.drawingRef.current) {
        const el = refs.drawingRef.current;
        refs.drawingRef.current = null;
        refs.pushHistoryRef.current!([...refs.elementsRef.current!.filter((e) => e.id !== el.id), el]);
      }
    },
  });
}

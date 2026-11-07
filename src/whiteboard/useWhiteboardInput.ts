'use no memo';

import { PanResponder, type PanResponderInstance } from 'react-native';

import { hitTest, newId, screenToBoard } from './geometry';
import type {
  ArrowElement,
  CanvasTransform,
  EllipseElement,
  FreedrawElement,
  LineElement,
  RectangleElement,
  Tool,
  WhiteboardElement,
} from './types';
import type { ElementStyle } from './StylePanel';

export type TextEditState = {
  id: string;
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  value: string;
};

const MIN_SCALE = 0.1;
const MAX_SCALE = 20;

type Refs = {
  transformRef: React.RefObject<CanvasTransform>;
  elementsRef: React.RefObject<WhiteboardElement[]>;
  toolRef: React.RefObject<Tool>;
  currentStyleRef: React.RefObject<ElementStyle>;
  drawingRef: React.MutableRefObject<WhiteboardElement | null>;
  panStartRef: React.MutableRefObject<{ ox: number; oy: number; tx: number; ty: number } | null>;
  pinchRef: React.MutableRefObject<{
    dist: number;
    scale: number;
    ox: number;
    oy: number;
  } | null>;
  pushHistoryRef: React.RefObject<(els: WhiteboardElement[]) => void>;
  setSelectedIdRef: React.RefObject<(id: string | null) => void>;
  setTextEditRef: React.RefObject<(state: TextEditState) => void>;
  setTransform: (t: CanvasTransform) => void;
  setElements: React.Dispatch<React.SetStateAction<WhiteboardElement[]>>;
};

export function createWhiteboardPanResponder(refs: Refs): PanResponderInstance {
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,

    onPanResponderGrant: (evt) => {
      const { nativeEvent } = evt;
      const t = refs.transformRef.current!;

      if (nativeEvent.touches && nativeEvent.touches.length === 2) {
        const [t1, t2] = nativeEvent.touches;
        const dx = t1.pageX - t2.pageX;
        const dy = t1.pageY - t2.pageY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        refs.pinchRef.current = { dist, scale: t.scale, ox: t.offsetX, oy: t.offsetY };
        refs.panStartRef.current = null;
        return;
      }

      const sx = nativeEvent.pageX;
      const sy = nativeEvent.pageY;
      const [bx, by] = screenToBoard(sx, sy, t);
      const activeTool = refs.toolRef.current!;
      const style = refs.currentStyleRef.current!;

      if (activeTool === 'hand') {
        refs.panStartRef.current = { ox: sx, oy: sy, tx: t.offsetX, ty: t.offsetY };
        return;
      }

      if (activeTool === 'select') {
        const hit = [...refs.elementsRef.current!].reverse().find((el) => hitTest(el, bx, by));
        refs.setSelectedIdRef.current!(hit?.id ?? null);
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
      };

      let el: WhiteboardElement | null = null;
      if (activeTool === 'freedraw') {
        el = { ...base, type: 'freedraw', points: [[0, 0]], width: 0, height: 0 };
      } else if (activeTool === 'rectangle') {
        el = { ...base, type: 'rectangle', width: 0, height: 0 };
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
        const dx = t1.pageX - t2.pageX;
        const dy = t1.pageY - t2.pageY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const scaleFactor = dist / refs.pinchRef.current.dist;
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, refs.pinchRef.current.scale * scaleFactor));
        const mx = (t1.pageX + t2.pageX) / 2;
        const my = (t1.pageY + t2.pageY) / 2;
        const newOffsetX = mx - (mx - refs.pinchRef.current.ox) * (newScale / refs.pinchRef.current.scale);
        const newOffsetY = my - (my - refs.pinchRef.current.oy) * (newScale / refs.pinchRef.current.scale);
        const next = { offsetX: newOffsetX, offsetY: newOffsetY, scale: newScale };
        refs.transformRef.current = next;
        refs.setTransform(next);
        return;
      }

      const sx = nativeEvent.pageX;
      const sy = nativeEvent.pageY;

      if (refs.toolRef.current === 'hand' && refs.panStartRef.current) {
        const { ox, oy, tx, ty } = refs.panStartRef.current;
        const next = { ...t, offsetX: tx + (sx - ox), offsetY: ty + (sy - oy) };
        refs.transformRef.current = next;
        refs.setTransform(next);
        return;
      }

      if (!refs.drawingRef.current) return;
      const [bx, by] = screenToBoard(sx, sy, t);
      const el = refs.drawingRef.current;

      if (el.type === 'freedraw') {
        const updated: FreedrawElement = {
          ...el,
          points: [...el.points, [bx - el.x, by - el.y]],
        };
        refs.drawingRef.current = updated;
        refs.setElements((prev) => prev.map((e) => (e.id === el.id ? updated : e)));
      } else if (el.type === 'rectangle') {
        const updated: RectangleElement = { ...el, width: bx - el.x, height: by - el.y };
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

      if (refs.toolRef.current === 'text') {
        const t = refs.transformRef.current!;
        const sx = nativeEvent.pageX;
        const sy = nativeEvent.pageY;
        const [bx, by] = screenToBoard(sx, sy, t);
        refs.setTextEditRef.current!({ id: newId(), x: bx, y: by, screenX: sx, screenY: sy, value: '' });
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

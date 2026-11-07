import { useState } from 'react';
import { Text, View } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import {
  BOARD_SPACE,
  STROKE_WIDTH,
  fittedBoardSize,
  type BoardPoint,
  type ViewSize,
} from './contract';
import type { BoardStroke } from './session';

type GesturePhase = 'down' | 'move' | 'up' | 'cancel';

interface LocalPoint {
  x: number;
  y: number;
}

type PointerNative = {
  locationX?: number;
  locationY?: number;
  offsetX?: number;
  offsetY?: number;
  pointerId?: number;
};

/**
 * One room's drawing surface. Pointer positions are reported in this view's
 * coordinates; the screen converts them with `appendPointerSample`.
 * Native pointer delivery was not exercised on a device in this change.
 */
export function BoardCanvas({
  strokes,
  draft,
  interactive,
  onGesture,
}: {
  strokes: readonly BoardStroke[];
  draft: readonly BoardPoint[];
  interactive: boolean;
  onGesture: (phase: GesturePhase, local: LocalPoint | null, view: ViewSize | null) => void;
}) {
  const theme = useStoneTheme();
  const [bounds, setBounds] = useState<ViewSize | null>(null);
  const [view, setView] = useState<ViewSize | null>(null);
  const fitted = bounds ? fittedBoardSize(bounds) : null;
  const ink = theme.color.text.primary;
  const empty = strokes.length === 0 && draft.length === 0;

  function emit(phase: GesturePhase, native?: PointerNative, target?: unknown) {
    if (!interactive) return;
    const size = view;
    if (phase === 'up' || phase === 'cancel') {
      onGesture(phase, null, size);
      return;
    }
    if (!native || !size) return;
    if (phase === 'down') capturePointer(target, native.pointerId);
    const local = localPoint(native, target);
    if (!local) return;
    onGesture(phase, local, size);
  }

  return (
    <View
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setBounds({ width, height });
      }}
    >
      {fitted ? (
        <View
          style={{
            width: fitted.width,
            height: fitted.height,
            backgroundColor: theme.color.bg.surface,
            borderColor: theme.color.border.strong,
            borderRadius: theme.radius.card,
            borderWidth: 1,
            overflow: 'hidden',
          }}
        >
        <View
          ref={attachCanvas}
          accessibilityLabel="Whiteboard canvas"
          testID="whiteboard-canvas"
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setView({ width, height });
          }}
          onPointerDown={(event) => emit('down', event.nativeEvent, event.currentTarget)}
          onPointerMove={(event) => emit('move', event.nativeEvent, event.currentTarget)}
          onPointerUp={() => emit('up')}
          onPointerCancel={() => emit('cancel')}
          style={{ flex: 1, cursor: 'pointer' }}
        >
          {view ? strokes.map((stroke) => (
            <StrokeMark key={stroke.id} points={stroke.points} width={stroke.width} color={ink} view={view} />
          )) : null}
          {view && draft.length > 0 ? <StrokeMark points={draft} width={STROKE_WIDTH} color={ink} view={view} /> : null}
          {empty ? (
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', padding: theme.space.section }}>
              <Text style={[theme.text('body'), { color: theme.color.text.secondary, textAlign: 'center' }]}>
                Draw on this board. A stroke is saved when you lift the pointer.
              </Text>
            </View>
          ) : null}
        </View>
        </View>
      ) : null}
    </View>
  );
}

function StrokeMark({
  points,
  width,
  color,
  view,
}: {
  points: readonly BoardPoint[];
  width: number;
  color: string;
  view: ViewSize;
}) {
  const thickness = Math.max(3, (width / BOARD_SPACE.width) * view.width);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
      {points.map((point, index) => {
        const at = project(point, view);
        return (
          <View
            key={`joint-${index}`}
            style={{
              position: 'absolute',
              left: at.x - thickness / 2,
              top: at.y - thickness / 2,
              width: thickness,
              height: thickness,
              borderRadius: thickness / 2,
              backgroundColor: color,
            }}
          />
        );
      })}
      {points.slice(1).map((point, index) => {
        const start = project(points[index], view);
        const end = project(point, view);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy);
        if (length === 0) return null;
        return (
          <View
            key={`${index}-${point[0]}-${point[1]}`}
            style={{
              position: 'absolute',
              left: (start.x + end.x) / 2 - length / 2,
              top: (start.y + end.y) / 2 - thickness / 2,
              width: length,
              height: thickness,
              borderRadius: thickness / 2,
              backgroundColor: color,
              transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
            }}
          />
        );
      })}
    </View>
  );
}

function project(point: BoardPoint, view: ViewSize): { x: number; y: number } {
  return {
    x: (point[0] / BOARD_SPACE.width) * view.width,
    y: (point[1] / BOARD_SPACE.height) * view.height,
  };
}

function localPoint(native: PointerNative, target?: unknown): LocalPoint | null {
  const x = typeof native.locationX === 'number' ? native.locationX : native.offsetX;
  const y = typeof native.locationY === 'number' ? native.locationY : native.offsetY;
  if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  const clientX = (native as { clientX?: number }).clientX;
  const clientY = (native as { clientY?: number }).clientY;
  const node = target as { getBoundingClientRect?: () => { left: number; top: number } } | null;
  if (!node?.getBoundingClientRect || typeof clientX !== 'number' || typeof clientY !== 'number') return null;
  const rect = node.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  if (!Number.isFinite(localX) || !Number.isFinite(localY)) return null;
  return { x: localX, y: localY };
}

function capturePointer(target: unknown, pointerId: number | undefined): void {
  if (pointerId == null) return;
  const node = target as { setPointerCapture?: (id: number) => void } | null;
  try {
    node?.setPointerCapture?.(pointerId);
  } catch {
    // Pointer capture is a web convenience. A miss still draws while the pointer stays over the board.
  }
}

function attachCanvas(node: unknown): void {
  if (typeof node === 'object' && node !== null && 'style' in node) {
    const style = (node as { style?: { touchAction?: string } }).style;
    if (style) style.touchAction = 'none';
  }
}

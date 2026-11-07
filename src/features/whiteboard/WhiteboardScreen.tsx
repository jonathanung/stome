import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PanResponder,
  Pressable,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle, Defs, Path, Pattern, Rect } from 'react-native-svg';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import { Icon, type IconName } from '../../ui/Icon';
import type { BoardCheck, BoardStroke, InkColor, WhiteboardTool } from './types';

const TOOLS: { tool: WhiteboardTool; icon: IconName; label: string }[] = [
  { tool: 'hand', icon: 'hand', label: 'Hand, pan with finger' },
  { tool: 'pen', icon: 'pen', label: 'Pen' },
  { tool: 'highlighter', icon: 'highlighter', label: 'Highlighter' },
  { tool: 'lasso', icon: 'lasso', label: 'Lasso' },
  { tool: 'eraser', icon: 'eraser', label: 'Eraser' },
  { tool: 'sticky', icon: 'sticky', label: 'Sticky note' },
];

const INKS: { ink: InkColor; label: string }[] = [
  { ink: 'stone', label: 'Stone ink' },
  { ink: 'rust', label: 'Rust ink' },
  { ink: 'moss', label: 'Moss ink' },
  { ink: 'lichen', label: 'Lichen ink' },
];

/** Smooth a point list into an SVG path (midpoint quadratic curves). */
export function strokePath(points: [number, number][]): string {
  if (points.length === 0) return '';
  const [x0, y0] = points[0];
  if (points.length === 1) return `M${x0} ${y0}l0.01 0`;
  let d = `M${x0} ${y0}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    d += `Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const [lx, ly] = points[points.length - 1];
  return `${d}L${lx} ${ly}`;
}

/** iOS reports touchType on the native event; anything else (mouse, web) draws. */
function isFinger(e: GestureResponderEvent): boolean {
  return (e.nativeEvent as { touchType?: string }).touchType === 'direct';
}

class GestureState {
  tool: WhiteboardTool = 'pen';
  ink: InkColor = 'stone';
  pan = { x: 0, y: 0 };
  panning = false;
  panOrigin = { x: 0, y: 0 };
  live: BoardStroke | null = null;
  nextId = 0;

  sync(tool: WhiteboardTool, ink: InkColor, pan: { x: number; y: number }) {
    this.tool = tool;
    this.ink = ink;
    this.pan = pan;
  }
}

function createBoardResponder(
  g: GestureState,
  out: {
    setLive: (s: BoardStroke | null) => void;
    setPan: (p: { x: number; y: number }) => void;
    commit: (s: BoardStroke) => void;
  },
) {
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const { locationX, locationY } = e.nativeEvent;
      g.panning = g.tool === 'hand' || isFinger(e);
      if (g.panning) {
        g.panOrigin = g.pan;
        return;
      }
      if (g.tool !== 'pen' && g.tool !== 'highlighter') return;
      g.live = {
        id: `s${g.nextId++}`,
        tool: g.tool,
        ink: g.ink,
        points: [[locationX - g.pan.x, locationY - g.pan.y]],
      };
      out.setLive(g.live);
    },
    onPanResponderMove: (e, d) => {
      if (g.panning) {
        out.setPan({ x: g.panOrigin.x + d.dx, y: g.panOrigin.y + d.dy });
        return;
      }
      if (!g.live) return;
      g.live = {
        ...g.live,
        points: [...g.live.points, [e.nativeEvent.locationX - g.pan.x, e.nativeEvent.locationY - g.pan.y]],
      };
      out.setLive(g.live);
    },
    onPanResponderRelease: () => {
      const s = g.live;
      g.live = null;
      out.setLive(null);
      if (s) out.commit(s);
    },
    onPanResponderTerminate: () => {
      g.live = null;
      out.setLive(null);
    },
  });
}

export function WhiteboardScreen({ check = null }: { check?: BoardCheck | null }) {
  const theme = useStoneTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const [tool, setTool] = useState<WhiteboardTool>('pen');
  const [ink, setInk] = useState<InkColor>('stone');
  const [strokes, setStrokes] = useState<BoardStroke[]>([]);
  const [redo, setRedo] = useState<BoardStroke[]>([]);
  const [live, setLive] = useState<BoardStroke | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [noteDismissed, setNoteDismissed] = useState(false);
  const [gesture] = useState(() => new GestureState());
  useEffect(() => {
    gesture.sync(tool, ink, pan);
  }, [gesture, tool, ink, pan]);

  const inkColor = useMemo<Record<InkColor, string>>(
    () => ({
      stone: theme.color.text.primary,
      rust: theme.color.status.danger.fill,
      moss: theme.color.status.success.fill,
      lichen: theme.color.status.warning.fill,
    }),
    [theme],
  );

  const [responder] = useState(() =>
    createBoardResponder(gesture, {
      setLive,
      setPan,
      commit: (stroke) => {
        setStrokes((prev) => [...prev, stroke]);
        setRedo([]);
      },
    }),
  );

  const undo = useCallback(() => {
    setStrokes((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      setRedo((r) => [...r, last]);
      return prev.slice(0, -1);
    });
  }, []);
  const redoStroke = useCallback(() => {
    setRedo((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      setStrokes((s) => [...s, last]);
      return prev.slice(0, -1);
    });
  }, []);

  const pill: ViewStyle = {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 6,
    borderRadius: 16,
    backgroundColor: theme.color.bg.surface,
    borderWidth: 1,
    borderColor: theme.color.border.hairline,
    ...theme.shadow.float,
  };
  const iconBtn = (on: boolean): ViewStyle => ({
    width: theme.layout.control,
    height: theme.layout.control,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: on ? theme.color.accent.bg : 'transparent',
  });
  const iconColor = (on: boolean) => (on ? theme.color.accent.fg : theme.color.text.secondary);
  const all = live ? [...strokes, live] : strokes;
  const wide = width >= 700;
  const showLasso = tool === 'lasso' && strokes.length > 0;
  const showCheck = check !== null && !noteDismissed;

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg.canvas }} testID="whiteboard">
      <View style={{ flex: 1 }} {...responder.panHandlers} accessibilityLabel="Whiteboard canvas">
        <Svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }} pointerEvents="none">
          <Defs>
            <Pattern id="dots" width={24} height={24} patternUnits="userSpaceOnUse" x={pan.x % 24} y={pan.y % 24}>
              <Circle cx={2} cy={2} r={1.2} fill={theme.color.text.disabled} />
            </Pattern>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#dots)" opacity={0.55} />
        </Svg>
        <Svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }} pointerEvents="none">
          <Path d="" />
          {all.map((s) => (
            <Path
              key={s.id}
              d={strokePath(s.points)}
              transform={`translate(${pan.x} ${pan.y})`}
              fill="none"
              stroke={inkColor[s.ink]}
              strokeWidth={s.tool === 'highlighter' ? 14 : 2.6}
              strokeOpacity={s.tool === 'highlighter' ? 0.3 : 1}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </Svg>
      </View>

      <View style={[pill, { left: 20, top: 24, paddingRight: 14, paddingLeft: 4, paddingVertical: 4 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to room" onPress={() => (id ? router.replace(`/rooms/${id}`) : router.back())} style={iconBtn(false)}>
          <Icon name="chevronLeft" color={iconColor(false)} />
        </Pressable>
        <View>
          <Text style={[theme.text('actionTitle'), { color: theme.color.text.primary }]}>whiteboard</Text>
          <Text style={[theme.text('fine'), { color: theme.color.text.tertiary }]}>sketch</Text>
        </View>
      </View>

      <View style={[pill, { right: 20, top: 24 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Undo" disabled={strokes.length === 0} onPress={undo} style={[iconBtn(false), { opacity: strokes.length ? 1 : 0.4 }]}>
          <Icon name="undo" color={iconColor(false)} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Redo" disabled={redo.length === 0} onPress={redoStroke} style={[iconBtn(false), { opacity: redo.length ? 1 : 0.4 }]}>
          <Icon name="redo" color={iconColor(false)} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Ask about the board" onPress={() => id && router.push(`/rooms/${id}`)} style={iconBtn(false)}>
          <Icon name="chat" color={iconColor(false)} />
        </Pressable>
      </View>

      {showLasso ? (
        <View
          accessibilityLabel="Lasso selection"
          style={{
            position: 'absolute',
            alignSelf: 'center',
            bottom: 96,
            flexDirection: 'row',
            gap: 2,
            padding: 4,
            borderRadius: 14,
            backgroundColor: theme.color.accent.bg,
            ...theme.shadow.float,
          }}
        >
          {['check my diagram', 'clean up shapes', 'ask…'].map((label, i) => (
            <Pressable key={label} accessibilityRole="button" style={{ minHeight: theme.layout.control, paddingHorizontal: 14, justifyContent: 'center' }}>
              <Text style={{ ...theme.text(i === 0 ? 'buttonCompact' : 'nav'), fontSize: 14, color: theme.color.accent.fg }}>{label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {showCheck ? (
        <View
          accessibilityLabel="AI check"
          style={{
            position: 'absolute',
            left: Math.min(680, Math.max(20, width - 300)),
            top: 170,
            width: 280,
            gap: 8,
            paddingHorizontal: 16,
            paddingVertical: 14,
            borderRadius: 20,
            backgroundColor: theme.color.bg.surface,
            borderWidth: 1,
            borderColor: theme.color.border.hairline,
            ...theme.shadow.float,
          }}
        >
          <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999, backgroundColor: theme.color.status.danger.wash }}>
            <Text style={[theme.text('label'), { color: theme.color.status.danger.text }]}>check this</Text>
          </View>
          <Text style={[theme.text('annotation'), { color: theme.color.text.primary }]}>{check?.message}</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {check?.fix ? (
              <Pressable accessibilityRole="button" onPress={check.fix.onPress} style={{ minHeight: theme.layout.control, paddingHorizontal: 14, borderRadius: 12, justifyContent: 'center', backgroundColor: theme.color.accent.bg }}>
                <Text style={[theme.text('buttonCompact'), { color: theme.color.accent.fg }]}>{check.fix.label}</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" onPress={() => setNoteDismissed(true)} style={{ minHeight: theme.layout.control, paddingHorizontal: 14, borderRadius: 12, justifyContent: 'center', borderWidth: 1, borderColor: theme.color.border.strong }}>
              <Text style={[theme.text('nav'), { fontSize: 14, color: theme.color.text.primary }]}>dismiss</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View accessibilityRole="toolbar" accessibilityLabel="Pencil tools" style={[pill, { alignSelf: 'center', bottom: 24, paddingHorizontal: 10 }]}>
        {TOOLS.map((t) => (
          <Pressable key={t.tool} accessibilityRole="button" accessibilityLabel={t.label} accessibilityState={{ selected: tool === t.tool }} onPress={() => setTool(t.tool)} style={iconBtn(tool === t.tool)}>
            <Icon name={t.icon} color={iconColor(tool === t.tool)} />
          </Pressable>
        ))}
        <View style={{ width: 1, height: 28, marginHorizontal: 4, backgroundColor: theme.color.border.hairline }} />
        {INKS.map((c) => (
          <Pressable
            key={c.ink}
            accessibilityRole="button"
            accessibilityLabel={c.label}
            accessibilityState={{ selected: ink === c.ink }}
            hitSlop={7}
            onPress={() => setInk(c.ink)}
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              backgroundColor: inkColor[c.ink],
              borderWidth: 3,
              borderColor: theme.color.bg.surface,
              boxShadow: `0 0 0 ${ink === c.ink ? 2 : 1}px ${ink === c.ink ? inkColor[c.ink] : theme.color.border.hairline}`,
            }}
          />
        ))}
      </View>
      {wide ? (
        <Text style={[theme.text('caption'), { position: 'absolute', left: 20, bottom: 34, color: theme.color.text.tertiary }]}>
          pencil draws, finger pans. hold a stroke to snap it to a shape.
        </Text>
      ) : null}
    </View>
  );
}

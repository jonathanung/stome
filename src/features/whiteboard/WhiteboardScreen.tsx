import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View, useWindowDimensions, type GestureResponderHandlers, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Marker, Path, Pattern, Rect } from 'react-native-svg';

import { iconColor, useStoneTheme } from '../../../design-theme/src/primitives';
import { getRoom } from '../../data/queries';
import { expoDriver } from '../../db/expo-driver';
import { Icon } from '../../ui/Icon';
import { ImageProposalGlyph, ToolGlyph } from './glyphs';
import {
  SAMPLE_BOARD,
  SAMPLE_PROPOSAL,
  TOOLS,
  acceptableCount,
  acceptedItems,
  pointsToPath,
  validStroke,
  type BoardItem,
  type Point,
  type Proposal,
  type ShapeNode,
  type Tool,
} from './model';

const BOARD_W = 1440;
const BOARD_H = 900;
const COMPACT = 760;

const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);

function hit(item: BoardItem, [px, py]: Point): boolean {
  const pad = 14;
  if (item.kind === 'stroke') return item.points.some(([x, y]) => Math.hypot(x - px, y - py) < pad + 6);
  const h = item.kind === 'shape' ? item.h : item.kind === 'sticky' ? 80 : 40;
  const w = item.kind === 'shape' || item.kind === 'sticky' ? item.w : 160;
  return px >= item.x - pad && px <= item.x + w + pad && py >= item.y - pad && py <= item.y + h + pad;
}

export function WhiteboardScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const roomId = one(params.id);
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const theme = useStoneTheme();
  const { width, height } = useWindowDimensions();
  const compact = width < COMPACT;

  const [roomName, setRoomName] = useState<string | null>(null);
  const [items, setItems] = useState<BoardItem[]>(SAMPLE_BOARD);
  const [proposal, setProposal] = useState<Proposal | null>(SAMPLE_PROPOSAL);
  const [tool, setTool] = useState<Tool>('pen');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Point[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!roomId) return;
    let live = true;
    void getRoom(db, roomId).then((room) => live && setRoomName(room?.name ?? null));
    return () => {
      live = false;
    };
  }, [db, roomId]);

  // The board is laid out in a 1440x900 space; small screens scale it down but keep it legible.
  const scale = Math.min(1, Math.max(width / BOARD_W, 0.55));

  const state = useRef({ tool, scale, draft: null as Point[] | null });
  useEffect(() => {
    state.current.tool = tool;
    state.current.scale = scale;
  }, [tool, scale]);

  const [panHandlers, setPanHandlers] = useState<GestureResponderHandlers>({});
  useEffect(() => {
    const toBoard = (e: { nativeEvent: { locationX: number; locationY: number } }): Point => [
      Math.round(e.nativeEvent.locationX / state.current.scale),
      Math.round(e.nativeEvent.locationY / state.current.scale),
    ];
    const finish = () => {
      const pts = state.current.draft;
      state.current.draft = null;
      setDraft(null);
      if (!pts) return;
      const t = state.current.tool;
      if (t === 'rect') {
        const [a, b] = [pts[0], pts[pts.length - 1]];
        const w = Math.abs(b[0] - a[0]);
        const h = Math.abs(b[1] - a[1]);
        if (w < 12 || h < 12) return;
        setItems((all) => [
          ...all,
          { kind: 'shape', id: randomUUID(), x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w, h, radius: 14, title: '' },
        ]);
        return;
      }
      if (!validStroke(pts)) return;
      setItems((all) => [...all, { kind: 'stroke', id: randomUUID(), points: pts, arrow: t === 'arrow' }]);
    };
    setPanHandlers(
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const p = toBoard(e);
          const t = state.current.tool;
          if (t === 'pen' || t === 'arrow' || t === 'rect') {
            state.current.draft = [p];
            setDraft([p]);
          }
          if (t === 'select' || t === 'eraser') {
            setItems((all) => {
              const found = [...all].reverse().find((item) => hit(item, p));
              if (t === 'select') {
                setSelected(found?.id ?? null);
                return all;
              }
              return found ? all.filter((item) => item.id !== found.id) : all;
            });
          }
          if (t === 'sticky') {
            setItems((all) => [...all, { kind: 'sticky', id: randomUUID(), x: p[0], y: p[1], w: 170, text: 'new note', tilt: -1 }]);
          }
          if (t === 'text') {
            setItems((all) => [...all, { kind: 'label', id: randomUUID(), x: p[0], y: p[1], text: 'text', size: 'caption' }]);
          }
          if (t === 'image') setNotice('images are proposals only for now: the companion can suggest one, but pasting is not built yet');
        },
        onPanResponderMove: (e) => {
          const cur = state.current.draft;
          if (!cur) return;
          const p = toBoard(e);
          const t = state.current.tool;
          const next: Point[] = t === 'pen' ? [...cur, p] : [cur[0], p];
          state.current.draft = next;
          setDraft(next);
        },
        onPanResponderRelease: () => finish(),
        onPanResponderTerminate: () => finish(),
      }).panHandlers,
    );
  }, []);

  const accept = () => {
    if (!proposal) return;
    const added = acceptedItems(proposal);
    setItems((all) => [...all, ...added]);
    setProposal(null);
  };
  const toggle = (id: string) =>
    setProposal((p) => p && { ...p, items: p.items.map((it) => (it.id === id ? { ...it, checked: !it.checked } : it)) });

  const accepting = proposal ? acceptableCount(proposal) : 0;
  const success = theme.color.status.success;
  const warning = theme.color.status.warning;
  const barStyle: ViewStyle = {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
    backgroundColor: theme.color.bg.surface,
    borderWidth: 1,
    borderColor: theme.color.border.hairline,
    borderRadius: 16,
    padding: 6,
    ...theme.shadow.float,
  };
  const ink = theme.color.text.primary;
  const proposedInk = success.fill;

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg.canvas, overflow: 'hidden' }} testID="whiteboard">
      <Svg style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} pointerEvents="none" aria-hidden>
        <Defs>
          <Pattern id="dots" width={24} height={24} patternUnits="userSpaceOnUse">
            <Circle cx={2} cy={2} r={1.2} fill={theme.color.border.strong} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#dots)" opacity={0.55} />
      </Svg>

      {/* Board layer, laid out in board units and scaled as one piece. */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: BOARD_W, height: BOARD_H, transform: [{ scale }], transformOrigin: 'top left' }} pointerEvents="none">
        <Svg width={BOARD_W} height={BOARD_H} style={{ position: 'absolute', left: 0, top: 0 }}>
          <Defs>
            <Marker id="ah" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={7} markerHeight={7} orient="auto">
              <Path d="M0 0 10 5 0 10z" fill={ink} />
            </Marker>
            <Marker id="ahp" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={7} markerHeight={7} orient="auto">
              <Path d="M0 0 10 5 0 10z" fill={proposedInk} />
            </Marker>
          </Defs>
          {items.map((item) =>
            item.kind === 'stroke' ? (
              <Path
                key={item.id}
                d={pointsToPath(item.points)}
                fill="none"
                stroke={item.proposed ? proposedInk : ink}
                strokeWidth={item.proposed ? 2.4 : 2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={item.proposed ? '7 6' : undefined}
                markerEnd={item.arrow ? (item.proposed ? 'url(#ahp)' : 'url(#ah)') : undefined}
                opacity={selected === item.id ? 0.6 : 1}
              />
            ) : null,
          )}
          {draft ? (
            <Path d={pointsToPath(draft)} fill="none" stroke={ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" markerEnd={tool === 'arrow' ? 'url(#ah)' : undefined} />
          ) : null}
        </Svg>
        {items.map((item) => {
          if (item.kind === 'shape') return <ShapeView key={item.id} node={item} selected={selected === item.id} />;
          if (item.kind === 'sticky')
            return (
              <View
                key={item.id}
                style={[{ position: 'absolute', left: item.x, top: item.y, width: item.w, padding: 14, paddingHorizontal: 16, borderRadius: 6, backgroundColor: warning.wash, transform: [{ rotate: `${item.tilt}deg` }], outlineWidth: selected === item.id ? 2 : 0, outlineColor: ink }, theme.shadow.sticky]}
              >
                <Text style={[theme.text('hand'), { color: ink }]}>{item.text}</Text>
              </View>
            );
          if (item.kind === 'label')
            return (
              <Text
                key={item.id}
                style={[theme.text(item.size === 'title' ? 'handTitle' : 'handStrong'), { position: 'absolute', left: item.x, top: item.y, color: item.size === 'title' ? ink : success.text, fontSize: item.size === 'title' ? 34 : 20 }]}
              >
                {item.text}
              </Text>
            );
          return null;
        })}
        {proposal?.items.some((it) => it.kind === 'image') ? (
          <View
            style={{ position: 'absolute', left: 860, top: 420, width: 220, height: 150, borderRadius: 10, borderWidth: 2, borderStyle: 'dashed', borderColor: success.fill, backgroundColor: success.wash, opacity: 0.85, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12 }}
          >
            <ImageProposalGlyph color={success.text} />
            <Text style={[theme.text('bodySmall'), { color: success.text, fontFamily: theme.fonts.sans['600'] }]}>proposed image</Text>
            <Text style={[theme.text('fine'), { color: success.text, textAlign: 'center' }]}>mitochondrion cross-section, from lecture 7 p. 6</Text>
          </View>
        ) : null}
      </View>

      {/* Gesture surface; sits under the chrome so the bars stay tappable. */}
      <View
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
        {...panHandlers}
        accessibilityLabel="whiteboard canvas"
        testID="whiteboard-canvas"
      />

      {/* Top bar */}
      <View style={[barStyle, { left: 16, right: 16, top: 16, justifyContent: 'space-between', paddingLeft: 10 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`back to ${roomName ?? 'room'}`}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            style={{ width: theme.layout.control, height: theme.layout.control, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="chevronLeft" size={20} color={theme.color.text.secondary} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} accessibilityRole="header" style={[theme.text('actionTitle'), { color: ink }]}>
              {roomName ? `${roomName} map` : 'whiteboard'}
            </Text>
            <Text numberOfLines={1} style={[theme.text('meta'), { color: theme.color.text.tertiary }]}>
              {roomName ? `${roomName} · ` : ''}strokes save as annotations
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {compact ? null : <BarButton label="ask about selection" variant="outline" disabled={!selected} onPress={() => setNotice('asking the companion about a selection is not wired up yet')} />}
          <BarButton label="done" variant="accent" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        </View>
      </View>

      {/* Tools */}
      <View
        accessibilityRole="toolbar"
        accessibilityLabel="tools"
        style={[
          barStyle,
          compact
            ? { left: 16, right: 16, bottom: proposal ? undefined : 24, top: proposal ? Math.max(96, height - 24 - 330 - 66) : undefined, flexDirection: 'row', justifyContent: 'space-between', gap: 0 }
            : { left: 16, top: '50%', marginTop: -((TOOLS.length * 46) / 2 + 6), flexDirection: 'column', gap: 2 },
        ]}
      >
        {TOOLS.map((t) => {
          const on = tool === t.id;
          return (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              accessibilityLabel={t.label}
              accessibilityState={{ selected: on }}
              onPress={() => {
                setTool(t.id);
                setNotice(null);
                if (t.id !== 'select') setSelected(null);
              }}
              style={{ width: compact ? 40 : theme.layout.control, height: theme.layout.control, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? theme.color.accent.bg : 'transparent' }}
            >
              <ToolGlyph tool={t.id} color={iconColor(theme, on)} />
            </Pressable>
          );
        })}
      </View>

      {notice ? (
        <View style={[barStyle, { top: 84, alignSelf: 'center', left: 72, right: 72, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 8 }]} accessibilityLiveRegion="polite">
          <Text style={[theme.text('meta'), { color: theme.color.text.secondary, textAlign: 'center' }]}>{notice}</Text>
        </View>
      ) : null}

      {/* Companion proposal: nothing here is on the board until accepted. */}
      {proposal ? (
        <View
          accessibilityLabel="companion proposal"
          style={[barStyle, { right: 16, bottom: 24, width: compact ? undefined : 340, left: compact ? 16 : undefined, flexDirection: 'column', alignItems: 'stretch', gap: 10, padding: 16 }]}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>companion proposes</Text>
            <View style={{ paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999, backgroundColor: warning.wash }}>
              <Text style={[theme.text('fine'), { color: warning.text, fontFamily: theme.fonts.sans['500'] }]}>not on the board yet</Text>
            </View>
          </View>
          <Text style={[theme.text('bodySmall'), { color: ink }]}>{proposal.summary}</Text>
          <View>
            {proposal.items.map((it, i) => (
              <Pressable
                key={it.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: it.checked }}
                accessibilityLabel={it.title}
                onPress={() => toggle(it.id)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36, paddingVertical: 8, borderBottomWidth: i === proposal.items.length - 1 ? 0 : 1, borderBottomColor: theme.color.border.hairline }}
              >
                <View style={{ width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: it.checked ? theme.color.accent.bg : 'transparent', borderWidth: it.checked ? 0 : 1.5, borderColor: theme.color.border.strong }}>
                  {it.checked ? <Icon name="check" size={12} strokeWidth={3} color={theme.color.accent.fg} /> : null}
                </View>
                <Text style={[theme.text('bodySmall'), { flex: 1, color: ink }]}>{it.title}</Text>
                <Text style={[theme.text('meta'), { color: theme.color.text.tertiary }]}>{it.kind === 'strokes' ? 'strokes' : it.kind}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <BarButton label={`add ${accepting} to board`} variant="accent" disabled={accepting === 0} onPress={accept} fill />
            </View>
            <BarButton label="discard" variant="outline" onPress={() => setProposal(null)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ShapeView({ node, selected }: { node: ShapeNode; selected: boolean }) {
  const theme = useStoneTheme();
  const success = theme.color.status.success;
  const proposed = node.proposed;
  return (
    <View
      style={{
        position: 'absolute',
        left: node.x,
        top: node.y,
        width: node.w,
        height: node.h,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: node.radius,
        borderWidth: selected ? 3 : 2,
        borderStyle: proposed ? 'dashed' : 'solid',
        borderColor: proposed ? success.fill : theme.color.text.primary,
        backgroundColor: proposed ? success.wash : theme.color.bg.surface,
        opacity: proposed ? 0.9 : 1,
      }}
    >
      {node.title ? <Text style={[theme.text('button'), { color: theme.color.text.primary }]}>{node.title}</Text> : null}
      {node.caption ? <Text style={[theme.text('fine'), { color: proposed ? success.text : theme.color.text.tertiary }]}>{node.caption}</Text> : null}
    </View>
  );
}

function BarButton({
  label,
  variant,
  onPress,
  disabled = false,
}: {
  label: string;
  variant: 'accent' | 'outline';
  onPress: () => void;
  disabled?: boolean;
  fill?: boolean;
}) {
  const theme = useStoneTheme();
  const accent = variant === 'accent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: theme.layout.control,
        paddingHorizontal: 16,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: accent ? theme.color.accent.bg : 'transparent',
        borderWidth: accent ? 0 : 1,
        borderColor: theme.color.border.strong,
        opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
      })}
    >
      <Text style={[theme.text('button'), { color: accent ? theme.color.accent.fg : theme.color.text.primary }]}>{label}</Text>
    </Pressable>
  );
}

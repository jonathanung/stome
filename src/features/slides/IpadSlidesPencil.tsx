import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { PanResponder, Pressable, ScrollView, Text, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Screen, SlideFrame, useStoneTheme } from '../../../design-theme/src/primitives';
import { Icon, type IconName } from '../../ui/Icon';
import { strokePath } from '../whiteboard/IpadWhiteboardScreen';
import type { InkColor } from '../whiteboard/types';
import { SAMPLE_DECK } from './sample-deck';
import { Eyebrow, IconBtn, SlideTable } from './SlideWorkspace';
import type { SlideDeck } from './types';

type PencilTool = 'pen' | 'highlighter' | 'lasso' | 'eraser';
type Point = [number, number];
type Stroke = { id: string; page: number; tool: 'pen' | 'highlighter'; ink: InkColor; points: Point[] };
type Chunk = { id: string; page: number; label: string };

const TOOLS: { tool: PencilTool; icon: IconName; label: string }[] = [
  { tool: 'pen', icon: 'pen', label: 'pen' },
  { tool: 'highlighter', icon: 'highlighter', label: 'highlighter' },
  { tool: 'lasso', icon: 'lasso', label: 'lasso' },
  { tool: 'eraser', icon: 'eraser', label: 'eraser' },
];

const INKS: { ink: InkColor; label: string }[] = [
  { ink: 'rust', label: 'rust ink' },
  { ink: 'stone', label: 'stone ink' },
  { ink: 'lichen', label: 'lichen highlight' },
];

const ERASE_RADIUS = 14;

class GestureState {
  tool: PencilTool = 'pen';
  ink: InkColor = 'rust';
  current = 1;
  points: Point[] = [];
  id = 0;

  sync(tool: PencilTool, ink: InkColor, current: number) {
    this.tool = tool;
    this.ink = ink;
    this.current = current;
  }
}

function hitsStroke(s: Stroke, p: Point): boolean {
  return s.points.some(([x, y]) => Math.hypot(x - p[0], y - p[1]) <= ERASE_RADIUS);
}

/**
 * iPad lecture mode for the slide route (#13): slide left with pencil ink on top, notes right.
 * Reuses SlideTable from SlideWorkspace. Ink and chunks are local state until slide storage lands.
 */
export function IpadSlidesPencil({ deck = SAMPLE_DECK }: { deck?: SlideDeck }) {
  const theme = useStoneTheme();
  const [current, setCurrent] = useState(deck.pages[0]?.number ?? 1);
  const [tool, setTool] = useState<PencilTool>('pen');
  const [ink, setInk] = useState<InkColor>('rust');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [live, setLive] = useState<Stroke | null>(null);
  const [lasso, setLasso] = useState<Point[] | null>(null);
  const [region, setRegion] = useState<Point[] | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const page = deck.pages.find((p) => p.number === current);

  const inkColor: Record<InkColor, string> = {
    stone: theme.color.text.primary,
    rust: theme.color.status.danger.fill,
    moss: theme.color.status.success.fill,
    lichen: theme.color.status.warning.fill,
  };

  // The responder is created once; it reads the latest tool state through a ref.
  const [gs] = useState(() => new GestureState());
  useEffect(() => {
    gs.sync(tool, ink, current);
  }, [gs, tool, ink, current]);

  const [responder] = useState(() => {
    const at = (e: { nativeEvent: { locationX: number; locationY: number } }): Point => [e.nativeEvent.locationX, e.nativeEvent.locationY];
    const mkLive = (points: Point[]): Stroke | null => {
      const t = gs.tool;
      return t === 'pen' || t === 'highlighter' ? { id: 'live', page: gs.current, tool: t, ink: gs.ink, points } : null;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        gs.points = [at(e)];
        const t = gs.tool;
        if (t === 'lasso') {
          setRegion(null);
          setLasso(gs.points);
        } else if (t === 'eraser') {
          const p = gs.points[0];
          setStrokes((all) => all.filter((s) => s.page !== gs.current || !hitsStroke(s, p)));
        } else setLive(mkLive(gs.points));
      },
      onPanResponderMove: (e) => {
        const p = at(e);
        gs.points = [...gs.points, p];
        const t = gs.tool;
        if (t === 'lasso') setLasso(gs.points);
        else if (t === 'eraser') setStrokes((all) => all.filter((s) => s.page !== gs.current || !hitsStroke(s, p)));
        else setLive(mkLive(gs.points));
      },
      onPanResponderRelease: () => {
        const points = gs.points;
        const t = gs.tool;
        setLive(null);
        setLasso(null);
        if (t === 'lasso') {
          if (points.length > 6) setRegion(points);
        } else if (t === 'pen' || t === 'highlighter') {
          const id = `s${gs.id++}`;
          setStrokes((all) => [...all, { id, page: gs.current, tool: t, ink: gs.ink, points }]);
        }
      },
      onPanResponderTerminate: () => {
        setLive(null);
        setLasso(null);
      },
    });
  });

  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  const go = (n: number) => {
    setCurrent(Math.min(deck.pageCount, Math.max(1, n)));
    setRegion(null);
  };
  const makeChunk = () => {
    if (!region) return;
    setChunks((all) => [...all, { id: `c${all.length}`, page: current, label: `slide region · page ${current}` }]);
    setRegion(null);
  };

  const pageStrokes = strokes.filter((s) => s.page === current);
  const drawn = live ? [...pageStrokes, live] : pageStrokes;
  const pageChunks = chunks.filter((c) => c.page === current);
  const notes = page?.linkedNotes ?? [];

  const strokeEl = (s: Stroke) => (
    <Path
      key={s.id}
      d={strokePath(s.points)}
      fill="none"
      stroke={inkColor[s.ink]}
      strokeWidth={s.tool === 'highlighter' ? 14 : 2.5}
      strokeOpacity={s.tool === 'highlighter' ? 0.4 : 1}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View testID="ipad-slides-main" style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 24, paddingHorizontal: 20, paddingBottom: 10 }}>
              <IconBtn label={`back to ${deck.course}`} onPress={() => router.back()}>{(c) => <Icon name="chevronLeft" size={20} color={c} />}</IconBtn>
              <View style={{ flex: 1 }}>
                <Text accessibilityRole="header" style={[theme.text('actionTitle'), { lineHeight: 22, color: theme.color.text.primary }]}>{deck.title}</Text>
                <Text style={[theme.text('meta'), { color: theme.color.text.tertiary }]}>{`page ${current} of ${deck.pageCount} · lecture mode`}</Text>
              </View>
              <IconBtn label="previous page" disabled={current <= 1} onPress={() => go(current - 1)}>{(c) => <Icon name="chevronLeft" size={18} color={c} />}</IconBtn>
              <IconBtn label="next page" disabled={current >= deck.pageCount} onPress={() => go(current + 1)}>{(c) => <Icon name="chevronRight" size={18} color={c} />}</IconBtn>
              <IconBtn label="ask about this page" onPress={() => undefined}>{(c) => <Icon name="chat" size={20} color={c} />}</IconBtn>
            </View>

            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingLeft: 20, paddingRight: 76 }}>
              <SlideFrame>
                {page ? (
                  <View style={{ flex: 1, gap: 14 }}>
                    <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>{page.eyebrow}</Text>
                    <Text accessibilityRole="header" style={[theme.text('slideTitle'), { color: theme.paper.slideText }]}>{page.title}</Text>
                    <SlideTable page={page} selected={false} onSelect={() => undefined} />
                  </View>
                ) : (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={[theme.text('bodySmall'), { color: theme.paper.slideMuted }]}>{`page ${current} has no marks yet`}</Text>
                  </View>
                )}
                <View
                  testID="pencil-surface"
                  accessibilityLabel="pencil surface"
                  onLayout={onLayout}
                  style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
                  {...responder.panHandlers}
                >
                  <Svg width={box.w} height={box.h} pointerEvents="none">
                    {drawn.map(strokeEl)}
                    {lasso ? <Path d={strokePath(lasso)} fill="none" stroke={theme.color.text.primary} strokeWidth={1.75} strokeDasharray="4 4" /> : null}
                    {region ? <Path d={`${strokePath(region)}Z`} fill={theme.color.status.warning.wash} fillOpacity={0.5} stroke={theme.color.text.primary} strokeWidth={1.75} strokeDasharray="4 4" /> : null}
                  </Svg>
                </View>
              </SlideFrame>
            </View>

            <ScrollView horizontal accessibilityLabel="pages" contentContainerStyle={{ gap: 10, paddingTop: 10, paddingHorizontal: 20, paddingBottom: 22 }} style={{ flexGrow: 0 }}>
              {Array.from({ length: deck.pageCount }, (_, i) => i + 1).map((n) => {
                const on = n === current;
                return (
                  <Pressable
                    key={n}
                    accessibilityRole="button"
                    accessibilityLabel={`page ${n}`}
                    accessibilityState={{ selected: on }}
                    onPress={() => go(n)}
                    style={{ width: 96, aspectRatio: 16 / 9, backgroundColor: theme.paper.slide, borderWidth: 1, borderColor: theme.paper.slideBorder, borderRadius: theme.radius.thumb - 1, padding: 5, gap: 3, outlineWidth: on ? 2 : 0, outlineColor: theme.color.text.primary, outlineOffset: 2 }}
                  >
                    <View style={{ height: 3, borderRadius: 2, width: '50%', backgroundColor: theme.paper.slideMuted }} />
                    <View style={{ height: 3, borderRadius: 2, width: '78%', backgroundColor: theme.paper.slideBorder }} />
                  </Pressable>
                );
              })}
            </ScrollView>

            <View
              accessibilityRole="toolbar"
              accessibilityLabel="pencil tools"
              style={{ position: 'absolute', right: 14, top: '50%', marginTop: -150, alignItems: 'center', gap: 4, padding: 6, borderRadius: theme.radius.bubble, backgroundColor: theme.color.bg.surface, borderWidth: 1, borderColor: theme.color.border.hairline, ...theme.shadow.float }}
            >
              {TOOLS.map((t) => (
                <IconBtn key={t.tool} label={t.label} selected={tool === t.tool} onPress={() => setTool(t.tool)}>
                  {(c) => <Icon name={t.icon} size={20} color={c} />}
                </IconBtn>
              ))}
              <View style={{ height: 1, width: 28, backgroundColor: theme.color.border.hairline, marginVertical: 4 }} />
              {INKS.map((i) => (
                <Pressable
                  key={i.ink}
                  accessibilityRole="button"
                  accessibilityLabel={i.label}
                  accessibilityState={{ selected: ink === i.ink }}
                  hitSlop={8}
                  onPress={() => setInk(i.ink)}
                  style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 3, borderColor: theme.color.bg.surface, backgroundColor: inkColor[i.ink], boxShadow: `0 0 0 ${ink === i.ink ? 2 : 1}px ${ink === i.ink ? theme.color.text.primary : theme.color.border.hairline}` }}
                />
              ))}
            </View>
          </View>

          <View accessibilityLabel="notes beside the slides" style={{ width: 360, backgroundColor: theme.color.bg.surface, borderLeftWidth: 1, borderLeftColor: theme.color.border.hairline }}>
            <View style={{ paddingTop: 24, paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.color.border.hairline, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text accessibilityRole="header" style={[theme.text('actionTitle'), { lineHeight: 22, color: theme.color.text.primary }]}>{`${deck.course} notes`}</Text>
                <Text style={[theme.text('meta'), { color: theme.color.text.tertiary }]}>{`new chunks link to page ${current}`}</Text>
              </View>
              <View style={{ paddingHorizontal: 10, paddingVertical: 2, borderRadius: theme.radius.pill, backgroundColor: theme.color.status.warning.wash }}>
                <Text style={[theme.text('chip'), { color: theme.color.status.warning.text }]}>lecture</Text>
              </View>
            </View>
            <ScrollView contentContainerStyle={{ padding: 18, gap: 10 }}>
              {notes.map((note) => (
                <View key={note} style={{ padding: 14, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border.hairline, backgroundColor: theme.color.bg.surface }}>
                  <Eyebrow>{`page ${current}`}</Eyebrow>
                  <Text style={[theme.text('nav'), { fontFamily: theme.fonts.sans['400'], color: theme.color.text.primary }]}>{note}</Text>
                </View>
              ))}
              {pageChunks.map((c) => (
                <View key={c.id} testID="linked-chunk" style={{ padding: 14, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.text.primary, backgroundColor: theme.color.bg.surface }}>
                  <Eyebrow>{`page ${c.page} · linked region`}</Eyebrow>
                  <Text style={[theme.text('nav'), { fontFamily: theme.fonts.sans['400'], color: theme.color.text.primary }]}>{c.label}</Text>
                </View>
              ))}
              <Pressable
                testID="chunk-drop-zone"
                accessibilityRole="button"
                accessibilityLabel="make a chunk from the lassoed region"
                accessibilityState={{ disabled: !region }}
                onPress={makeChunk}
                style={{ padding: 14, borderRadius: theme.radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: region ? theme.color.text.primary : theme.color.border.strong, backgroundColor: region ? theme.color.status.warning.wash : undefined, alignItems: 'center' }}
              >
                <Text style={[theme.text('caption'), { textAlign: 'center', color: theme.color.text.secondary }]}>
                  {region ? 'tap to make a chunk with this region attached' : 'drag a lasso from the slide here to make a chunk with that region attached'}
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </SafeAreaView>
    </Screen>
  );
}

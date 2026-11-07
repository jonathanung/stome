import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { Screen, SlideFrame, useStoneTheme } from '../../../design-theme/src/primitives';
import { Icon } from '../../ui/Icon';
import { SAMPLE_DECK } from './sample-deck';
import { pageStatus, type SlideDeck, type SlideMark, type SlidePage } from './types';

type Tool = 'select' | 'area' | 'pen' | 'pin';

const TOOLS: { id: Tool; label: string; glyph: 'text' | 'area' | 'pen' | 'pin' }[] = [
  { id: 'select', label: 'select text', glyph: 'text' },
  { id: 'area', label: 'highlight area', glyph: 'area' },
  { id: 'pen', label: 'pen', glyph: 'pen' },
  { id: 'pin', label: 'question pin', glyph: 'pin' },
];

function ToolGlyph({ glyph, color }: { glyph: (typeof TOOLS)[number]['glyph']; color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      {glyph === 'text' ? <Path d="M8 4h3M13 4h3M12 4v16M8 20h3M13 20h3" /> : null}
      {glyph === 'area' ? <Rect x={4} y={5} width={16} height={14} rx={2} strokeDasharray="3 3" /> : null}
      {glyph === 'pen' ? <Path d="M4 20h4L19 9l-4-4L4 16z" /> : null}
      {glyph === 'pin' ? <Path d="M4 5h16v11H9l-5 4z" /> : null}
    </Svg>
  );
}

function IconBtn({ label, selected, disabled, onPress, children }: { label: string; selected?: boolean; disabled?: boolean; onPress: () => void; children: (color: string) => React.ReactNode }) {
  const theme = useStoneTheme();
  const color = selected ? theme.color.accent.fg : theme.color.text.secondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: 40,
        height: 40,
        borderRadius: theme.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: selected ? theme.color.accent.bg : 'transparent',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children(color)}
    </Pressable>
  );
}

function Eyebrow({ children }: { children: string }) {
  const theme = useStoneTheme();
  return <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>{children}</Text>;
}

function StatusDot({ status }: { status: ReturnType<typeof pageStatus> }) {
  const theme = useStoneTheme();
  if (status === 'none') return null;
  const fill = status === 'answered' ? theme.color.status.success.fill : theme.color.status.warning.fill;
  return <View style={{ position: 'absolute', right: 3, top: 3, width: 7, height: 7, borderRadius: 2, backgroundColor: fill }} />;
}

function Thumbs({ deck, current, onPick }: { deck: SlideDeck; current: number; onPick: (n: number) => void }) {
  const theme = useStoneTheme();
  const numbers = Array.from({ length: deck.pageCount }, (_, i) => i + 1);
  return (
    <View style={{ width: theme.layout.thumbs, borderRightWidth: 1, borderRightColor: theme.color.border.hairline, padding: 14 }}>
      <Eyebrow>{`${deck.pageCount} pages`}</Eyebrow>
      <ScrollView contentContainerStyle={{ gap: 10, paddingTop: 10 }}>
        {numbers.map((n) => {
          const on = n === current;
          const page = deck.pages.find((p) => p.number === n);
          return (
            <Pressable key={n} accessibilityRole="button" accessibilityLabel={`page ${n}`} accessibilityState={{ selected: on }} onPress={() => onPick(n)} style={{ flexDirection: 'row', gap: 6 }}>
              <Text style={[theme.text('label'), { width: 18, textAlign: 'right', paddingTop: 2, color: on ? theme.color.text.primary : theme.color.text.tertiary }]}>{n}</Text>
              <View
                style={{
                  flex: 1,
                  aspectRatio: 16 / 9,
                  backgroundColor: theme.paper.slide,
                  borderWidth: 1,
                  borderColor: theme.paper.slideBorder,
                  borderRadius: theme.radius.thumb - 1,
                  padding: 6,
                  gap: 3,
                  outlineWidth: on ? 2 : 0,
                  outlineColor: theme.color.text.primary,
                  outlineOffset: 2,
                }}
              >
                <View style={{ height: 3, borderRadius: 2, width: '50%', backgroundColor: theme.paper.slideMuted }} />
                <View style={{ height: 3, borderRadius: 2, width: '78%', backgroundColor: theme.paper.slideBorder }} />
                <StatusDot status={pageStatus(page)} />
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function SlideTable({ page, onSelect, selected }: { page: SlidePage; onSelect: () => void; selected: boolean }) {
  const theme = useStoneTheme();
  return (
    <View style={{ flex: 1 }}>
      {page.table.map((row, r) => (
        <View key={r} style={{ flex: 1, flexDirection: 'row' }}>
          {row.map((cell, c) => {
            const header = r === 0 || c === 0;
            const [first, ...rest] = cell.text.split('\n');
            const questioned = cell.mark === 'question';
            const body = (
              <Text style={[theme.text('slideBody'), { color: header ? theme.paper.slideMuted : theme.paper.slideText }, header && { fontFamily: theme.fonts.sans['600'] }]}>
                {cell.strong ? <Text style={{ fontFamily: theme.fonts.sans['700'], fontSize: 15 }}>{first}{rest.length ? '\n' : ''}</Text> : `${first}${rest.length ? '\n' : ''}`}
                {rest.map((line, i) => (
                  <Text
                    key={i}
                    onPress={r === 1 && c === 1 && i === 0 ? onSelect : undefined}
                    style={r === 1 && c === 1 && selected ? { backgroundColor: 'rgba(51,48,42,0.16)' } : undefined}
                  >
                    {line}
                    {i < rest.length - 1 ? '\n' : ''}
                  </Text>
                ))}
              </Text>
            );
            return (
              <View
                key={c}
                style={{
                  flex: c === 0 ? 0.8 : 1,
                  borderWidth: 1,
                  borderColor: theme.paper.slideBorder,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  backgroundColor: questioned ? 'rgba(226,212,168,0.9)' : header ? theme.paper.slideHeader : undefined,
                  ...(questioned ? { borderColor: theme.color.status.warning.fill, borderWidth: 2 } : null),
                }}
              >
                {body}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function SelectionPopover({ onAsk, onHighlight, onChunk }: { onAsk: () => void; onHighlight: () => void; onChunk: () => void }) {
  const theme = useStoneTheme();
  const actions = [
    { label: 'ask', onPress: onAsk, strong: true },
    { label: 'highlight', onPress: onHighlight },
    { label: 'make a chunk', onPress: onChunk },
  ];
  return (
    <View
      accessibilityLabel="selected text"
      style={{ position: 'absolute', left: '34%', top: '38%', flexDirection: 'row', gap: 2, padding: 4, borderRadius: theme.radius.control, backgroundColor: theme.color.accent.bg, ...theme.shadow.float }}
    >
      {actions.map((a) => (
        <Pressable key={a.label} accessibilityRole="button" onPress={a.onPress} style={{ minHeight: 36, paddingHorizontal: 10, borderRadius: 9, justifyContent: 'center' }}>
          <Text style={[theme.text('meta'), { color: theme.color.accent.fg, fontFamily: theme.fonts.sans[a.strong ? '600' : '500'] }]}>{a.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function MarkItem({ mark }: { mark: SlideMark }) {
  const theme = useStoneTheme();
  const pinned = mark.kind === 'pinned-answer';
  const s = theme.color.status;
  return (
    <View style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: theme.radius.lg, backgroundColor: pinned ? s.success.wash : theme.color.bg.canvas }}>
      <View style={{ width: 22, height: 22, borderRadius: theme.radius.tile, alignItems: 'center', justifyContent: 'center', backgroundColor: pinned ? s.success.fill : s.warning.fill }}>
        {pinned ? (
          <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={theme.color.text.onFill} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M12 17v5" />
            <Path d="M9 3h6l-1 6 3 3H7l3-3z" />
          </Svg>
        ) : (
          <Text style={{ fontFamily: theme.fonts.sans['700'], fontSize: 12, color: theme.color.text.onFill }}>?</Text>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[theme.text('meta'), { color: pinned ? s.success.text : theme.color.text.tertiary }]}>{mark.caption}</Text>
        <Text style={[theme.text('nav'), { fontFamily: theme.fonts.sans['400'], color: theme.color.text.primary }]}>{mark.body}</Text>
      </View>
    </View>
  );
}

function SidePanel({ page, wide, onAsk }: { page: SlidePage; wide: boolean; onAsk: () => void }) {
  const theme = useStoneTheme();
  const chip = (label: string, onPress: () => void) => (
    <Pressable key={label} accessibilityRole="button" onPress={onPress} style={{ minHeight: theme.layout.chip, paddingHorizontal: 12, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.border.hairline, backgroundColor: theme.color.bg.surface, justifyContent: 'center' }}>
      <Text style={[theme.text('chip'), { color: theme.color.text.secondary }]}>{label}</Text>
    </Pressable>
  );
  return (
    <View
      accessibilityLabel="this page"
      style={{
        width: wide ? 340 : undefined,
        backgroundColor: theme.color.bg.surface,
        ...(wide ? { borderLeftWidth: 1 } : { borderTopWidth: 1 }),
        borderColor: theme.color.border.hairline,
      }}
    >
      <View style={{ paddingVertical: 16, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: theme.color.border.hairline }}>
        <Text accessibilityRole="header" style={[theme.text('actionTitle'), { lineHeight: 22, color: theme.color.text.primary }]}>{`page ${page.number}`}</Text>
        <Text style={[theme.text('meta'), { color: theme.color.text.tertiary }]}>{`${page.marks.length} marks · ${page.chunks} chunk`}</Text>
      </View>
      <View style={{ padding: 18, gap: 10 }}>
        <Eyebrow>your marks</Eyebrow>
        {page.marks.map((m) => <MarkItem key={m.id} mark={m} />)}
        {page.linkedNotes.length ? <View style={{ marginTop: 8 }}><Eyebrow>linked notes</Eyebrow></View> : null}
        {page.linkedNotes.map((note) => (
          <View key={note} style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: theme.radius.lg, backgroundColor: theme.color.bg.canvas }}>
            <Icon name="note" size={18} color={theme.color.text.primary} />
            <Text style={[theme.text('nav'), { flex: 1, fontFamily: theme.fonts.sans['400'], color: theme.color.text.primary }]}>{note}</Text>
          </View>
        ))}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {chip('ask about this page', onAsk)}
          {chip('chunk every page', () => undefined)}
        </View>
        <View style={{ marginTop: 16, padding: 12, borderRadius: theme.radius.lg, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.color.border.strong }}>
          <Text style={[theme.text('caption'), { color: theme.color.text.secondary }]}>got a .pptx? export it as pdf first. fonts and animations may shift.</Text>
        </View>
      </View>
    </View>
  );
}

/** Slide viewer with per-page marks (#13). Renders against SlideDeck; see ./types. */
export function SlideWorkspace({ deck = SAMPLE_DECK }: { deck?: SlideDeck }) {
  const theme = useStoneTheme();
  const { width } = useWindowDimensions();
  const showThumbs = width > 1180;
  const wide = width > 820;
  const [current, setCurrent] = useState(deck.pages[0]?.number ?? 1);
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState(true);
  const page = deck.pages.find((p) => p.number === current);

  const go = (n: number) => {
    setCurrent(Math.min(deck.pageCount, Math.max(1, n)));
    setSelected(false);
  };
  const dismiss = () => setSelected(false);

  const viewer = (
    <View style={{ flex: wide ? 1 : undefined, minWidth: 0 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12, paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: theme.color.border.hairline }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Rooms" onPress={() => router.back()} hitSlop={8}>
          <Icon name="chevronLeft" size={20} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 160 }}>
          <Text accessibilityRole="header" style={[theme.text('actionTitle'), { lineHeight: 22, color: theme.color.text.primary }]}>{deck.title}</Text>
          <Text style={[theme.text('caption'), { color: theme.color.text.tertiary }]}>{`${deck.course} · imported from ${deck.source} · your marks sit on top, the file is untouched`}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <IconBtn label="previous page" disabled={current <= 1} onPress={() => go(current - 1)}>{(c) => <Icon name="chevronLeft" size={18} color={c} />}</IconBtn>
          <Text style={[theme.text('caption'), { minWidth: 64, textAlign: 'center', color: theme.color.text.tertiary, fontVariant: ['tabular-nums'] }]}>{`${current} / ${deck.pageCount}`}</Text>
          <IconBtn label="next page" disabled={current >= deck.pageCount} onPress={() => go(current + 1)}>{(c) => <Icon name="chevronRight" size={18} color={c} />}</IconBtn>
          <View style={{ width: 1, height: 24, backgroundColor: theme.color.border.hairline, marginHorizontal: 6 }} />
          <Text style={[theme.text('caption'), { color: theme.color.text.tertiary }]}>fit width</Text>
        </View>
      </View>

      <View style={{ flex: wide ? 1 : undefined, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <SlideFrame>
          {page ? (
            <View style={{ flex: 1, gap: 18 }}>
              <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>{page.eyebrow}</Text>
              <Text accessibilityRole="header" style={[theme.text('slideTitle'), { color: theme.paper.slideText }]}>{page.title}</Text>
              <SlideTable page={page} selected={selected} onSelect={() => setSelected((s) => !s)} />
              <View accessibilityLabel="highlight with a question" style={{ position: 'absolute', right: 18, bottom: 74, width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: theme.paper.slide, backgroundColor: theme.color.status.warning.fill, alignItems: 'center', justifyContent: 'center', ...theme.shadow.card }}>
                <Text style={{ fontFamily: theme.fonts.sans['700'], fontSize: 12, color: theme.color.text.onFill }}>?</Text>
              </View>
              {selected && tool === 'select' ? <SelectionPopover onAsk={dismiss} onHighlight={dismiss} onChunk={dismiss} /> : null}
            </View>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={[theme.text('bodySmall'), { color: theme.paper.slideMuted }]}>{`page ${current} has no marks yet`}</Text>
            </View>
          )}
        </SlideFrame>
      </View>

      <View style={{ alignItems: 'center', paddingHorizontal: 24, paddingBottom: 20 }}>
        <View accessibilityRole="toolbar" accessibilityLabel="mark this page" style={{ flexDirection: 'row', gap: 4, padding: 6, borderRadius: theme.radius.bubble, backgroundColor: theme.color.bg.surface, borderWidth: 1, borderColor: theme.color.border.hairline, ...theme.shadow.card }}>
          {TOOLS.map((t) => (
            <IconBtn key={t.id} label={t.label} selected={tool === t.id} onPress={() => setTool(t.id)}>
              {(c) => <ToolGlyph glyph={t.glyph} color={c} />}
            </IconBtn>
          ))}
        </View>
      </View>
    </View>
  );

  const side = page ? <SidePanel page={page} wide={wide} onAsk={() => setTool('pin')} /> : null;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        {wide ? (
          <View style={{ flex: 1, flexDirection: 'row' }}>
            {showThumbs ? <Thumbs deck={deck} current={current} onPick={go} /> : null}
            {viewer}
            {side}
          </View>
        ) : (
          <ScrollView>
            {viewer}
            {side}
          </ScrollView>
        )}
      </SafeAreaView>
    </Screen>
  );
}

import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import { Icon, type IconName } from '../../ui/Icon';
import { SAMPLE_DECK, clampPage, type PageNote, type SlideDeck, type SlidePage } from './slide-deck';

const DOTS = 5;

function IconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress?: () => void }) {
  const theme = useStoneTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: theme.layout.control,
        height: theme.layout.control,
        borderRadius: theme.radius.control,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={20} color={theme.color.text.secondary} />
    </Pressable>
  );
}

function SlideCard({ slide }: { slide: SlidePage }) {
  const theme = useStoneTheme();
  const hair = theme.color.border.hairline;
  return (
    <View
      style={{
        width: '100%',
        aspectRatio: 16 / 9,
        backgroundColor: theme.color.text.onFill,
        borderRadius: 8,
        paddingVertical: theme.space.xl,
        paddingHorizontal: theme.space.xxl,
        gap: theme.space.sm,
        ...theme.shadow.float,
      }}
    >
      <Text style={{ ...theme.text('eyebrow'), fontSize: 7, lineHeight: 9, letterSpacing: 0.6, color: theme.color.text.tertiary }}>
        {slide.eyebrow}
      </Text>
      <Text style={{ ...theme.text('slideTitle'), fontSize: 14, lineHeight: 17, color: theme.color.text.primary }}>
        {slide.title}
      </Text>
      <View style={{ flex: 1 }}>
        {slide.rows.map((row, r) => (
          <View key={r} style={{ flex: 1, flexDirection: 'row' }}>
            {row.map((cell, c) => (
              <View
                key={c}
                style={{
                  flex: c === 0 ? 0.8 : 1,
                  borderWidth: 1,
                  borderColor: hair,
                  paddingVertical: 5,
                  paddingHorizontal: 6,
                  marginLeft: c === 0 ? 0 : -1,
                  marginTop: r === 0 ? 0 : -1,
                  backgroundColor: cell.header ? theme.color.bg.alt : cell.flagged ? theme.color.status.warning.wash : 'transparent',
                  ...(cell.flagged ? { borderColor: theme.color.status.warning.fill, borderWidth: 1.5 } : null),
                }}
              >
                <Text
                  style={{
                    ...theme.text('label'),
                    fontSize: 9,
                    lineHeight: 12,
                    color: cell.header ? theme.color.text.secondary : theme.color.text.primary,
                    ...(cell.header ? theme.text('eyebrow') : null),
                    ...(cell.header ? { fontSize: 8, lineHeight: 11, letterSpacing: 0 } : null),
                  }}
                >
                  {cell.bold ? <Text style={{ ...theme.text('eyebrow'), fontSize: 9, lineHeight: 12, letterSpacing: 0 }}>{cell.bold + '\n'}</Text> : null}
                  {cell.text}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
      {slide.questionPin ? (
        <View
          accessibilityRole="image"
          accessibilityLabel="question mark on this area"
          style={{
            position: 'absolute',
            right: 6,
            bottom: 6,
            width: 20,
            height: 20,
            borderRadius: 999,
            backgroundColor: theme.color.status.warning.fill,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ ...theme.text('eyebrow'), fontSize: 11, lineHeight: 14, letterSpacing: 0, color: theme.color.text.onFill }}>?</Text>
        </View>
      ) : null}
    </View>
  );
}

function PageDots({ page, count }: { page: number; count: number }) {
  const theme = useStoneTheme();
  // Window of DOTS dots that keeps the current page in the middle where it can.
  const active = Math.min(Math.max(page - 1, 0), count - 1);
  const start = Math.min(Math.max(active - Math.floor(DOTS / 2), 0), Math.max(count - DOTS, 0));
  const shown = Math.min(DOTS, count);
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', gap: theme.space.xs }}>
      {Array.from({ length: shown }, (_, i) => (
        <View
          key={start + i}
          style={{
            width: start + i === active ? 18 : 6,
            height: 6,
            borderRadius: theme.radius.xs,
            backgroundColor: start + i === active ? theme.color.accent.bg : theme.color.bg.inset,
          }}
        />
      ))}
    </View>
  );
}

function NoteItem({ note }: { note: PageNote }) {
  const theme = useStoneTheme();
  const pinned = note.kind === 'pinnedAnswer';
  const badgeBg = note.kind === 'question' ? theme.color.status.warning.fill : theme.color.status.success.fill;
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: theme.space.lg,
        padding: theme.space.xl,
        borderRadius: theme.radius.bubble,
        backgroundColor: pinned ? theme.color.status.success.wash : theme.color.bg.surface,
        borderWidth: 1,
        borderColor: pinned ? theme.color.status.success.wash : theme.color.border.hairline,
      }}
    >
      {note.kind === 'linkedNote' ? (
        <Icon name="note" size={20} color={theme.color.text.secondary} />
      ) : (
        <View style={{ width: 24, height: 24, borderRadius: theme.radius.tile, backgroundColor: badgeBg, alignItems: 'center', justifyContent: 'center' }}>
          {pinned ? (
            <Icon name="pin" size={12} strokeWidth={2.5} color={theme.color.text.onFill} />
          ) : (
            <Text style={{ ...theme.text('eyebrow'), fontSize: 12, lineHeight: 12, letterSpacing: 0, color: theme.color.text.onFill }}>?</Text>
          )}
        </View>
      )}
      <View style={{ flex: 1 }}>
        {pinned || note.kind === 'linkedNote' ? (
          <Text style={{ ...theme.text('caption'), color: pinned ? theme.color.status.success.text : theme.color.text.tertiary }}>
            {pinned ? 'pinned answer' : 'linked note'}
          </Text>
        ) : null}
        <Text style={{ ...theme.text('annotation'), color: theme.color.text.primary }}>{note.text}</Text>
      </View>
    </View>
  );
}

export function PhoneSlideViewer({ deck = SAMPLE_DECK }: { deck?: SlideDeck }) {
  const theme = useStoneTheme();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id?: string; page?: string }>();
  const [page, setPage] = useState(() => clampPage(Number(params.page ?? 12), deck.pageCount));
  const [touchX, setTouchX] = useState<number | null>(null);
  const content = deck.pages[page];
  const column = Math.min(width, theme.layout.paperMax);

  const go = (delta: number) => setPage((p) => clampPage(p + delta, deck.pageCount));
  const onRelease = (e: GestureResponderEvent) => {
    if (touchX === null) return;
    const dx = e.nativeEvent.pageX - touchX;
    setTouchX(null);
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
  };
  const goBack = () => (router.canGoBack() ? router.back() : router.replace(params.id ? `/rooms/${params.id}` : '/'));

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg.canvas }}>
      <View style={{ width: column, alignSelf: 'center', flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xs, paddingTop: 52, paddingHorizontal: theme.space.md, paddingBottom: theme.space.md }}>
          <IconButton icon="chevronLeft" label={`back to ${deck.roomName}`} onPress={goBack} />
          <View style={{ flex: 1 }}>
            <Text accessibilityRole="header" style={{ ...theme.text('actionTitle'), color: theme.color.text.primary }}>{deck.title}</Text>
            <Text style={{ ...theme.text('fine'), color: theme.color.text.tertiary }}>{deck.roomName}</Text>
          </View>
          <IconButton icon="fullscreen" label="full screen, or rotate your phone" />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
          <View
            style={{ paddingTop: theme.space.xs, paddingHorizontal: theme.space.base, gap: theme.space.lg }}
            onStartShouldSetResponder={() => true}
            onResponderGrant={(e) => setTouchX(e.nativeEvent.pageX)}
            onResponderRelease={onRelease}
            onResponderTerminate={() => setTouchX(null)}
          >
            {content ? <SlideCard slide={content.slide} /> : (
              <View style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: theme.color.text.onFill, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...theme.text('caption'), color: theme.color.text.tertiary }}>page {page} has no preview yet</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space.lg }}>
              <PageDots page={page} count={deck.pageCount} />
              <Text
                accessibilityLabel={`page ${page} of ${deck.pageCount}`}
                style={{ ...theme.text('caption'), color: theme.color.text.tertiary, fontVariant: ['tabular-nums'] }}
              >
                {page} / {deck.pageCount}
                {page < deck.pageCount ? ' · swipe for next' : ''}
              </Text>
            </View>
          </View>

          <View style={{ padding: theme.space.base, paddingTop: theme.space.xxl, gap: theme.space.lg }}>
            <Text style={{ ...theme.text('eyebrow'), color: theme.color.text.tertiary }}>on this page</Text>
            {content && content.notes.length > 0 ? (
              content.notes.map((n, i) => <NoteItem key={i} note={n} />)
            ) : (
              <Text style={{ ...theme.text('caption'), color: theme.color.text.tertiary }}>nothing on this page yet.</Text>
            )}
          </View>
        </ScrollView>

        <View
          accessibilityRole="toolbar"
          accessibilityLabel="page actions"
          style={{
            position: 'absolute',
            left: theme.space.base,
            right: theme.space.base,
            bottom: 34,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space.xs,
            padding: theme.space.sm,
            borderRadius: 18,
            backgroundColor: theme.color.bg.surface,
            borderWidth: 1,
            borderColor: theme.color.border.hairline,
            ...theme.shadow.float,
          }}
        >
          <IconButton icon="highlightArea" label="highlight area" />
          <IconButton icon="questionPin" label="question pin" />
          <IconButton icon="addPage" label="make a chunk from this page" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="ask about this page"
            style={({ pressed }) => ({
              flex: 1,
              minHeight: theme.layout.control,
              borderRadius: theme.radius.control,
              backgroundColor: theme.color.accent.bg,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ ...theme.text('buttonCompact'), color: theme.color.accent.fg }}>ask about this page</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

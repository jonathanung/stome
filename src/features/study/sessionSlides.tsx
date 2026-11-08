import { useEffect } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { SlideFrame, useStoneTheme } from '../../../design-theme/src/primitives';
import type { Chunk, SlideOutline } from '../../data/models';

/**
 * Read-only slide present (STUDY.4 #134).
 *
 * Reuses the #13/#44 overlay contract (`SlideFrame`) and never rebuilds the
 * viewer: no tools, no marks, no PDF import. Title, bullets, notes, and
 * source links only. Everything is already on device, so it works offline
 * after first load.
 */
export function SessionSlides({
  outline,
  index,
  chunksById,
  stale,
  onPrev,
  onNext,
}: {
  outline: SlideOutline;
  index: number;
  chunksById: ReadonlyMap<string, Chunk>;
  stale: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const theme = useStoneTheme();
  const total = outline.slides.length;
  const slide = outline.slides[Math.min(Math.max(index, 0), Math.max(total - 1, 0))] ?? null;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const host = globalThis as unknown as { document?: Document };
    if (!host.document) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') onPrev();
      else if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault();
        onNext();
      }
    };
    host.document.addEventListener('keydown', onKey);
    return () => host.document?.removeEventListener('keydown', onKey);
  }, [onPrev, onNext]);

  if (!slide) {
    return (
      <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>
        No slides in this outline yet.
      </Text>
    );
  }

  const sources = slide.sourceChunkIds
    .map((id) => chunksById.get(id))
    .filter((chunk): chunk is Chunk => chunk !== undefined);

  return (
    <View style={{ gap: theme.space.base }} testID="study-slide-present">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text testID="study-slide-progress" style={[theme.text('caption'), { color: theme.color.text.tertiary, fontVariant: ['tabular-nums'] }]}>
          {`Slide ${Math.min(index + 1, total)} of ${total}`}
        </Text>
        <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous slide"
            disabled={index <= 0}
            onPress={onPrev}
            testID="study-slide-prev"
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: index <= 0 ? 0.4 : 1 }}
          >
            <Text style={[theme.text('nav'), { color: theme.color.text.secondary }]}>‹ Prev</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next slide"
            disabled={index >= total - 1}
            onPress={onNext}
            testID="study-slide-next"
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: index >= total - 1 ? 0.4 : 1 }}
          >
            <Text style={[theme.text('nav'), { color: theme.color.text.secondary }]}>Next ›</Text>
          </Pressable>
        </View>
      </View>

      {stale ? (
        <View
          accessibilityRole="alert"
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: theme.space.lg,
            paddingVertical: theme.space.sm,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.color.status.warning.wash,
            borderWidth: 1,
            borderColor: theme.color.status.warning.fill,
          }}
        >
          <Text testID="study-slide-stale" style={[theme.text('caption'), { color: theme.color.status.warning.text }]}>
            Source changed — this slide may be outdated
          </Text>
        </View>
      ) : null}

      <SlideFrame>
        <View style={{ flex: 1, gap: theme.space.md }}>
          <Text style={[theme.text('eyebrow'), { color: theme.paper.slideMuted }]}>{outline.title}</Text>
          <Text testID="study-slide-title" accessibilityRole="header" style={[theme.text('slideTitle'), { color: theme.paper.slideText }]}>
            {slide.title}
          </Text>
          <View style={{ gap: theme.space.sm }}>
            {slide.bullets.map((bullet, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: theme.space.md }}>
                <Text style={[theme.text('body'), { color: theme.paper.slideText }]}>•</Text>
                <Text testID={`study-slide-bullet-${i}`} style={[theme.text('body'), { flex: 1, color: theme.paper.slideText }]}>
                  {bullet}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </SlideFrame>

      {slide.notes ? (
        <View
          style={{
            backgroundColor: theme.color.bg.surface,
            borderColor: theme.color.border.hairline,
            borderWidth: 1,
            borderRadius: theme.radius.card,
            paddingHorizontal: theme.space.card,
            paddingVertical: theme.space.base,
            gap: theme.space.xs,
          }}
        >
          <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>Speaker notes</Text>
          <Text testID="study-slide-notes" style={[theme.text('bodySmall'), { color: theme.color.text.primary }]}>
            {slide.notes}
          </Text>
        </View>
      ) : null}

      <View style={{ gap: theme.space.xs }}>
        <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>Sources</Text>
        {sources.length ? (
          sources.map((chunk) => (
            <Text key={chunk.id} testID={`study-slide-source-${chunk.id}`} style={[theme.text('caption'), { color: theme.color.text.secondary }]}>
              {`Note ${chunk.id.slice(0, 8)} · rev ${chunk.revision} · ${chunk.body.slice(0, 80)}`}
            </Text>
          ))
        ) : (
          <Text style={[theme.text('caption'), { color: theme.color.text.tertiary }]}>
            {`Linked notes: ${slide.sourceChunkIds.join(', ') || 'none'}`}
          </Text>
        )}
      </View>
    </View>
  );
}

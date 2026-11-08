import { useEffect } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { Button, useStoneTheme } from '../../../design-theme/src/primitives';
import type { StudyCard } from '../../data/models';
import { RATING_HINT, RATING_LABEL, type StudyRating } from './session';

const RATINGS: StudyRating[] = ['again', 'hard', 'good', 'easy'];

function StaleBadge() {
  const theme = useStoneTheme();
  return (
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
      <Text testID="study-stale-badge" style={[theme.text('caption'), { color: theme.color.status.warning.text }]}>
        Source changed — this card may be outdated
      </Text>
    </View>
  );
}

/**
 * Deck runner: one card at a time, tap/Space to flip, 1–4 to rate.
 * Presentational only; the screen owns loading and review.mark writes.
 */
export function SessionDeck({
  cards,
  index,
  flipped,
  stale,
  busy,
  saved,
  onFlip,
  onRate,
  onPrev,
  onNext,
}: {
  cards: StudyCard[];
  index: number;
  flipped: boolean;
  stale: boolean;
  busy: boolean;
  saved: string | null;
  onFlip: () => void;
  onRate: (rating: StudyRating) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const theme = useStoneTheme();
  const card = cards[index] ?? null;
  const total = cards.length;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const host = globalThis as unknown as { document?: Document };
    if (!host.document) return;
    const onKey = (event: KeyboardEvent) => {
      const key = event.key;
      if (key === ' ' || key === 'Enter') {
        // Let text entry keep Space/Enter; only flip when not typing.
        const target = event.target as { tagName?: string } | null;
        if (target && /INPUT|TEXTAREA/.test(target.tagName ?? '')) return;
        event.preventDefault();
        onFlip();
      } else if (key === '1') onRate('again');
      else if (key === '2') onRate('hard');
      else if (key === '3') onRate('good');
      else if (key === '4') onRate('easy');
      else if (key === 'ArrowLeft') onPrev();
      else if (key === 'ArrowRight') onNext();
    };
    host.document.addEventListener('keydown', onKey);
    return () => host.document?.removeEventListener('keydown', onKey);
  }, [onFlip, onRate, onPrev, onNext]);

  if (!card) {
    return (
      <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>
        No cards in this deck yet.
      </Text>
    );
  }

  return (
    <View style={{ gap: theme.space.base }} testID="study-deck-runner">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.md }}>
        <Text testID="study-deck-progress" style={[theme.text('caption'), { color: theme.color.text.tertiary, fontVariant: ['tabular-nums'] }]}>
          {`Card ${Math.min(index + 1, total)} of ${total}`}
        </Text>
        <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous card"
            disabled={index <= 0}
            onPress={onPrev}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: index <= 0 ? 0.4 : 1 }}
          >
            <Text style={[theme.text('nav'), { color: theme.color.text.secondary }]}>‹ Prev</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next card"
            disabled={index >= total - 1}
            onPress={onNext}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: index >= total - 1 ? 0.4 : 1 }}
          >
            <Text style={[theme.text('nav'), { color: theme.color.text.secondary }]}>Next ›</Text>
          </Pressable>
        </View>
      </View>

      {stale ? <StaleBadge /> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={flipped ? 'Card back. Activate to show front.' : 'Card front. Activate to flip.'}
        accessibilityHint="Tap or press Space to flip"
        onPress={onFlip}
        testID="study-card"
        style={{
          backgroundColor: theme.color.bg.surface,
          borderColor: theme.color.border.hairline,
          borderWidth: 1,
          borderRadius: theme.radius.card,
          paddingHorizontal: theme.space.card,
          paddingVertical: 24,
          minHeight: 220,
          gap: theme.space.md,
          ...theme.shadow.card,
        }}
      >
        <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>
          {flipped ? 'Back — tap to show front' : 'Front — tap or Space to flip'}
        </Text>
        <Text
          testID={flipped ? 'study-card-back' : 'study-card-front'}
          accessibilityRole="header"
          style={[theme.text('actionTitle'), { color: theme.color.text.primary, fontSize: 20, lineHeight: 27 }]}
        >
          {flipped ? card.back : card.front}
        </Text>
        <Text style={[theme.text('caption'), { color: theme.color.text.tertiary }]}>
          {`Sources: ${card.sourceChunkIds.length} · revision ${card.sourceRevision}`}
        </Text>
      </Pressable>

      {saved ? (
        <Text testID="study-deck-saved" style={[theme.text('bodySmall'), { color: theme.color.status.success.text }]}>
          {saved}
        </Text>
      ) : null}

      <Text style={[theme.text('caption'), { color: theme.color.text.tertiary, textAlign: 'center' }]}>
        How well did you know it? Keys 1–4.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md }}>
        {RATINGS.map((rating, i) => (
          <Pressable
            key={rating}
            accessibilityRole="button"
            accessibilityLabel={`${RATING_LABEL[rating]} (${i + 1})`}
            accessibilityHint={RATING_HINT[rating]}
            disabled={busy}
            onPress={() => onRate(rating)}
            testID={`study-rate-${rating}`}
            style={({ pressed }) => ({
              flexGrow: 1,
              flexBasis: 120,
              minHeight: 56,
              borderRadius: theme.radius.bubble,
              backgroundColor: theme.color.bg.surface,
              borderWidth: 1,
              borderColor: theme.color.border.strong,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              opacity: busy ? 0.5 : pressed ? 0.75 : 1,
            })}
          >
            <Text style={[theme.text('buttonCompact'), { color: theme.color.text.primary }]}>
              {`${i + 1} · ${RATING_LABEL[rating]}`}
            </Text>
            <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary, letterSpacing: 0, fontWeight: '400' }]}>
              {RATING_HINT[rating]}
            </Text>
          </Pressable>
        ))}
      </View>
      <Button label={flipped ? 'Show front' : 'Flip card'} onPress={onFlip} />
    </View>
  );
}

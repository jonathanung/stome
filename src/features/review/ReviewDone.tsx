import { Pressable, Text, View } from 'react-native';

import { Eyebrow, useStoneTheme } from '../../../design-theme/src/primitives';
import { StageGlyph } from '../../ui/StageGlyph';
import type { RoomStage } from '../../data/models';
import type { ReviewState } from '../../db/schema';
import { REVIEW_LABEL } from './session';

export type ReviewTally = Record<ReviewState, number>;

export const EMPTY_TALLY: ReviewTally = { got_it: 0, unclear: 0, missed: 0 };

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** "1 tonight, 2 on tuesday" from the due times of notes marked this visit. */
export function nextUpSummary(dueAts: readonly number[], now: number): string | null {
  const today = new Date(now).toDateString();
  let tonight = 0;
  const later = new Map<string, number>();
  for (const dueAt of [...dueAts].sort((a, b) => a - b)) {
    const date = new Date(dueAt);
    if (date.toDateString() === today) tonight += 1;
    else {
      const key = WEEKDAYS[date.getDay()] ?? '';
      later.set(key, (later.get(key) ?? 0) + 1);
    }
  }
  const parts: string[] = [];
  if (tonight) parts.push(`${tonight} tonight`);
  for (const [day, count] of later) parts.push(`${count} on ${day}`);
  return parts.length ? `next up: ${parts.join(', ')}` : null;
}

export function ReviewDone({
  roomName,
  stage,
  promoted,
  tally,
  minutes,
  nextUp,
  onToday,
  onHome,
}: {
  roomName: string;
  stage: RoomStage;
  promoted: boolean;
  tally: ReviewTally;
  minutes: number;
  nextUp: string | null;
  onToday: () => void;
  onHome: () => void;
}) {
  const theme = useStoneTheme();
  const reviewed = tally.got_it + tally.unclear + tally.missed;
  const card = {
    backgroundColor: theme.color.bg.surface,
    borderColor: theme.color.border.hairline,
    borderRadius: 24,
    borderWidth: 1,
  } as const;
  const stats: { state: ReviewState; color: string }[] = [
    { state: 'got_it', color: theme.color.status.success.text },
    { state: 'unclear', color: theme.color.status.warning.text },
    { state: 'missed', color: theme.color.status.danger.text },
  ];
  return (
    <View style={{ gap: 14 }} testID="review-done">
      <View style={[card, { overflow: 'hidden', ...theme.shadow.card }]}>
        <View style={{ height: 150, backgroundColor: theme.color.bg.inset, alignItems: 'center', justifyContent: 'flex-end' }}>
          <StageGlyph stage={stage} size={112} />
        </View>
        <View style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 20, gap: 6 }}>
          <Eyebrow>stone stage</Eyebrow>
          <Text
            accessibilityRole="header"
            testID="review-done-title"
            style={[theme.text('title'), { color: theme.color.text.primary, fontSize: 34, lineHeight: 40, letterSpacing: -1 }]}
          >
            {promoted ? `${roomName.toLowerCase()} is brick` : 'nothing left to review'}
          </Text>
          <Text style={[theme.text('body'), { color: theme.color.text.secondary }]}>
            {promoted ? "that's the credit for reviews you did yourself." : `${roomName.toLowerCase()} stays ${stage}.`}
          </Text>
        </View>
      </View>

      <View style={[card, { paddingHorizontal: 20, paddingVertical: 18, gap: 12 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text testID="review-done-count" style={[theme.text('title'), { color: theme.color.text.primary }]}>{`${reviewed} reviewed`}</Text>
          <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>{`${Math.max(1, minutes)} min`}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {stats.map(({ state, color }) => (
            <View key={state} style={{ flex: 1, backgroundColor: theme.color.bg.canvas, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, gap: 2 }}>
              <Text style={[theme.text('title'), { color, fontWeight: '900' }]}>{tally[state]}</Text>
              <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>{REVIEW_LABEL[state].toLowerCase()}</Text>
            </View>
          ))}
        </View>
        {nextUp ? <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>{nextUp}</Text> : null}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onToday}
        style={{ minHeight: 52, borderRadius: 14, backgroundColor: theme.color.accent.bg, alignItems: 'center', justifyContent: 'center', marginTop: 8 }}
      >
        <Text style={[theme.text('button'), { color: theme.color.accent.fg }]}>back to today</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onHome} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[theme.text('buttonCompact'), { color: theme.color.text.primary }]}>see stone home</Text>
      </Pressable>
    </View>
  );
}

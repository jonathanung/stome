import { MotionPressable as Pressable, MotionView } from '../../../design-theme/src/motion';
import { Text, View } from 'react-native';

import { Eyebrow, useStoneTheme } from '../../../design-theme/src/primitives';
import { Icon } from '../../ui/Icon';
import { StageGlyph } from '../../ui/StageGlyph';
import { BRICK_CREDITS } from '../stone/stone-progress';
import type { RoomStage } from '../../data/models';
import type { ReviewState } from '../../db/schema';
import { REVIEW_LABEL } from './session';

export type ReviewTally = Record<ReviewState, number>;

export const EMPTY_TALLY: ReviewTally = { got_it: 0, unclear: 0, missed: 0 };

const CREDIT_WORDS: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three', 4: 'four' };
const ORDINALS: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth' };

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
  unsaved = null,
  onToday,
  onHome,
}: {
  roomName: string;
  stage: RoomStage;
  promoted: boolean;
  tally: ReviewTally;
  minutes: number;
  nextUp: string | null;
  /** A mark that has not saved yet; kept on screen with a retry until it does. */
  unsaved?: { count: number; busy?: boolean; onRetry: () => void } | null;
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
      <MotionView distance={24} style={[card, { overflow: 'hidden', ...theme.shadow.card }]}>
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
            {promoted ? `${CREDIT_WORDS[BRICK_CREDITS] ?? BRICK_CREDITS} reviews you did yourself. that's the ${ORDINALS[BRICK_CREDITS] ?? 'last'} credit.` : `${roomName.toLowerCase()} stays ${stage}.`}
          </Text>
        </View>
      </MotionView>

      <MotionView delay={100} style={[card, { paddingHorizontal: 20, paddingVertical: 18, gap: 12 }]}>
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
      </MotionView>

      {unsaved ? (
        <View
          accessibilityRole="alert"
          accessibilityLabel="unsaved mark"
          testID="review-done-unsaved"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 14, paddingRight: 12, borderRadius: 16, backgroundColor: theme.color.status.danger.wash }}
        >
          <Icon name="cross" size={18} strokeWidth={2.5} color={theme.color.status.danger.text} />
          <Text style={[theme.text('bodySmall'), { flex: 1, color: theme.color.status.danger.text, fontWeight: '500' }]}>
            {`${unsaved.count} mark${unsaved.count === 1 ? '' : 's'} didn't save. it's kept on this screen until it does.`}
          </Text>
          <Pressable
            accessibilityRole="button"
            testID="review-done-retry"
            disabled={unsaved.busy}
            onPress={unsaved.onRetry}
            style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: theme.color.status.danger.fill, alignItems: 'center', justifyContent: 'center', opacity: unsaved.busy ? 0.5 : 1 }}
          >
            <Text style={[theme.text('buttonCompact'), { color: theme.color.text.onFill }]}>retry</Text>
          </Pressable>
        </View>
      ) : null}

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

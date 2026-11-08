import { Text, View } from 'react-native';

import { useStoneTheme } from '../../design-theme/src/primitives';
import { isDueAnswer, type DueItem } from '../data/models';
import type { ReviewState } from '../db/schema';
import { REVIEW_TONE } from '../ui/StatusMark';

const MINUTES_PER_NOTE = 1.5;
const ORDER: readonly ReviewState[] = ['missed', 'unclear', 'got_it'];
const COUNT_LABEL: Record<ReviewState, string> = { missed: 'missed', unclear: 'unclear', got_it: 'got it' };

/** Rough review time shown beside the due count. */
export function estimateMinutes(count: number): number {
  return Math.max(1, Math.round(count * MINUTES_PER_NOTE));
}

/** Due count, time estimate, and a state-proportioned bar. Unmarked pinned answers count as new. */
export function TodaySummary({ items }: { items: readonly DueItem[] }) {
  const theme = useStoneTheme();
  const stateOf = (item: DueItem): ReviewState | null =>
    isDueAnswer(item) ? (item.mark?.state ?? null) : item.mark.state;
  const counts = ORDER.map((state) => ({ state, n: items.filter((item) => stateOf(item) === state).length })).filter((c) => c.n > 0);
  const fresh = items.filter((item) => isDueAnswer(item) && item.mark === null).length;
  return (
    <View
      testID="today-summary"
      style={{
        backgroundColor: theme.color.bg.surface,
        borderRadius: theme.radius.float,
        borderWidth: 1,
        borderColor: theme.color.border.hairline,
        paddingVertical: 18,
        paddingHorizontal: 20,
        gap: 12,
        ...theme.shadow.card,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={[theme.text('title'), { fontSize: 34, lineHeight: 40, fontWeight: '900', letterSpacing: -1, color: theme.color.text.primary }]}>
          {items.length} due
        </Text>
        <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>about {estimateMinutes(items.length)} min</Text>
      </View>
      <View accessible accessibilityRole="image" accessibilityLabel={[...counts.map((c) => `${c.n} ${COUNT_LABEL[c.state]}`), ...(fresh ? [`${fresh} new`] : [])].join(', ')} style={{ flexDirection: 'row', gap: 6 }}>
        {counts.map((c) => (
          <View key={c.state} style={{ flex: c.n, height: 10, borderRadius: 3, backgroundColor: theme.color.status[REVIEW_TONE[c.state]].fill }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14 }}>
        {fresh ? (
          <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>{fresh} new</Text>
        ) : null}
        {counts.map((c) => (
          <Text key={c.state} style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>{c.n} {COUNT_LABEL[c.state]}</Text>
        ))}
      </View>
    </View>
  );
}

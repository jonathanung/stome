import { Pressable, Text, View } from 'react-native';

import { useStoneTheme } from '../../design-theme/src/primitives';
import type { RecentChunk } from '../data/models';
import { highlightRuns, type SearchHit, type SearchKind } from '../data/search';

const KIND_LABEL: Record<SearchKind, string> = { chunk: 'Chunk', highlight: 'Highlight', ai_answer: 'Pinned AI answer' };

/** "2h ago" style label; falls back to the date after a week. */
export function ago(timestamp: number, now = Date.now()): string {
  const minutes = Math.round((now - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString();
}

/** Group recent chunks into "Today", "This week" and "Earlier" by local calendar day. */
export function groupByRecency(chunks: RecentChunk[], now = Date.now()): { label: string; items: RecentChunk[] }[] {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const weekAgo = startOfToday - 6 * 86_400_000;
  const buckets = [
    { label: 'Today', items: [] as RecentChunk[] },
    { label: 'This week', items: [] as RecentChunk[] },
    { label: 'Earlier', items: [] as RecentChunk[] },
  ];
  for (const chunk of chunks) {
    buckets[chunk.updatedAt >= startOfToday ? 0 : chunk.updatedAt >= weekAgo ? 1 : 2].items.push(chunk);
  }
  return buckets.filter((bucket) => bucket.items.length);
}

export function Eyebrow({ children, top }: { children: string; top?: number }) {
  const theme = useStoneTheme();
  return <Text style={[theme.text('label'), { color: theme.color.text.tertiary, marginTop: top, textTransform: 'uppercase', letterSpacing: 0.8 }]}>{children}</Text>;
}

export function FilterChip({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  const theme = useStoneTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      onPress={onPress}
      style={{
        minHeight: 32,
        paddingHorizontal: theme.space.xl,
        justifyContent: 'center',
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: on ? theme.color.accent.bg : theme.color.border.hairline,
        backgroundColor: on ? theme.color.accent.bg : theme.color.bg.surface,
      }}>
      <Text style={[theme.text('label'), { color: on ? theme.color.accent.fg : theme.color.text.secondary }]}>{label}</Text>
    </Pressable>
  );
}

export function SearchResult({ hit, query, onPress }: { hit: SearchHit; query: string; onPress: () => void }) {
  const theme = useStoneTheme();
  const pinned = hit.kind === 'ai_answer';
  const wash = theme.color.status.success.wash;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open ${hit.roomName}: ${KIND_LABEL[hit.kind]}`}
      onPress={onPress}
      style={({ pressed }) => ({
        gap: theme.space.sm,
        paddingHorizontal: 18,
        paddingVertical: theme.space.base,
        borderRadius: theme.radius.float,
        borderWidth: 1,
        borderColor: pinned ? wash : theme.color.border.hairline,
        backgroundColor: pinned ? wash : pressed ? theme.color.bg.alt : theme.color.bg.surface,
      })}>
      <Text style={[theme.text('label'), { color: pinned ? theme.color.status.success.text : theme.color.text.tertiary }]}>
        {KIND_LABEL[hit.kind]} · edited {ago(hit.updatedAt)}
      </Text>
      <Text numberOfLines={4} style={[theme.text('body'), { color: theme.color.text.primary }]}>
        {highlightRuns(hit.text.slice(0, 400), query).map((run, i) => (
          <Text key={i} style={run.hit ? { fontWeight: '600', backgroundColor: theme.color.status.warning.wash, borderBottomWidth: 2, borderBottomColor: theme.color.status.warning.fill } : undefined}>{run.text}</Text>
        ))}
      </Text>
    </Pressable>
  );
}

export function RecentRow({ chunk, last, onPress }: { chunk: RecentChunk; last: boolean; onPress: () => void }) {
  const theme = useStoneTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open ${chunk.roomName}: ${chunk.body.slice(0, 60)}`}
      onPress={onPress}
      style={{ gap: theme.space.xs, paddingVertical: theme.space.xl, borderBottomWidth: last ? 0 : 1, borderBottomColor: theme.color.border.hairline }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space.md }}>
        <Text numberOfLines={1} style={[theme.text('label'), { flex: 1, fontWeight: '600', color: theme.color.text.primary }]}>{chunk.roomName}</Text>
        <Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>{ago(chunk.updatedAt)}</Text>
      </View>
      <Text numberOfLines={2} style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>
        {chunk.body.trim() ? chunk.body.slice(0, 280) : 'Empty chunk'}
      </Text>
    </Pressable>
  );
}

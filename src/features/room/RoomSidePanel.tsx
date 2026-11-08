import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';

export interface RoomSidePanelProps {
  roomId: string;
  /** Distinct subjects in first-seen order. */
  subjects: string[];
  chunks: { subjects: string[]; annotations: { type: string }[] }[];
  dueToday: number;
  activeSubject: string | null;
  onSubject(subject: string | null): void;
}

/** Web room right panel (#38): subject filter with counts, room stats, and attached decks and boards. */
export function RoomSidePanel({ roomId, subjects, chunks, dueToday, activeSubject, onSubject }: RoomSidePanelProps) {
  const theme = useStoneTheme();
  const annotations = chunks.flatMap((chunk) => chunk.annotations);
  const highlights = annotations.filter((a) => a.type === 'highlight').length;
  const pinned = annotations.filter((a) => a.type === 'ai_answer').length;

  const heading = (text: string) => (
    <Text accessibilityRole="header" style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>{text}</Text>
  );
  const row = (label: string, count: number | string, on: boolean, onPress?: () => void, key?: string) => (
    <Pressable key={key ?? label} accessibilityRole={onPress ? 'button' : 'text'} accessibilityState={{ selected: on }}
      accessibilityLabel={`${label}, ${count}`} disabled={!onPress} onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 32,
        paddingHorizontal: theme.space.md, borderRadius: theme.radius.md, opacity: pressed ? 0.6 : 1,
        backgroundColor: on ? theme.color.bg.inset : 'transparent',
      })}>
      <Text style={[theme.text('bodySmall'), { color: on ? theme.color.text.primary : theme.color.text.secondary, fontWeight: on ? '600' : '400' }]}>{label}</Text>
      <Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>{count}</Text>
    </Pressable>
  );
  const attached = (label: string, kind: string, href: `/rooms/${string}/slides` | `/rooms/${string}/whiteboard`) => (
    // Not <Link asChild>: on web the slot drops this style function, so the row lost its border.
    <Pressable key={label} accessibilityRole="link" accessibilityLabel={`${label}, ${kind}`} onPress={() => router.push(href)}
      style={({ pressed }) => ({
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 36,
        paddingHorizontal: theme.space.md, borderRadius: theme.radius.md, borderWidth: 1,
        borderColor: theme.color.border.hairline, opacity: pressed ? 0.6 : 1,
      })}>
      <Text style={[theme.text('bodySmall'), { color: theme.color.text.primary }]}>{label}</Text>
      <Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>{kind}</Text>
    </Pressable>
  );

  return (
    <View testID="room-side-panel" style={{ width: 260, gap: theme.space.xl, padding: theme.space.base,
      borderRadius: theme.radius.float, borderWidth: 1, borderColor: theme.color.border.hairline,
      backgroundColor: theme.color.bg.surface, alignSelf: 'flex-start' }}>
      <View style={{ gap: theme.space.xs }}>
        {heading('subjects')}
        {row('all chunks', chunks.length, activeSubject === null, () => onSubject(null))}
        {subjects.map((subject) => row(subject, chunks.filter((c) => c.subjects.includes(subject)).length,
          activeSubject === subject, () => onSubject(activeSubject === subject ? null : subject)))}
      </View>
      <View style={{ gap: theme.space.xs }}>
        {heading('in this room')}
        {row('highlights', highlights, false)}
        {row('pinned answers', pinned, false)}
        {row('due today', dueToday, false)}
      </View>
      <View style={{ gap: theme.space.sm }}>
        {heading('attached')}
        {attached('slides', 'deck', `/rooms/${roomId}/slides`)}
        {attached('whiteboard', 'board', `/rooms/${roomId}/whiteboard`)}
      </View>
    </View>
  );
}

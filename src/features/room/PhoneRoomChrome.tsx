import { Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import { Icon } from '../../ui/Icon';

export type RoomTab = 'notes' | 'slides' | 'boards';
export const ROOM_TABS: RoomTab[] = ['notes', 'slides', 'boards'];

/** Distinct subjects across the room's chunks, in first-seen order. */
export function roomSubjects(chunks: { subjects: string[] }[]): string[] {
  const seen = new Set<string>();
  for (const chunk of chunks) for (const subject of chunk.subjects) if (subject.trim()) seen.add(subject);
  return [...seen];
}

/** Back, room name with stage line, and the review shortcut (phone design, 390 wide). */
export function PhoneRoomHeader({ name, status, onBack, onReview }: {
  name: string; status: string; onBack: () => void; onReview: () => void;
}) {
  const theme = useStoneTheme();
  const hit = { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' } as const;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xs, marginHorizontal: -theme.space.md }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to rooms" onPress={onBack} style={hit} testID="room-back">
        <Icon name="chevronLeft" size={22} color={theme.color.text.primary} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" numberOfLines={1}
          style={{ ...theme.text('screenTitle'), fontSize: 22, lineHeight: 28, letterSpacing: -0.4, color: theme.color.text.primary }}>
          {name}
        </Text>
        <Text numberOfLines={1} style={[theme.text('label'), { color: theme.color.text.tertiary }]}>{status}</Text>
      </View>
      <Pressable accessibilityRole="link" accessibilityLabel="Review this room" onPress={onReview} style={hit} testID="open-review">
        <Icon name="review" size={20} color={theme.color.text.primary} />
      </Pressable>
    </View>
  );
}

export function RoomTabs({ value, onChange }: { value: RoomTab; onChange: (tab: RoomTab) => void }) {
  const theme = useStoneTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', padding: 3, borderRadius: theme.radius.control, backgroundColor: theme.color.bg.inset }}>
      {ROOM_TABS.map((tab) => {
        const on = tab === value;
        return (
          <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(tab)}
            style={{ flex: 1, minHeight: 36, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center',
              backgroundColor: on ? theme.color.bg.surface : 'transparent', ...(on ? theme.shadow.segment : null) }}>
            <Text style={{ ...theme.text('bodySmall'), fontSize: 14, lineHeight: 18, fontWeight: on ? '600' : '500',
              color: on ? theme.color.text.primary : theme.color.text.secondary }}>{tab}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SubjectChips({ subjects, value, onChange }: {
  subjects: string[]; value: string | null; onChange: (subject: string | null) => void;
}) {
  const theme = useStoneTheme();
  if (!subjects.length) return null;
  const chip = (label: string, subject: string | null) => {
    const on = value === subject;
    return (
      <Pressable key={label} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(subject)}
        style={{ minHeight: 32, paddingHorizontal: 12, borderRadius: theme.radius.pill, borderWidth: 1, justifyContent: 'center',
          borderColor: on ? theme.color.accent.bg : theme.color.border.hairline,
          backgroundColor: on ? theme.color.accent.bg : theme.color.bg.surface }}>
        <Text style={{ ...theme.text('label'), fontSize: 13, lineHeight: 18, color: on ? theme.color.accent.fg : theme.color.text.secondary }}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel="Subjects"
      contentContainerStyle={{ gap: theme.space.sm }} style={{ flexGrow: 0 }}>
      {chip('all', null)}
      {subjects.map((subject) => chip(subject, subject))}
    </ScrollView>
  );
}

/** Floating ask / add note bar pinned above the home indicator. */
export function PhoneRoomActions({ onAsk, onAddNote }: { onAsk: () => void; onAddNote: () => void }) {
  const theme = useStoneTheme();
  const base = { flex: 1, minHeight: 52, borderRadius: theme.radius.bubble, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: theme.space.md, ...theme.shadow.float } as const;
  const label = { ...theme.text('button'), fontSize: 16, lineHeight: 22 };
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: 16, flexDirection: 'row', gap: theme.space.md }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Ask about this room" onPress={onAsk} testID="room-ask"
        style={{ ...base, borderWidth: 1, borderColor: theme.color.border.strong, backgroundColor: theme.color.bg.surface }}>
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={theme.color.text.primary} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M4 5h16v11H9l-5 4z" />
        </Svg>
        <Text style={[label, { color: theme.color.text.primary }]}>ask</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Add note" onPress={onAddNote} testID="room-add-note"
        style={{ ...base, backgroundColor: theme.color.accent.bg }}>
        <Icon name="plus" size={18} color={theme.color.accent.fg} />
        <Text style={[label, { color: theme.color.accent.fg }]}>add note</Text>
      </Pressable>
    </View>
  );
}

import { router } from 'expo-router';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useStoneTheme } from '../../design-theme/src/primitives';
import { reviewHref } from '../features/review/session';
import { Icon } from '../ui/Icon';
import { StageGlyph, stageName } from '../ui/StageGlyph';
import { BackButton } from '../ui/kit';
import type { Room } from '../data/models';

type ActionProps = { label: string; accessibilityLabel: string; onPress?: () => void; primary?: boolean; icon?: 'plus' | 'ask' };

function AskGlyph({ color }: { color: string }) {
  return <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M4 5h16v11H9l-5 4z" />
  </Svg>;
}

const Action = ({ label, accessibilityLabel, onPress, primary, icon }: ActionProps) => {
  const theme = useStoneTheme();
  const color = primary ? theme.color.accent.fg : theme.color.text.primary;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}
    style={({ pressed }) => ({
      minHeight: theme.layout.control, paddingHorizontal: theme.space.xxl + 2, borderRadius: theme.radius.lg,
      flexDirection: 'row', alignItems: 'center', gap: theme.space.md, opacity: pressed ? 0.7 : 1,
      backgroundColor: primary ? theme.color.accent.bg : 'transparent',
      borderWidth: primary ? 0 : 1, borderColor: theme.color.border.strong,
    })}>
    {icon === 'plus' ? <Icon name="plus" size={16} color={color} strokeWidth={2} /> : null}
    {icon === 'ask' ? <AskGlyph color={color} /> : null}
    <Text style={[theme.text('buttonCompact'), { color }]}>{label}</Text>
  </Pressable>;
};

/** Room header from the design: back link, name, stage badge, save status, and the three room actions. */
export function RoomHeader({ room, chunkCount, onBack, onAsk, onNewNote, onImport }: {
  room: Room; chunkCount: number; onBack(): void; onAsk(): void; onNewNote(): void; onImport(): void;
}) {
  const theme = useStoneTheme();
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const success = theme.color.status.success;
  return <View style={{ gap: theme.space.base }}>
    <View style={{ gap: theme.space.xs }}>
      <BackButton label="rooms" accessibilityLabel="All rooms" onPress={onBack} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.base, flexWrap: 'wrap' }}>
        <StageGlyph stage={room.stage} size={phone ? 44 : 56} onCanvas />
        <Text accessibilityRole="header" style={[theme.text('screenTitle'), { color: theme.color.text.primary }]}>{room.name}</Text>
        <View style={{ paddingVertical: 2, paddingHorizontal: 10, borderRadius: theme.radius.pill, backgroundColor: success.wash }}>
          <Text style={[theme.text('label'), { color: success.text }]}>{stageName(room.stage)}</Text>
        </View>
      </View>
      <View accessibilityRole="text" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xs }}>
        <Icon name="check" size={12} color={theme.color.text.tertiary} strokeWidth={2.5} />
        <Text style={[theme.text('meta'), { color: theme.color.text.tertiary }]}>
          {`saved on this device · ${chunkCount} ${chunkCount === 1 ? 'chunk' : 'chunks'}`}
        </Text>
      </View>
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md }}>
      {/* A plain Pressable: under <Link asChild> on web the style function was dropped, so this rendered as bare text. */}
      <Pressable accessibilityRole="link" accessibilityLabel="Review notes in this room" testID="open-review"
        onPress={() => router.push(reviewHref(room.id))}
        style={({ pressed }) => ({ minHeight: theme.layout.control, paddingHorizontal: theme.space.xxl + 2, borderRadius: theme.radius.lg,
          justifyContent: 'center', borderWidth: 1, borderColor: theme.color.border.strong, opacity: pressed ? 0.7 : 1 })}>
        <Text style={[theme.text('buttonCompact'), { color: theme.color.text.primary }]}>review room</Text>
      </Pressable>
      {/* Plain Pressable for the same reason: Link asChild drops the style function on web. */}
      <Pressable accessibilityRole="link" accessibilityLabel="Study materials from this room" testID="open-study"
        onPress={() => router.push(`/study/pick?roomId=${room.id}`)}
        style={({ pressed }) => ({ minHeight: theme.layout.control, paddingHorizontal: theme.space.xxl + 2, borderRadius: theme.radius.lg,
          justifyContent: 'center', borderWidth: 1, borderColor: theme.color.border.strong, opacity: pressed ? 0.7 : 1 })}>
        <Text style={[theme.text('buttonCompact'), { color: theme.color.text.primary }]}>study</Text>
      </Pressable>
      <Pressable accessibilityRole="link" accessibilityLabel="Open the whiteboard" testID="open-whiteboard"
        onPress={() => router.push(`/rooms/${room.id}/whiteboard`)}
        style={({ pressed }) => ({ minHeight: theme.layout.control, paddingHorizontal: theme.space.xxl + 2, borderRadius: theme.radius.lg,
          justifyContent: 'center', borderWidth: 1, borderColor: theme.color.border.strong, opacity: pressed ? 0.7 : 1 })}>
        <Text style={[theme.text('buttonCompact'), { color: theme.color.text.primary }]}>whiteboard</Text>
      </Pressable>
      <Action label="ask" accessibilityLabel="Ask about this room" icon="ask" onPress={onAsk} />
      {/* Plain Pressable, not <Link asChild>: on web the slot drops the style function, so the row loses its border. */}
      <Pressable accessibilityRole="link" accessibilityLabel="Study session for this room" testID="open-study-session"
        onPress={() => router.push(`/rooms/${room.id}/study`)}
        style={({ pressed }) => ({ minHeight: theme.layout.control, paddingHorizontal: theme.space.xxl + 2, borderRadius: theme.radius.lg,
          justifyContent: 'center', borderWidth: 1, borderColor: theme.color.border.strong, opacity: pressed ? 0.7 : 1 })}>
        <Text style={[theme.text('buttonCompact'), { color: theme.color.text.primary }]}>study session</Text>
      </Pressable>
      <Action label="import notes" accessibilityLabel="Import notes into this room" onPress={onImport} />
      <Action label="new note" accessibilityLabel="Jump to new note" icon="plus" primary onPress={onNewNote} />
    </View>
  </View>;
}

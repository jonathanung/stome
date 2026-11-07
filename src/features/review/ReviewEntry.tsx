import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import { Icon } from '../../ui/Icon';
import { reviewHref } from './session';

/** Room-list entry. The room screen only renders this; it does not own the session. */
export function ReviewEntry({ roomId }: { roomId: string }) {
  const theme = useStoneTheme();
  return (
    <Link href={reviewHref(roomId)} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Review notes in this room"
        testID="open-review"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space.xl,
          minHeight: 56,
          paddingHorizontal: theme.space.base,
          borderRadius: theme.radius.float,
          borderWidth: 1,
          borderColor: theme.color.border.hairline,
          backgroundColor: theme.color.bg.surface,
          ...theme.shadow.card,
        }}
      >
        <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: theme.color.accent.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="review" size={18} color={theme.color.accent.fg} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[theme.text('button'), { color: theme.color.text.primary }]}>Review notes</Text>
        </View>
        <Icon name="chevronRight" size={18} color={theme.color.text.tertiary} />
      </Pressable>
    </Link>
  );
}

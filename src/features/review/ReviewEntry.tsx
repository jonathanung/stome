import { Link } from 'expo-router';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import { reviewHref } from './session';

/** Room-list entry. The room screen only renders this; it does not own the session. */
export function ReviewEntry({ roomId }: { roomId: string }) {
  const theme = useStoneTheme();
  return (
    <Link
      href={reviewHref(roomId)}
      accessibilityLabel="Review notes in this room"
      testID="open-review"
      style={{
        alignSelf: 'flex-start',
        color: theme.color.text.primary,
        fontSize: 16,
        textDecorationLine: 'underline',
      }}
    >
      Review notes
    </Link>
  );
}

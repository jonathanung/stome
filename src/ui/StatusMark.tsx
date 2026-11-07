import { View } from 'react-native';

import { useStoneTheme } from '../../design-theme/src/primitives';
import type { ReviewState } from '../db/schema';
import { Icon, type IconName } from './Icon';

export const REVIEW_TONE: Record<ReviewState, 'danger' | 'warning' | 'success'> = {
  missed: 'danger',
  unclear: 'warning',
  got_it: 'success',
};

export const REVIEW_ICON: Record<ReviewState, IconName> = {
  missed: 'cross',
  unclear: 'unclear',
  got_it: 'check',
};

/** A filled day tile carrying the review mark: rust missed, lichen unclear, moss got it. */
export function StatusMark({ state, size = 28 }: { state: ReviewState; size?: number }) {
  const theme = useStoneTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: (size / 8) * 2,
        backgroundColor: theme.color.status[REVIEW_TONE[state]].fill,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={REVIEW_ICON[state]} size={size * 0.55} strokeWidth={2.75} color={theme.color.text.onFill} />
    </View>
  );
}

import { Pressable, Text, View } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';

type AskTimeoutNoticeProps = { disabled?: boolean; onContinue: () => void };

/** Shown after a timed-out try. Nothing was written, so continuing is safe. */
export function AskTimeoutNotice({ disabled, onContinue }: AskTimeoutNoticeProps) {
  const theme = useStoneTheme();
  const warning = theme.color.status.warning;
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: 12, borderRadius: theme.radius.control, backgroundColor: warning.wash,
      }}
      testID="ask-timeout-notice"
    >
      <Text style={[theme.text('label'), { flex: 1, color: warning.text }]}>earlier try timed out. nothing changed.</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={onContinue}
        style={{ minHeight: theme.layout.control, justifyContent: 'center', paddingHorizontal: 12, opacity: disabled ? 0.45 : 1 }}
        testID="ask-timeout-continue"
      >
        <Text style={[theme.text('label'), { color: warning.text, textDecorationLine: 'underline' }]}>continue</Text>
      </Pressable>
    </View>
  );
}

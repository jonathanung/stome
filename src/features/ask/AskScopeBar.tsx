import { Pressable, Text, View } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';

type AskScopeBarProps = {
  included: number;
  total: number;
  disabled?: boolean;
  onIncludeAll: () => void;
};

/** "2 of 4 chunks included" scope header with an include-all shortcut. */
export function AskScopeBar({ included, total, disabled, onIncludeAll }: AskScopeBarProps) {
  const theme = useStoneTheme();
  const all = total > 0 && included === total;
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: theme.layout.control }}
      testID="ask-scope-bar"
    >
      <Text style={[theme.text('label'), { color: theme.color.text.secondary }]} testID="ask-scope-count">
        {`${included} of ${total} chunks included`}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || all || total === 0 }}
        disabled={disabled || all || total === 0}
        onPress={onIncludeAll}
        style={{ minHeight: theme.layout.control, justifyContent: 'center', paddingHorizontal: 8, opacity: all ? 0.45 : 1 }}
        testID="ask-include-all"
      >
        <Text style={[theme.text('label'), { color: theme.color.text.primary, textDecorationLine: 'underline' }]}>include all</Text>
      </Pressable>
    </View>
  );
}

import { Pressable, Text, View } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';

export type InkLassoActionsProps = {
  onAsk: () => void;
  onConvert: () => void;
};

/** Floating actions shown over a lassoed ink selection in the iPad room. */
export function InkLassoActions({ onAsk, onConvert }: InkLassoActionsProps) {
  const theme = useStoneTheme();
  const items = [
    { label: 'ask about this ink', onPress: onAsk, strong: true },
    { label: 'convert to text', onPress: onConvert, strong: false },
  ];
  return (
    <View accessibilityRole="toolbar" accessibilityLabel="lasso selection" testID="ink-lasso-actions" style={{
      position: 'absolute', bottom: 96, alignSelf: 'center', flexDirection: 'row', gap: 2, padding: 4,
      borderRadius: 14, backgroundColor: theme.color.accent.bg, ...theme.shadow.float,
    }}>
      {items.map((item) => (
        <Pressable key={item.label} accessibilityRole="button" onPress={item.onPress} style={{
          minHeight: theme.layout.control, paddingHorizontal: 14, borderRadius: theme.radius.control,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={[theme.text('buttonCompact'), { color: theme.color.accent.fg, fontWeight: item.strong ? '600' : '500' }]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

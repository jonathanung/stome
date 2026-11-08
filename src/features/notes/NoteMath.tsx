import { Text } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';

/**
 * Native reading fallback. iOS and Android do not typeset MathML here: there
 * is no WebView and no remote script. The person still sees the formula
 * source, which is what the note stores.
 */
export function NoteMath({ tex, display }: { tex: string; display: boolean }) {
  const theme = useStoneTheme();
  return (
    <Text
      selectable
      accessibilityLabel={display ? `Formula ${tex}` : `Inline formula ${tex}`}
      style={[theme.text(display ? 'body' : 'reading'), { color: theme.color.text.primary }]}
    >
      {tex}
    </Text>
  );
}

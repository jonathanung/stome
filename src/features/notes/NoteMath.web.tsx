import { createElement } from 'react';
import { Text, View } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import { renderMath } from './math-render';

/** Web reading view. MathML is produced locally by KaTeX; the note HTML is never inserted. */
export function NoteMath({ tex, display }: { tex: string; display: boolean }) {
  const theme = useStoneTheme();
  const rendered = renderMath(tex, display);
  if (!rendered.ok) {
    return (
      <Text
        selectable
        accessibilityLabel={`Unreadable formula. ${rendered.message}`}
        style={[theme.text('bodySmall'), { color: theme.color.status.danger.text }]}
      >
        {tex}
      </Text>
    );
  }
  return (
    <View style={{ maxWidth: '100%', flexShrink: 1 }}>
      {createElement('span', {
        'aria-label': display ? 'Formula' : 'Inline formula',
        style: {
          color: theme.color.text.primary,
          display: display ? 'block' : 'inline-block',
          maxWidth: '100%',
          overflowX: 'auto',
          verticalAlign: 'middle',
        },
        dangerouslySetInnerHTML: { __html: rendered.html },
      })}
    </View>
  );
}

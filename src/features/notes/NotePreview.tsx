import { Text, View } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';

function readingLines(body: string) {
  let fence: { char: string; length: number } | null = null;
  return body.split('\n').map((line) => {
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = { char: marker[1][0], length: marker[1].length };
      else if (fence.char === marker[1][0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return { line, code: true };
    }
    return { line, code: fence !== null };
  });
}

/** A small, offline reading view. Unknown Markdown stays literal; no HTML runs. */
export function NotePreview({ body }: { body: string }) {
  const theme = useStoneTheme();
  const lines = body.split('\n');
  if (lines.length > 500) return <Text selectable style={[theme.text('reading'), { color: theme.color.text.primary }]}>{body}</Text>;
  return <View style={{ gap: theme.space.md }}>
    {readingLines(body).map(({ line, code }, index) => {
      const heading = !code ? /^(#{1,6})\s+(.+)$/.exec(line) : null;
      const quote = !code && line.startsWith('> ');
      const content = heading ? heading[2] : quote ? line.slice(2) : !code ? line.replace(/^[-*] /, '• ') : line;
      return <Text key={index} selectable accessibilityRole={heading ? 'header' : undefined}
        style={[
          theme.text(heading ? heading[1].length <= 2 ? 'title' : 'cardTitle' : code ? 'bodySmall' : 'reading'),
          { color: quote ? theme.color.text.secondary : theme.color.text.primary },
          quote ? { borderLeftWidth: 2, borderLeftColor: theme.color.border.strong, paddingLeft: theme.space.base, fontStyle: 'italic' } : null,
        ]}>
        {code ? content : content.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g).map((part, i) =>
          part.startsWith('**') && part.endsWith('**') ? <Text key={i} style={{ fontWeight: '700' }}>{part.slice(2, -2)}</Text>
            : part.startsWith('*') && part.endsWith('*') && part.length > 2 ? <Text key={i} style={{ fontStyle: 'italic' }}>{part.slice(1, -1)}</Text> : part)}
      </Text>;
    })}
  </View>;
}

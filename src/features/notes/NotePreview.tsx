import { Text, View } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import { NoteMath } from './NoteMath';
import { segmentNote, type NoteBlock, type NoteInline } from './math-source';

function emphasize(text: string) {
  return text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') ? <Text key={index} style={{ fontWeight: '700' }}>{part.slice(2, -2)}</Text>
      : part.startsWith('*') && part.endsWith('*') && part.length > 2 ? <Text key={index} style={{ fontStyle: 'italic' }}>{part.slice(1, -1)}</Text>
        : part);
}

function InlineRun({ part }: { part: NoteInline }) {
  const theme = useStoneTheme();
  if (part.type === 'math') return <NoteMath tex={part.tex} display={false} />;
  if (part.type === 'code') {
    return <Text style={[theme.text('bodySmall'), { color: theme.color.text.primary }]}>{part.text}</Text>;
  }
  return <Text style={{ color: theme.color.text.primary }}>{emphasize(part.text)}</Text>;
}

function PreviewBlock({ block }: { block: NoteBlock }) {
  const theme = useStoneTheme();
  if (block.type === 'math') return <NoteMath tex={block.tex} display />;
  const heading = block.heading;
  const hasMath = block.inlines.some((part) => part.type === 'math');
  const style = [
    theme.text(heading ? heading <= 2 ? 'title' : 'cardTitle' : block.code ? 'bodySmall' : 'reading'),
    { color: block.quote ? theme.color.text.secondary : theme.color.text.primary },
    block.quote ? { borderLeftWidth: 2, borderLeftColor: theme.color.border.strong, paddingLeft: theme.space.base, fontStyle: 'italic' as const } : null,
  ];
  if (!hasMath) {
    return (
      <Text selectable accessibilityRole={heading ? 'header' : undefined} style={style}>
        {block.code ? block.inlines.map((part) => part.type === 'text' ? part.text : '').join('') : block.inlines.map((part, index) =>
          part.type === 'code' ? <Text key={index} style={theme.text('bodySmall')}>{part.text}</Text>
            : part.type === 'text' ? <Text key={index}>{emphasize(part.text)}</Text> : null)}
      </Text>
    );
  }
  return (
    <View accessibilityRole={heading ? 'header' : undefined} style={[{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', maxWidth: '100%' }, block.quote ? { borderLeftWidth: 2, borderLeftColor: theme.color.border.strong, paddingLeft: theme.space.base } : null]}>
      {block.inlines.map((part, index) => <InlineRun key={index} part={part} />)}
    </View>
  );
}

/** A small, offline reading view. Unknown Markdown stays literal; math is typeset on web only. No HTML from the note runs. */
export function NotePreview({ body }: { body: string }) {
  const theme = useStoneTheme();
  if (body.split('\n').length > 500) {
    return <Text selectable style={[theme.text('reading'), { color: theme.color.text.primary }]}>{body}</Text>;
  }
  return (
    <View style={{ gap: theme.space.md }}>
      {segmentNote(body).map((block, index) => <PreviewBlock key={index} block={block} />)}
    </View>
  );
}

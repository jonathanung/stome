import { Pressable, Text, View } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import { citationFromAnnotation, type ChunkFocus } from './citations';

export function AnchoredChunkText({ body, focus }: { body: string; focus: ChunkFocus | null }) {
  const theme = useStoneTheme();
  const text = { color: theme.color.text.primary, fontSize: 16, lineHeight: 24 };
  if (!focus || focus.end <= focus.start || focus.start < 0 || focus.end > body.length) {
    return <Text style={text}>{body}</Text>;
  }
  return (
    <Text style={text}>
      {body.slice(0, focus.start)}
      <Text
        accessibilityLabel={`Cited passage ${body.slice(focus.start, focus.end)}`}
        style={{ backgroundColor: theme.color.status.warning.wash, color: theme.color.status.warning.text }}
        testID="cited-anchor"
      >
        {body.slice(focus.start, focus.end)}
      </Text>
      {body.slice(focus.end)}
    </Text>
  );
}

export function PinnedAnswer({
  annotationId,
  chunkId,
  chunkBody,
  answer,
  anchor,
  onOpen,
}: {
  annotationId: string;
  chunkId: string;
  chunkBody: string;
  answer: string;
  anchor: unknown;
  onOpen: (focus: ChunkFocus) => void;
}) {
  const theme = useStoneTheme();
  const parsed = citationFromAnnotation(chunkBody, anchor);
  const shown = answer.trim() ? `AI answer: ${answer}` : 'AI answer';
  return (
    <View testID={`annotation-${annotationId}`}>
      <Text style={{ color: theme.color.text.secondary }}>{shown}</Text>
      {parsed.ok ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Show cited passage ${parsed.quote}`}
          onPress={() => onOpen({ chunkId, start: parsed.start, end: parsed.end })}
          style={{ minHeight: theme.layout.control, justifyContent: 'center' }}
          testID={`annotation-${annotationId}-cite`}
        >
          <Text style={{ color: theme.color.text.primary, textDecorationLine: 'underline' }}>
            {`Cited passage: ${parsed.quote}`}
          </Text>
        </Pressable>
      ) : (
        <Text accessibilityRole="alert" style={{ color: theme.color.status.danger.text }} testID={`annotation-${annotationId}-error`}>
          {parsed.message}
        </Text>
      )}
    </View>
  );
}

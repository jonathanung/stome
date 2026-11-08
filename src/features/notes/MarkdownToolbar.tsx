import { ScrollView, Text, View } from 'react-native';

import { MotionPressable } from '../../../design-theme/src/motion';
import { useStoneTheme } from '../../../design-theme/src/primitives';
import type { NoteFormat } from './formatting';

const TOOLS: { format: NoteFormat; label: string; name: string }[] = [
  { format: 'bold', label: 'B', name: 'Bold' },
  { format: 'italic', label: 'I', name: 'Italic' },
  { format: 'heading', label: 'H2', name: 'Heading' },
  { format: 'bullet', label: '• List', name: 'Bullet list' },
  { format: 'numbered', label: '1. List', name: 'Numbered list' },
  { format: 'checklist', label: '☐ Task', name: 'Checklist' },
  { format: 'quote', label: '❝ Quote', name: 'Quote' },
  { format: 'code', label: '</>', name: 'Inline code' },
  { format: 'link', label: 'Link', name: 'Link' },
];

/** Selection-aware Markdown actions shared by the room composer and note editors. */
export function MarkdownToolbar({ onFormat, context }: { onFormat: (format: NoteFormat) => void; context: string }) {
  const theme = useStoneTheme();
  return <View accessibilityLabel={`Formatting for ${context}`} style={{ borderBottomWidth: 1, borderBottomColor: theme.color.border.hairline, paddingBottom: theme.space.sm }}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always"
      contentContainerStyle={{ alignItems: 'center', gap: theme.space.xs }}>
      {TOOLS.map(({ format, label, name }) => <MotionPressable key={format}
        accessibilityRole="button" accessibilityLabel={`${name} in ${context}`}
        onPress={() => onFormat(format)} testID={`format-${format}`}
        style={({ pressed }) => ({
          minHeight: theme.layout.control, minWidth: theme.layout.control,
          paddingHorizontal: theme.space.md, alignItems: 'center', justifyContent: 'center',
          borderRadius: theme.radius.sm, backgroundColor: pressed ? theme.color.bg.inset : theme.color.bg.surface,
        })}>
        <Text style={[theme.text('meta'), {
          color: theme.color.text.primary,
          fontWeight: format === 'bold' ? '700' : '500',
          fontStyle: format === 'italic' ? 'italic' : 'normal',
        }]}>{label}</Text>
      </MotionPressable>)}
    </ScrollView>
  </View>;
}

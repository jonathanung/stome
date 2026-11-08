import { Pressable, StyleSheet, Text, View } from 'react-native';

import { createStyles } from '../../../design-theme/src/primitives';
import type { ImportSuggestion } from '../../harness/tools';
import type { ExistingRoom } from '../../import/room-map';
import { describeSuggestion } from '../../import/suggest';

function SmallButton({ label, onPress, disabled = false }: { label: string; onPress(): void; disabled?: boolean }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

/** Header controls for the room-mapping step. Suggestions never apply themselves. */
export function SuggestControls({
  paired,
  running,
  error,
  pending,
  onSuggest,
  onCancel,
  onApplyAll,
}: {
  paired: boolean;
  running: boolean;
  error: string | null;
  pending: number;
  onSuggest(): void;
  onCancel(): void;
  onApplyAll(): void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.box} testID="import-suggest-controls">
      {paired ? (
        <View style={styles.row}>
          <SmallButton label="Suggest rooms" onPress={onSuggest} disabled={running} />
          {running ? <SmallButton label="Cancel suggestions" onPress={onCancel} /> : null}
          {pending > 0 ? <SmallButton label={`Apply all (${pending})`} onPress={onApplyAll} disabled={running} /> : null}
        </View>
      ) : (
        <Text style={styles.hint}>Pair the companion to get suggestions</Text>
      )}
      {running ? <Text accessibilityLiveRegion="polite" style={styles.hint}>Asking for suggestions…</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {paired ? <Text style={styles.hint}>Suggestions only change the choices on this screen. Nothing is saved until you confirm an import.</Text> : null}
    </View>
  );
}

/** Inline suggestion shown next to one note's room mapping. */
export function SuggestionRow({
  title,
  suggestion,
  rooms,
  disabled,
  onApply,
  onIgnore,
}: {
  title: string;
  suggestion: ImportSuggestion;
  rooms: readonly ExistingRoom[];
  disabled: boolean;
  onApply(): void;
  onIgnore(): void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.box} testID={`import-suggestion-${title}`}>
      <Text style={styles.text}>{describeSuggestion(suggestion, rooms)}</Text>
      {suggestion.subjects.length ? (
        <View style={styles.chips}>
          {suggestion.subjects.map((subject) => (
            <View key={subject} style={styles.chip}><Text style={styles.chipText}>{subject}</Text></View>
          ))}
        </View>
      ) : null}
      <View style={styles.row}>
        <SmallButton label={`Apply suggestion for ${title}`} onPress={onApply} disabled={disabled} />
        <SmallButton label={`Ignore suggestion for ${title}`} onPress={onIgnore} disabled={disabled} />
      </View>
    </View>
  );
}

const useStyles = createStyles((theme) => StyleSheet.create({
  box: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  text: { ...theme.text('body'), color: theme.color.text.primary },
  hint: { ...theme.text('bodySmall'), color: theme.color.text.tertiary },
  error: { ...theme.text('bodySmall'), color: theme.color.status.danger.text },
  button: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, backgroundColor: theme.color.accent.bg, justifyContent: 'center', alignItems: 'center' },
  buttonText: { ...theme.text('buttonCompact'), color: theme.color.accent.fg },
  disabled: { opacity: 0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: theme.color.border.hairline, backgroundColor: theme.color.bg.canvas },
  chipText: { ...theme.text('bodySmall'), color: theme.color.text.secondary },
}));

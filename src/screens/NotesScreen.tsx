import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { createStyles } from '../../design-theme/src/primitives';

import { createNote, listNotes, type Note } from '../db/notes';
import { formatNote, type NoteFormat, type NoteSelection } from '../features/notes/formatting';
import { MarkdownToolbar } from '../features/notes/MarkdownToolbar';
import { NotePreview } from '../features/notes/NotePreview';

type NoteFormProps = {
  title: string;
  body: string;
  saving: boolean;
  error: string | null;
  onChangeTitle: (value: string) => void;
  onChangeBody: (value: string) => void;
  onSubmit: () => void;
};

function NoteForm({
  title,
  body,
  saving,
  error,
  onChangeTitle,
  onChangeBody,
  onSubmit,
}: NoteFormProps) {
  const styles = useStyles();
  const disabled = saving || title.trim().length === 0;
  const bodyRef = useRef<ComponentRef<typeof TextInput>>(null);
  const selectionRef = useRef<NoteSelection>({ start: 0, end: 0 });
  const [selection, setSelection] = useState<NoteSelection | undefined>();
  const applyFormat = (format: NoteFormat) => {
    const next = formatNote(body, selectionRef.current, format);
    onChangeBody(next.text);
    selectionRef.current = next.selection;
    setSelection(next.selection);
    bodyRef.current?.focus();
  };
  return (
    <View>
      <Text accessibilityRole="header" style={styles.title}>
        Stome
      </Text>
      <Text style={styles.subtitle}>Notes stay on this device.</Text>
      <Text style={styles.label}>Title</Text>
      <TextInput
        accessibilityLabel="Note title"
        autoCapitalize="sentences"
        onChangeText={onChangeTitle}
        nativeID="note-title"
        placeholder="Title"
        style={styles.input}
        testID="note-title-input"
        value={title}
      />
      <Text style={styles.label}>Note</Text>
      <MarkdownToolbar context="note body" onFormat={applyFormat} />
      <TextInput
        ref={bodyRef}
        accessibilityLabel="Note body"
        multiline
        onChangeText={onChangeBody}
        onSelectionChange={(event) => {
          selectionRef.current = event.nativeEvent.selection;
          setSelection(undefined);
        }}
        nativeID="note-body"
        placeholder="Write a note"
        style={[styles.input, styles.bodyInput]}
        testID="note-body-input"
        value={body}
        selection={selection}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onSubmit}
        style={[styles.button, disabled ? styles.buttonDisabled : null]}
        testID="add-note-button"
      >
        <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save note'}</Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Text style={styles.section}>Your notes</Text>
    </View>
  );
}

function NoteCard({ note }: { note: Note }) {
  const styles = useStyles();
  return (
    <View style={styles.note} testID={`note-${note.id}`}>
      <Text style={styles.noteTitle}>{note.title}</Text>
      {note.body.length > 0 ? <NotePreview body={note.body} /> : null}
      <Text style={styles.noteMeta}>{new Date(note.createdAt).toLocaleString()}</Text>
    </View>
  );
}

function EmptyNotes() {
  const styles = useStyles();
  return <Text style={styles.empty}>No notes yet.</Text>;
}

export function NotesScreen() {
  const styles = useStyles();
  const db = useSQLiteContext();
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const rows = await listNotes(db);
    setNotes(rows);
  }, [db]);

  useEffect(() => {
    let active = true;
    listNotes(db)
      .then((rows) => {
        if (!active) {
          return;
        }
        setNotes(rows);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) {
          return;
        }
        setError(caught instanceof Error ? caught.message : 'Could not load notes');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [db]);

  async function onSubmit() {
    setSaving(true);
    setError(null);
    try {
      await createNote(db, { title, body });
      setTitle('');
      setBody('');
      await refresh();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Could not save the note');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
        <Text>Loading notes…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.screen}
      >
        <FlatList
          contentContainerStyle={styles.list}
          data={notes}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(note) => String(note.id)}
          ListEmptyComponent={EmptyNotes}
          ListHeaderComponent={
            <View style={styles.form}>
              <NoteForm
                body={body}
                error={error}
                onChangeBody={setBody}
                onChangeTitle={setTitle}
                onSubmit={() => {
                  void onSubmit();
                }}
                saving={saving}
                title={title}
              />
            </View>
          }
          renderItem={({ item }) => <NoteCard note={item} />}
          style={styles.listView}
          testID="notes-list"
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = createStyles((theme) => StyleSheet.create({
  screen: {
    backgroundColor: theme.color.bg.surface,
    flex: 1,
    paddingTop: Platform.OS === 'android' ? (NativeStatusBar.currentHeight ?? 0) : 0,
  },
  form: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  listView: {
    flex: 1,
  },
  list: {
    paddingBottom: 32,
    paddingHorizontal: 16,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
  },
  title: { ...theme.text('screenTitle'),
    color: theme.color.text.primary,
  },
  subtitle: { ...theme.text('bodySmall'),
    color: theme.color.text.secondary,
    marginTop: 4,
  },
  label: { ...theme.text('label'),
    color: theme.color.text.secondary,
    marginBottom: 6,
    marginTop: 16,
  },
  input: { ...theme.text('bodySmall'),
    borderColor: theme.color.border.hairline,
    borderRadius: 8,
    borderWidth: 1,
    color: theme.color.text.primary,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bodyInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  button: {
    alignItems: 'center',
    backgroundColor: theme.color.accent.bg,
    borderRadius: 8,
    marginTop: 12,
    paddingVertical: 12,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: { ...theme.text('buttonCompact'),
    color: theme.color.accent.fg,
  },
  error: {
    color: theme.color.status.danger.text,
    marginTop: 8,
  },
  section: { ...theme.text('cardTitle'),
    color: theme.color.text.primary,
    marginTop: 24,
  },
  empty: { ...theme.text('bodySmall'),
    color: theme.color.text.secondary,
    marginTop: 8,
  },
  note: {
    borderColor: theme.color.border.hairline,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  noteTitle: { ...theme.text('cardTitle'),
    color: theme.color.text.primary,
  },
  noteBody: { ...theme.text('bodySmall'),
    color: theme.color.text.secondary,
    marginTop: 4,
  },
  noteMeta: { ...theme.text('label'),
    color: theme.color.text.tertiary,
    marginTop: 6,
  },
  include: {
    alignSelf: 'flex-start',
    marginBottom: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  includeText: { ...theme.text('label'),
    color: theme.color.text.primary,
  },
  answer: {
    borderTopColor: theme.color.border.hairline,
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 8,
  },
  answerLabel: { ...theme.text('label'),
    color: theme.color.text.secondary,
    marginBottom: 4,
  },
}));

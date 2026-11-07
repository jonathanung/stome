import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
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

import { createNote, listNotes, type Note } from '../db/notes';

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
  const disabled = saving || title.trim().length === 0;
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
      <TextInput
        accessibilityLabel="Note body"
        multiline
        onChangeText={onChangeBody}
        nativeID="note-body"
        placeholder="Write a note"
        style={[styles.input, styles.bodyInput]}
        testID="note-body-input"
        value={body}
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
  return (
    <View style={styles.note} testID={`note-${note.id}`}>
      <Text style={styles.noteTitle}>{note.title}</Text>
      {note.body.length > 0 ? <Text style={styles.noteBody}>{note.body}</Text> : null}
      <Text style={styles.noteMeta}>{new Date(note.createdAt).toLocaleString()}</Text>
    </View>
  );
}

function EmptyNotes() {
  return <Text style={styles.empty}>No notes yet.</Text>;
}

export function NotesScreen() {
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

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#ffffff',
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
  title: {
    color: '#111111',
    fontSize: 32,
    fontWeight: '700',
  },
  subtitle: {
    color: '#555555',
    fontSize: 15,
    marginTop: 4,
  },
  label: {
    color: '#333333',
    fontSize: 13,
    marginBottom: 6,
    marginTop: 16,
  },
  input: {
    borderColor: '#cccccc',
    borderRadius: 8,
    borderWidth: 1,
    color: '#111111',
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bodyInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 8,
    marginTop: 12,
    paddingVertical: 12,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: '#8a1f1f',
    marginTop: 8,
  },
  section: {
    color: '#111111',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 24,
  },
  empty: {
    color: '#555555',
    fontSize: 15,
    marginTop: 8,
  },
  note: {
    borderColor: '#e2e2e2',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  noteTitle: {
    color: '#111111',
    fontSize: 17,
    fontWeight: '600',
  },
  noteBody: {
    color: '#333333',
    fontSize: 15,
    marginTop: 4,
  },
  noteMeta: {
    color: '#777777',
    fontSize: 12,
    marginTop: 6,
  },
  include: {
    alignSelf: 'flex-start',
    marginBottom: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  includeText: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '600',
  },
  answer: {
    borderTopColor: '#e2e2e2',
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 8,
  },
  answerLabel: {
    color: '#333333',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
});

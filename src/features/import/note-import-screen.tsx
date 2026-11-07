import { randomUUID } from 'expo-crypto';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createStyles } from '../../../design-theme/src/primitives';
import { createCommit } from '../../data/commit';
import type { Room } from '../../data/models';
import { listChunks, listRooms } from '../../data/queries';
import { expoDriver } from '../../db/expo-driver';
import { sourceIdentity } from '../../import/markdown';
import { pickNotes, type PickedNote } from '../../import/pick-notes';
import { destinationForMapping, unsetRoomMapping, type RoomMapping } from '../../import/room-map';
import { changeSourcePath, changeSubjects, createSubjectReview, type SubjectReview } from '../../import/review-draft';
import { RoomMappingControl } from './room-mapping';

interface Draft extends SubjectReview {
  id: string;
  note: PickedNote;
  mapping: RoomMapping;
  result?: string;
  done?: boolean;
}

function Action({ label, onPress, disabled = false }: { label: string; onPress(): void; disabled?: boolean }) {
  const styles = useStyles();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

function Field({ label, value, onChangeText, disabled = false }: { label: string; value: string; onChangeText(value: string): void; disabled?: boolean }) {
  const styles = useStyles();
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} editable={!disabled} autoCapitalize="none" autoCorrect={false} style={styles.input} /></View>;
}

export default function NoteImportScreen() {
  const styles = useStyles();
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const commit = useMemo(() => createCommit(db, { now: Date.now, newId: randomUUID }), [db]);
  const [collection, setCollection] = useState('my notes');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [preview, setPreview] = useState<{ title: string; bodies: string[] } | null>(null);

  const refresh = useCallback(async () => setRooms(await listRooms(db)), [db]);
  useEffect(() => {
    let active = true;
    listRooms(db).then((items) => { if (active) setRooms(items); }).catch((error) => { if (active) setErrors([String(error)]); });
    return () => { active = false; };
  }, [db]);
  const update = (id: string, patch: Partial<Draft>) => setDrafts((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  const changeReview = (id: string, transition: (draft: Draft) => Draft) => setDrafts((items) => items.map((item) => item.id === id ? transition(item) : item));

  const choose = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await pickNotes();
      if (result) {
        setErrors(result.errors);
        setDrafts(result.notes.map((note) => ({ id: randomUUID(), note, ...createSubjectReview(note.path, note.subjects), mapping: unsetRoomMapping() })));
      }
    } catch (error) { setErrors([String(error)]); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const save = async (draft: Draft) => {
    const destination = destinationForMapping(draft.mapping);
    if (busyRef.current || draft.done || !destination) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const sourceId = sourceIdentity(collection, draft.path);
      const result = await commit({
        opId: randomUUID(), kind: 'import.note', source: 'import', confirmed: true,
        payload: { sourceId, fingerprint: draft.note.fingerprint, bodies: draft.note.bodies, subjects: draft.subjects.split(','), destination },
      });
      if (result.ok) {
        update(draft.id, { done: true, result: result.value.skipped ? 'Already imported. Your existing notes were kept.' : `Saved ${result.value.chunkIds.length} chunks.` });
        await refresh();
      } else update(draft.id, { result: result.error.message });
    } catch (error) { update(draft.id, { result: String(error) }); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const showRoom = async (room: Room) => {
    try {
      const chunks = await listChunks(db, room.id);
      setPreview({ title: room.name, bodies: chunks.map((chunk) => chunk.body) });
    } catch (error) { setErrors([String(error)]); }
  };

  return (
    <SafeAreaView edges={['bottom']} style={styles.root}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={drafts} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}
          ListHeaderComponent={<View style={styles.section}>
            <Text style={styles.title}>Bring your notes</Text>
            <Text style={styles.text}>Import Markdown from Obsidian or another app. Choose up to 20 .md files, 1 MiB each. PDF and native notebook files are not supported yet.</Text>
            <Field label="Source collection" value={collection} onChangeText={setCollection} disabled={busy} />
            <Text style={styles.hint}>Use the same collection and source paths when re-importing. Review each note before confirming.</Text>
            <Action label={drafts.length ? 'Choose another batch' : 'Choose Markdown files'} onPress={choose} disabled={busy} />
            {busy ? <ActivityIndicator accessibilityLabel="Working on notes" /> : null}
            {errors.map((error, i) => <Text key={i} accessibilityRole="alert" style={styles.error}>{error}</Text>)}
          </View>}
          renderItem={({ item }) => <View style={styles.card}>
            <Text style={styles.heading}>{item.note.title}</Text>
            <Text style={styles.text}>{item.note.bodies.length} chunks · suggested subjects need review</Text>
            {item.note.warnings.map((warning) => <Text key={warning} style={styles.hint}>{warning}</Text>)}
            {item.folderWarning ? <Text style={styles.hint}>{item.folderWarning}</Text> : null}
            <Action label={`Preview ${item.note.title}`} onPress={() => setPreview({ title: item.note.title, bodies: item.note.bodies })} />
            <Field label={`Source path for ${item.note.title}`} value={item.path} disabled={busy || item.done} onChangeText={(path) => changeReview(item.id, (draft) => changeSourcePath(draft, path))} />
            <Text style={styles.hint}>Include its original folder if another note has the same filename. Folders suggest subjects until you edit subjects.</Text>
            <Field label={`Subjects for ${item.note.title} (comma separated)`} value={item.subjects} disabled={busy || item.done} onChangeText={(subjects) => changeReview(item.id, (draft) => changeSubjects(draft, subjects))} />
            <RoomMappingControl title={item.note.title} subjects={item.subjects} rooms={rooms} mapping={item.mapping} disabled={busy || item.done === true} onChange={(mapping) => update(item.id, { mapping, result: undefined })} />
            <Action label={item.done ? 'Imported' : `Confirm import of ${item.note.title}`} onPress={() => save(item)} disabled={busy || item.done || !destinationForMapping(item.mapping)} />
            {item.result ? <Text accessibilityLiveRegion="polite" style={item.done ? styles.text : styles.error}>{item.result}</Text> : null}
          </View>}
          ListFooterComponent={<View style={styles.section}>
            <Text style={styles.heading}>Your rooms</Text>
            {rooms.length ? rooms.map((room) => <Action key={room.id} label={`View ${room.name}`} onPress={() => showRoom(room)} />) : <Text style={styles.hint}>Imported notes will appear here. Imports do not award study rewards.</Text>}
          </View>}
        />
      </KeyboardAvoidingView>
      <Modal visible={preview !== null} animationType="slide" onRequestClose={() => setPreview(null)}>
        <SafeAreaView style={styles.root}><FlatList contentContainerStyle={styles.page} data={preview?.bodies ?? []} keyExtractor={(_, i) => String(i)} ListHeaderComponent={<View style={styles.section}><Text style={styles.title}>{preview?.title}</Text><Action label="Close preview" onPress={() => setPreview(null)} /></View>} ListEmptyComponent={<Text style={styles.text}>No chunks in this room.</Text>} renderItem={({ item, index }) => <View style={styles.card}><Text style={styles.label}>Chunk {index + 1}</Text><Text selectable style={styles.text}>{item}</Text></View>} /></SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const useStyles = createStyles((theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg.canvas },
  page: { padding: 20, gap: 20, width: '100%', maxWidth: 720, alignSelf: 'center', paddingBottom: 48 },
  section: { gap: 12 },
  card: { backgroundColor: theme.color.bg.surface, padding: 20, gap: 12, borderRadius: 18, borderWidth: 1, borderColor: theme.color.border.hairline },
  title: { fontSize: 30, fontWeight: '700', color: theme.color.text.primary },
  heading: { fontSize: 22, fontWeight: '600', color: theme.color.text.primary },
  text: { fontSize: 17, lineHeight: 25, color: theme.color.text.secondary },
  hint: { fontSize: 14, lineHeight: 21, color: theme.color.text.tertiary },
  label: { fontSize: 15, color: theme.color.text.secondary, fontWeight: '600' },
  field: { gap: 6 },
  input: { minHeight: 48, borderWidth: 1, borderColor: theme.color.border.strong, borderRadius: 10, padding: 12, fontSize: 17, color: theme.color.text.primary, backgroundColor: theme.color.bg.surface },
  button: { minHeight: 48, borderRadius: 12, padding: 12, backgroundColor: theme.color.accent.bg, justifyContent: 'center', alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600', color: theme.color.accent.fg },
  disabled: { opacity: 0.5 },
  error: { fontSize: 15, lineHeight: 22, color: theme.color.status.danger.text },
}));

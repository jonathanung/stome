import { randomUUID } from 'expo-crypto';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createCommit } from '../../data/commit';
import type { Room } from '../../data/models';
import { listChunks, listRooms } from '../../data/queries';
import { expoDriver } from '../../db/expo-driver';
import { sourceIdentity } from '../../import/markdown';
import { pickNotes, type PickedNote } from '../../import/pick-notes';

interface Draft {
  id: string;
  note: PickedNote;
  path: string;
  subjects: string;
  roomId: string | null;
  name: string;
  result?: string;
  done?: boolean;
}

function Action({ label, onPress, disabled = false }: { label: string; onPress(): void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

function Field({ label, value, onChangeText, disabled = false }: { label: string; value: string; onChangeText(value: string): void; disabled?: boolean }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} editable={!disabled} autoCapitalize="none" autoCorrect={false} style={styles.input} /></View>;
}

export default function NoteImportScreen() {
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
  const [roomPicker, setRoomPicker] = useState<string | null>(null);

  const refresh = useCallback(async () => setRooms(await listRooms(db)), [db]);
  useEffect(() => {
    let active = true;
    listRooms(db).then((items) => { if (active) setRooms(items); }).catch((error) => { if (active) setErrors([String(error)]); });
    return () => { active = false; };
  }, [db]);
  const update = (id: string, patch: Partial<Draft>) => setDrafts((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));

  const choose = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await pickNotes();
      if (result) {
        setErrors(result.errors);
        setDrafts(result.notes.map((note) => ({ id: randomUUID(), note, path: note.path, subjects: note.subjects.join(', '), roomId: null, name: note.title.slice(0, 80) })));
      }
    } catch (error) { setErrors([String(error)]); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const save = async (draft: Draft) => {
    if (busyRef.current || draft.done) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const sourceId = sourceIdentity(collection, draft.path);
      const result = await commit({
        opId: randomUUID(), kind: 'import.note', source: 'import', confirmed: true,
        payload: { sourceId, fingerprint: draft.note.fingerprint, bodies: draft.note.bodies, subjects: draft.subjects.split(','), destination: draft.roomId ? { roomId: draft.roomId } : { name: draft.name } },
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
            <Action label={`Preview ${item.note.title}`} onPress={() => setPreview({ title: item.note.title, bodies: item.note.bodies })} />
            <Field label={`Source path for ${item.note.title}`} value={item.path} disabled={busy || item.done} onChangeText={(path) => update(item.id, { path })} />
            <Text style={styles.hint}>Include its original folder if another note has the same filename.</Text>
            <Field label={`Subjects for ${item.note.title} (comma separated)`} value={item.subjects} disabled={busy || item.done} onChangeText={(subjects) => update(item.id, { subjects })} />
            <Action label={item.roomId ? `Room: ${rooms.find((room) => room.id === item.roomId)?.name ?? 'unavailable'}` : 'Destination: new room'} disabled={busy || item.done} onPress={() => setRoomPicker(item.id)} />
            {!item.roomId ? <Field label={`New room name for ${item.note.title}`} value={item.name} disabled={busy || item.done} onChangeText={(name) => update(item.id, { name })} /> : null}
            <Action label={item.done ? 'Imported' : `Confirm import of ${item.note.title}`} onPress={() => save(item)} disabled={busy || item.done} />
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
      <Modal visible={roomPicker !== null} animationType="slide" onRequestClose={() => setRoomPicker(null)}>
        <SafeAreaView style={styles.root}><FlatList contentContainerStyle={styles.page} data={rooms} keyExtractor={(room) => room.id} ListHeaderComponent={<View style={styles.section}><Text style={styles.title}>Choose a room</Text><Action label="Cancel" onPress={() => setRoomPicker(null)} /><Action label="Create a new room" onPress={() => { if (roomPicker) update(roomPicker, { roomId: null }); setRoomPicker(null); }} /></View>} renderItem={({ item }) => <View style={styles.section}><Action label={item.name} onPress={() => { if (roomPicker) update(roomPicker, { roomId: item.id }); setRoomPicker(null); }} /></View>} /></SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f6f4ee' },
  page: { padding: 20, gap: 20, width: '100%', maxWidth: 720, alignSelf: 'center', paddingBottom: 48 },
  section: { gap: 12 },
  card: { backgroundColor: '#fffdf8', padding: 20, gap: 12, borderRadius: 18, borderWidth: 1, borderColor: '#d8d3c8' },
  title: { fontSize: 30, fontWeight: '700', color: '#292820' },
  heading: { fontSize: 22, fontWeight: '600', color: '#292820' },
  text: { fontSize: 17, lineHeight: 25, color: '#3f4036' },
  hint: { fontSize: 14, lineHeight: 21, color: '#626453' },
  label: { fontSize: 15, color: '#3f4036', fontWeight: '600' },
  field: { gap: 6 },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#777b67', borderRadius: 10, padding: 12, fontSize: 17, color: '#292820', backgroundColor: '#fffdf8' },
  button: { minHeight: 48, borderRadius: 12, padding: 12, backgroundColor: '#424e35', justifyContent: 'center', alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600', color: '#ffffff' },
  disabled: { opacity: 0.5 },
  error: { fontSize: 15, lineHeight: 22, color: '#9b2929' },
});

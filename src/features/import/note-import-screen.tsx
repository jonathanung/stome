import { randomUUID } from 'expo-crypto';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, createStyles } from '../../../design-theme/src/primitives';
import { createCommit } from '../../data/commit';
import type { Room } from '../../data/models';
import { listChunks, listRooms } from '../../data/queries';
import { expoDriver } from '../../db/expo-driver';
import { sourceIdentity } from '../../import/markdown';
import { onenotePathSubjects, onenoteSourceIdentity } from '../../import/onenote/parse';
import { pdfPathSubjects, pdfSourceIdentity } from '../../import/pdf/parse';
import { pickNotes, type PickedNote } from '../../import/pick-notes';
import { destinationForMapping, unsetRoomMapping, type RoomMapping } from '../../import/room-map';
import { changeSourcePath, changeSubjects, createSubjectReview, type SubjectReview } from '../../import/review-draft';
import { ImportChooseFiles, ImportSteps } from './import-choose-files';
import { RoomMappingControl } from './room-mapping';
import { router } from 'expo-router';

interface Draft extends SubjectReview {
  id: string;
  note: PickedNote;
  mapping: RoomMapping;
  result?: string;
  done?: boolean;
}

function applyOnenoteFolders<T extends SubjectReview>(note: PickedNote, draft: T): T {
  if (!note.exportFormat || note.exportFormat === 'markdown' || draft.subjectsEdited) return draft;
  const folders = note.exportFormat === 'pdf' ? pdfPathSubjects : onenotePathSubjects;
  return { ...draft, ...folders(draft.fileSubjects, draft.path) };
}

function Action({ label, onPress, disabled = false }: { label: string; onPress(): void; disabled?: boolean }) {
  const styles = useStyles();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

function Field({ label, value, onChangeText, disabled = false }: { label: string; value: string; onChangeText(value: string): void; disabled?: boolean }) {
  const styles = useStyles();
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} editable={!disabled} autoCapitalize="none" autoCorrect={false} style={styles.input} /></View>;
}

function destinationLabel(mapping: RoomMapping, rooms: readonly Room[]): string {
  const destination = destinationForMapping(mapping);
  if (destination && 'roomId' in destination) return rooms.find((room) => room.id === destination.roomId)?.name ?? 'unavailable';
  return destination?.name ?? '';
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
  const [stage, setStage] = useState<'choose' | 'review'>('choose');
  const [preview, setPreview] = useState<{ title: string; bodies: string[] } | null>(null);

  const mapped = drafts.filter((draft) => destinationForMapping(draft.mapping)).length;
  const needRoom = drafts.length - mapped;
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
        setDrafts(result.notes.map((note) => ({ id: randomUUID(), note, ...applyOnenoteFolders(note, createSubjectReview(note.path, note.subjects)), mapping: unsetRoomMapping() })));
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
      const format = draft.note.exportFormat;
      const sourceId = format === 'pdf'
        ? pdfSourceIdentity(collection, draft.path)
        : format && format !== 'markdown' ? onenoteSourceIdentity(collection, draft.path) : sourceIdentity(collection, draft.path);
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

  if (stage === 'choose') {
    return (
      <SafeAreaView edges={['bottom']} style={styles.root}>
        <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.wide}>
            <ImportChooseFiles
              collection={collection} onCollection={setCollection} busy={busy}
              rows={drafts.map((d) => ({ id: d.id, name: d.note.path, path: d.path, disabled: d.done }))}
              onPath={(id, path) => changeReview(id, (draft) => applyOnenoteFolders(draft.note, changeSourcePath(draft, path)))}
              onRemove={(id) => setDrafts((items) => items.filter((item) => item.id !== id))}
              onChoose={choose}
              onCancel={() => { setDrafts([]); setErrors([]); }}
              onPreview={() => setStage('review')}
              onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            />
            {errors.map((error, i) => <Text key={i} accessibilityRole="alert" style={styles.error}>{error}</Text>)}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.root}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={drafts} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}
          ListHeaderComponent={<View style={styles.section}>
            <ImportSteps current={2} />
            <Action label="Back to files" onPress={() => setStage('choose')} />
            <Text style={styles.title}>Review and pick rooms</Text>
            <Text style={styles.text}>Import Markdown, an HTML, MHTML, or DOCX file exported from OneNote, or a PDF (for example a GoodNotes, OneNote or Freeform export). Choose up to 20 files: 1 MiB each, or 8 MiB for a PDF. From a PDF only selectable text is imported, one chunk per page; handwriting and images are not recognized. Native .one files and ink are not imported.</Text>
            <Field label="Source collection" value={collection} onChangeText={setCollection} disabled={busy} />
            <Text style={styles.hint}>Use the same collection and source paths when re-importing. Review each note before confirming.</Text>
            <Action label={drafts.length ? 'Choose another batch' : 'Choose Markdown, OneNote or PDF files'} onPress={choose} disabled={busy} />
            {busy ? <ActivityIndicator accessibilityLabel="Working on notes" /> : null}
            {errors.map((error, i) => <Text key={i} accessibilityRole="alert" style={styles.error}>{error}</Text>)}
          </View>}
          renderItem={({ item }) => <View style={styles.card}>
            <Text style={styles.heading}>{item.note.title}</Text>
            {item.done ? <Badge tone="success" label="imported" /> : destinationForMapping(item.mapping) ? <Badge tone="success" label={`→ ${destinationLabel(item.mapping, rooms)}`} /> : <Badge tone="danger" label="needs a room" />}
            <Text style={styles.text}>{item.note.bodies.length} chunks · suggested subjects need review</Text>
            {item.note.warnings.map((warning) => <Text key={warning} style={styles.hint}>{warning}</Text>)}
            {item.folderWarning ? <Text style={styles.hint}>{item.folderWarning}</Text> : null}
            <Action label={`Preview ${item.note.title}`} onPress={() => setPreview({ title: item.note.title, bodies: item.note.bodies })} />
            <Field label={`Source path for ${item.note.title}`} value={item.path} disabled={busy || item.done} onChangeText={(path) => changeReview(item.id, (draft) => applyOnenoteFolders(draft.note, changeSourcePath(draft, path)))} />
            <Text style={styles.hint}>Include its original folder if another note has the same filename. Folders suggest subjects until you edit subjects.</Text>
            <Field label={`Subjects for ${item.note.title} (comma separated)`} value={item.subjects} disabled={busy || item.done} onChangeText={(subjects) => changeReview(item.id, (draft) => changeSubjects(draft, subjects))} />
            <RoomMappingControl title={item.note.title} subjects={item.subjects} rooms={rooms} mapping={item.mapping} disabled={busy || item.done === true} onChange={(mapping) => update(item.id, { mapping, result: undefined })} />
            <Action label={item.done ? 'Imported' : `Confirm import of ${item.note.title}`} onPress={() => save(item)} disabled={busy || item.done || !destinationForMapping(item.mapping)} />
            {item.result ? <Text accessibilityLiveRegion="polite" style={item.done ? styles.text : styles.error}>{item.result}</Text> : null}
          </View>}
          ListFooterComponent={<View style={styles.section}>
            {drafts.length ? <Text style={styles.hint}>{`${mapped} of ${drafts.length} notes have a room${needRoom ? ` · ${needRoom} need a room before you can save` : ''}`}</Text> : null}
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
  wide: { padding: 20, paddingBottom: 48, gap: 12 },
  card: { backgroundColor: theme.color.bg.surface, padding: 20, gap: 12, borderRadius: 18, borderWidth: 1, borderColor: theme.color.border.hairline },
  title: { ...theme.text('screenTitle'), color: theme.color.text.primary },
  heading: { ...theme.text('title'), color: theme.color.text.primary },
  text: { ...theme.text('body'), color: theme.color.text.secondary },
  hint: { ...theme.text('bodySmall'), color: theme.color.text.tertiary },
  label: { ...theme.text('buttonCompact'), color: theme.color.text.secondary, },
  field: { gap: 6 },
  input: { ...theme.text('body'), minHeight: 48, borderWidth: 1, borderColor: theme.color.border.strong, borderRadius: 10, padding: 12, color: theme.color.text.primary, backgroundColor: theme.color.bg.surface },
  button: { minHeight: 48, borderRadius: 12, padding: 12, backgroundColor: theme.color.accent.bg, justifyContent: 'center', alignItems: 'center' },
  buttonText: { ...theme.text('buttonCompact'), color: theme.color.accent.fg },
  disabled: { opacity: 0.5 },
  error: { ...theme.text('bodySmall'), color: theme.color.status.danger.text },
}));

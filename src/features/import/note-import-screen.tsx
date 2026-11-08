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
import { freeformPathSubjects, freeformSourceIdentity } from '../../import/freeform/parse';
import { sourceIdentity } from '../../import/markdown';
import { onenotePathSubjects, onenoteSourceIdentity } from '../../import/onenote/parse';
import { pdfPathSubjects, pdfSourceIdentity } from '../../import/pdf/parse';
import { pickNotes, type PickedNote } from '../../import/pick-notes';
import { destinationForMapping, unsetRoomMapping, type RoomMapping } from '../../import/room-map';
import { changeSourcePath, changeSubjects, createSubjectReview, type SubjectReview } from '../../import/review-draft';
import { ImportChooseFiles } from './import-choose-files';
import { ImportReviewRooms, groupOf, type DuplicateState } from './import-review-rooms';
import { RoomMappingControl } from './room-mapping';
import { router } from 'expo-router';
import { HarnessError } from '../../harness/contract';
import { companionProvider } from '../../harness/companionClient';
import { getCompanionSettings, useCompanionSettings } from '../../harness/companionSettings';
import { completeReadTool } from '../../harness/provider';
import { IMPORT_TOOL_NAME, type ImportSuggestOutput, type ImportSuggestion } from '../../harness/tools';
import { applySuggestion, buildSuggestBatches } from '../../import/suggest';
import { SuggestControls, SuggestionRow } from './suggest-ui';

interface Draft extends SubjectReview {
  id: string;
  note: PickedNote;
  mapping: RoomMapping;
  result?: string;
  done?: boolean;
  skipped?: boolean;
  duplicate?: DuplicateState;
}

function applyOnenoteFolders<T extends SubjectReview>(note: PickedNote, draft: T): T {
  if (!note.exportFormat || note.exportFormat === 'markdown' || draft.subjectsEdited) return draft;
  const folders = note.exportFormat === 'pdf' ? pdfPathSubjects : note.exportFormat === 'freeform-image' ? freeformPathSubjects : onenotePathSubjects;
  return { ...draft, ...folders(draft.fileSubjects, draft.path) };
}

function sourceIdFor(collection: string, draft: { path: string; note: PickedNote }): string {
  const format = draft.note.exportFormat;
  return format === 'pdf'
    ? pdfSourceIdentity(collection, draft.path)
    : format === 'freeform-image' ? freeformSourceIdentity(collection, draft.path)
    : format && format !== 'markdown' ? onenoteSourceIdentity(collection, draft.path) : sourceIdentity(collection, draft.path);
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
  const paired = useCompanionSettings().token.trim() !== '';
  const [suggestions, setSuggestions] = useState<Record<string, ImportSuggestion>>({});
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const suggestAbort = useRef<AbortController | null>(null);
  useEffect(() => () => suggestAbort.current?.abort(), []);

  const suggestRooms = async () => {
    if (suggestAbort.current) return;
    const open = drafts.filter((draft) => !draft.done);
    if (!open.length) return;
    const controller = new AbortController();
    suggestAbort.current = controller;
    setSuggesting(true);
    setSuggestError(null);
    try {
      const settings = getCompanionSettings();
      const provider = companionProvider({ baseUrl: settings.url, token: settings.token });
      const batches = buildSuggestBatches(open.map((draft) => ({ id: draft.id, title: draft.note.title, bodies: draft.note.bodies })), rooms);
      const found: Record<string, ImportSuggestion> = {};
      for (const batch of batches) {
        const out = await completeReadTool<ImportSuggestOutput>(
          provider, { tool: IMPORT_TOOL_NAME, input: batch, scenario: settings.scenario }, controller.signal,
        );
        for (const suggestion of out.suggestions) found[suggestion.noteId] = suggestion;
      }
      if (!controller.signal.aborted) setSuggestions((current) => ({ ...current, ...found }));
    } catch (error) {
      if (controller.signal.aborted && error instanceof HarnessError && error.code === 'cancelled') setSuggestError(null);
      else if (!controller.signal.aborted) setSuggestError(error instanceof Error ? error.message : 'Suggestions failed');
    } finally {
      if (suggestAbort.current === controller) suggestAbort.current = null;
      if (!controller.signal.aborted || suggestAbort.current === null) setSuggesting(false);
    }
  };
  const cancelSuggest = () => suggestAbort.current?.abort();
  const dropSuggestion = (id: string) => setSuggestions((current) => { const { [id]: _removed, ...rest } = current; return rest; });
  const applyOne = (id: string) => {
    const suggestion = suggestions[id];
    if (!suggestion) return;
    setDrafts((items) => items.map((item) => {
      if (item.id !== id || item.done) return item;
      const applied = applySuggestion(suggestion, item.subjects);
      return { ...changeSubjects(item, applied.subjects), mapping: applied.mapping, result: undefined };
    }));
    dropSuggestion(id);
  };
  const applyAll = () => {
    const ids = Object.keys(suggestions).filter((id) => drafts.some((draft) => draft.id === id && !draft.done));
    ids.forEach(applyOne);
  };

  const mapped = drafts.filter((draft) => destinationForMapping(draft.mapping)).length;
  const needRoom = drafts.length - mapped;
  const refresh = useCallback(async () => setRooms(await listRooms(db)), [db]);
  useEffect(() => {
    let active = true;
    listRooms(db).then((items) => { if (active) setRooms(items); }).catch((error) => { if (active) setErrors([String(error)]); });
    return () => { active = false; };
  }, [db]);
  const dupKey = drafts.map((d) => `${d.id}:${d.path}:${d.note.fingerprint}`).join('|') + `#${collection}`;
  useEffect(() => {
    let active = true;
    (async () => {
      const found = new Map<string, DuplicateState | undefined>();
      for (const d of drafts) {
        try {
          const row = await db.get<{ fingerprint: string }>('SELECT fingerprint FROM import_sources WHERE source_id = ?', [sourceIdFor(collection, d)]);
          found.set(d.id, row ? (row.fingerprint === d.note.fingerprint ? 'same' : 'changed') : undefined);
        } catch { found.set(d.id, undefined); }
      }
      if (active) setDrafts((items) => items.map((item) => !item.done && found.has(item.id) && item.duplicate !== found.get(item.id) ? { ...item, duplicate: found.get(item.id) } : item));
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dupKey, db]);
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

  const save = async (draft: Draft): Promise<boolean> => {
    const destination = destinationForMapping(draft.mapping);
    if (draft.done || !destination) return false;
    try {
      const sourceId = sourceIdFor(collection, draft);
      const result = await commit({
        opId: randomUUID(), kind: 'import.note', source: 'import', confirmed: true,
        payload: { sourceId, fingerprint: draft.note.fingerprint, bodies: draft.note.bodies, subjects: draft.subjects.split(','), destination },
      });
      if (result.ok) {
        update(draft.id, { done: true, result: result.value.skipped ? 'Already imported. Your existing notes were kept.' : `Saved ${result.value.chunkIds.length} chunks.` });
        await refresh();
        return true;
      }
      update(draft.id, { result: result.error.message });
    } catch (error) { update(draft.id, { result: String(error) }); }
    return false;
  };

  /** Saves every note with a room, in order. Stops at the first failure so the user can fix it. */
  const saveAll = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      for (const draft of drafts.filter((d) => groupOf({ ...d, title: d.note.title, bodies: d.note.bodies, warnings: d.note.warnings, skipped: d.skipped === true, done: d.done === true }) === 'ready')) {
        if (!await save(draft)) break;
      }
    } finally { busyRef.current = false; setBusy(false); }
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
            />
            {errors.map((error, i) => <Text key={i} accessibilityRole="alert" style={styles.error}>{error}</Text>)}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.root}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.wide}>
        {drafts.length ? <View style={styles.section}>
          <SuggestControls paired={paired} running={suggesting} error={suggestError} pending={Object.keys(suggestions).length} onSuggest={suggestRooms} onCancel={cancelSuggest} onApplyAll={applyAll} />
          {drafts.filter((d) => suggestions[d.id] && !d.done).map((d) => (
            <SuggestionRow key={d.id} title={d.note.title} suggestion={suggestions[d.id]} rooms={rooms} disabled={busy} onApply={() => applyOne(d.id)} onIgnore={() => dropSuggestion(d.id)} />
          ))}
        </View> : null}
        <ImportReviewRooms
          notes={drafts.map((d) => ({ id: d.id, title: d.note.title, path: d.path, bodies: d.note.bodies, warnings: [...d.note.warnings, ...(d.folderWarning ? [d.folderWarning] : [])], subjects: d.subjects, mapping: d.mapping, skipped: d.skipped === true, done: d.done === true, duplicate: d.duplicate, result: d.result }))}
          rooms={rooms} busy={busy} errors={errors}
          onChangeMapping={(id, mapping) => update(id, { mapping, skipped: false, result: undefined })}
          onSkip={(id, skipped) => update(id, { skipped, result: undefined })}
          onKeepBoth={(id) => changeReview(id, (draft) => applyOnenoteFolders(draft.note, changeSourcePath(draft, draft.path.replace(/(\.[^./]+)?$/, ' (copy)$1'))))}
          onBack={() => setStage('choose')}
          onSave={saveAll}
        />
      </ScrollView>
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

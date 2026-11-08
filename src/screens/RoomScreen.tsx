import { randomUUID } from 'expo-crypto';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform,
  Pressable, Text, TextInput, View, useWindowDimensions,
} from 'react-native';

import { Button, Screen, useStoneTheme } from '../../design-theme/src/primitives';
import { createCommit } from '../data/commit';
import type { Annotation, Chunk, Room } from '../data/models';
import { LIMITS, type CommitError, type CommitResult, type OpKind } from '../data/operations';
import { getChunk, getRoom, listChunks, listDueChunks, listRoomAnnotations, listRoomDueAnswers } from '../data/queries';
import { planDueItems } from '../data/today';
import { expoDriver } from '../db/expo-driver';
import { followRoomBack, roomBackStep } from '../navigation/room-back';
import { MarkButtons } from '../features/review/MarkButtons';
import { reviewMarkController } from '../features/review/mark-attempt';
import { AnchoredChunkText, PinnedAnswer } from '../features/ask/AnchoredChunkText';
import type { ChunkFocus } from '../features/ask/citations';
import { watchRoomCaptureRefresh } from '../features/capture/commitSignal';
import { ChunkEditor, type EditResult } from '../features/chunks/ChunkEditor';
import { readDraft } from '../features/chunks/draft-store';
import { pastedParagraphs } from '../features/chunks/paste';
import { isSubmitShortcut, matchesQuery, mergeNotes } from '../features/notes/note-ops';
import { formatNote, type NoteFormat, type NoteSelection } from '../features/notes/formatting';
import { MarkdownToolbar } from '../features/notes/MarkdownToolbar';
import { PendingDeletes, type PendingDelete } from '../features/notes/pending-delete';
import { InkLassoActions } from '../features/ask/InkLassoActions';
import { PencilToolbar, type PencilTool } from '../features/ask/PencilToolbar';
import { RoomAskPanel, type AskMessage } from '../features/ask/RoomAskPanel';
import { RoomSidePanel } from '../features/room/RoomSidePanel';
import { actionError, clearLoadError as dismissLoadError, loadError, type ShownError } from '../features/room/errorOrigin';
import { createRoomReader } from '../features/room/roomLoadCoordinator';
import { PhoneRoomActions, PhoneRoomHeader, RoomTabs, SubjectChips, roomSubjects, type RoomTab } from '../features/room/PhoneRoomChrome';
import { Icon } from '../ui/Icon';
import { stageName } from '../ui/StageGlyph';
import { EmptyState, Field, Notice, SectionTitle, useColumn } from '../ui/kit';
import { RoomHeader } from './RoomHeader';

function leaveRoom() {
  followRoomBack(roomBackStep(router.canGoBack()), router);
}

function readable(error: CommitError): string {
  if (error.code === 'stale_revision') return 'This chunk was changed somewhere else. Reload to see the latest.';
  if (error.code === 'not_found') return 'This chunk no longer exists.';
  return error.message;
}

type ChunkWithAnnotations = Chunk & { annotations: Annotation[] };

type CitedBox = { top: number; bottom: number; height: number };

type CitedSpan = {
  scrollIntoView?: (options: { block: 'center'; inline: 'nearest'; behavior: 'auto' | 'smooth' }) => void;
  getBoundingClientRect?: () => CitedBox;
  parentElement?: CitedSpan | null;
  scrollHeight?: number;
  clientHeight?: number;
  scrollTop?: number;
};

function citedSpan(): CitedSpan | null {
  const doc = (globalThis as { document?: { querySelector: (selector: string) => CitedSpan | null } }).document;
  return doc?.querySelector('[data-testid="cited-anchor"]') ?? null;
}

function spanIsVisible(span: CitedSpan): boolean {
  const rect = span.getBoundingClientRect?.();
  const height = (globalThis as { innerHeight?: number }).innerHeight ?? 0;
  if (!rect || rect.height <= 0 || height <= 0) return false;
  return rect.top >= -1 && rect.bottom <= height + 1;
}

/** Scrolls the rendered span into the viewport. A card-level jump is not enough for a long chunk. */
function alignCitedSpan(span: CitedSpan): void {
  span.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'auto' });
  if (spanIsVisible(span)) return;
  const rect = span.getBoundingClientRect?.();
  const viewHeight = (globalThis as { innerHeight?: number }).innerHeight ?? 0;
  if (!rect || rect.height <= 0 || viewHeight <= 0) return;
  let parent = span.parentElement ?? null;
  while (parent) {
    const live = span.getBoundingClientRect?.();
    if (!live || spanIsVisible(span)) return;
    const scrollHeight = parent.scrollHeight ?? 0;
    const clientHeight = parent.clientHeight ?? 0;
    if (scrollHeight > clientHeight + 1 && typeof parent.scrollTop === 'number') {
      const parentRect = parent.getBoundingClientRect?.();
      if (parentRect && parentRect.height > 0) {
        const delta = live.top - parentRect.top - (clientHeight - live.height) / 2;
        parent.scrollTop += delta;
      }
    }
    parent = parent.parentElement ?? null;
  }
}

function annotationLabel(annotation: Annotation): string {
  if (annotation.type === 'stroke') return 'Whiteboard stroke';
  if (annotation.type === 'ai_answer') {
    const answer = annotation.payload.answer;
    return typeof answer === 'string' && answer.trim() ? `AI answer: ${answer}` : 'AI answer';
  }
  const note = annotation.payload.text ?? annotation.payload.note;
  return typeof note === 'string' && note.trim() ? `Highlight: ${note}` : 'Highlight';
}

export function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const commit = useMemo(() => createCommit(db, { now: Date.now, newId: randomUUID }), [db]);
  const theme = useStoneTheme();
  const column = useColumn();
  const listRef = useRef<FlatList<ChunkWithAnnotations>>(null);
  const scrollY = useRef(0);
  const composerRef = useRef<ComponentRef<typeof TextInput>>(null);
  const composerSelectionRef = useRef<NoteSelection>({ start: 0, end: 0 });
  const [composerSelection, setComposerSelection] = useState<NoteSelection | undefined>();
  const [focus, setFocus] = useState<ChunkFocus | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [chunks, setChunks] = useState<ChunkWithAnnotations[]>([]);
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [source, setSource] = useState('');
  const [annotating, setAnnotating] = useState<string | null>(null);
  const [annotationText, setAnnotationText] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [shownError, setShownError] = useState<ShownError>(null);
  const error = shownError?.message ?? null;
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [belowId, setBelowId] = useState<string | null>(null);
  const [belowText, setBelowText] = useState('');
  const belowRef = useRef<ComponentRef<typeof TextInput>>(null);
  const belowSelectionRef = useRef<NoteSelection>({ start: 0, end: 0 });
  const [belowSelection, setBelowSelection] = useState<NoteSelection | undefined>();
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const phone = width < 600;
  const splitView = width >= 900 && width < 1300;
  const wide = width >= 1300;
  const [dueToday, setDueToday] = useState(0);
  const [askOpen, setAskOpen] = useState(true);
  const [askMessages, setAskMessages] = useState<AskMessage[]>([]);
  const [penTool, setPenTool] = useState<PencilTool>('pen');
  const [inkSelected, setInkSelected] = useState(true);
  const [tab, setTab] = useState<RoomTab>('notes');
  const [subject, setSubject] = useState<string | null>(null);
  const subjects = useMemo(() => roomSubjects(chunks), [chunks]);
  const activeSubject = subject && subjects.includes(subject) ? subject : null;
  // Deletes wait out an undo window; the commit runs after this render, so
  // the effect below keeps handing it the latest list and functions.
  const chunksRef = useRef<ChunkWithAnnotations[]>([]);
  // A load failure is cleared by the next successful load, but an action error is not.
  const setActionError = useCallback((value: string | null) => {
    setShownError(actionError(value));
  }, []);
  const [deletes] = useState(() => new PendingDeletes({
    commit: async () => ({ ok: true }),
    onChange: setPendingDelete,
    onError: setActionError,
  }));
  // Leaving the room commits a pending delete rather than dropping it.
  useEffect(() => () => { void deletes.flush(); }, [deletes]);
  const visible = useMemo(() => tab !== 'notes' ? [] : activeSubject ? chunks.filter((chunk) => chunk.subjects.includes(activeSubject)) : chunks, [tab, chunks, activeSubject]);

  const load = useCallback(async () => {
    if (!id) return { room: null, chunks: [] as ChunkWithAnnotations[], due: 0 };
    const now = Date.now();
    const [nextRoom, notes, annotations, chunksDue, answersDue] = await Promise.all([
      getRoom(db, id), listChunks(db, id), listRoomAnnotations(db, id), listDueChunks(db, now), listRoomDueAnswers(db, id, now),
    ]);
    const byChunk = new Map<string, Annotation[]>();
    for (const annotation of annotations) {
      const group = byChunk.get(annotation.chunkId) ?? [];
      group.push(annotation);
      byChunk.set(annotation.chunkId, group);
    }
    const roomChunksDue = chunksDue.filter((d) => d.chunk.roomId === id);
    const due = planDueItems([...roomChunksDue, ...answersDue]).length;
    return { room: nextRoom, due, chunks: notes.map((chunk) => ({
      ...chunk, annotations: byChunk.get(chunk.id) ?? [],
    })) };
  }, [db, id]);
  const reportLoadError = useCallback((message: string) => {
    setShownError(loadError(message));
  }, []);
  const clearLoadError = useCallback(() => {
    setShownError(dismissLoadError);
  }, []);
  const applyRoom = useCallback((next: Awaited<ReturnType<typeof load>>) => {
    setRoom(next.room);
    setChunks(next.chunks);
    setDueToday(next.due);
    setLoading(false);
    clearLoadError();
  }, [clearLoadError]);
  // Focus loads, saves and quick-capture refreshes all read the same room.
  // The reader serialises refreshes and applies only the newest read, so a
  // later failure cannot discard an earlier successful capture refresh.
  const reader = useMemo(() => createRoomReader({
    read: load,
    apply: applyRoom,
    onError: (message) => { reportLoadError(message); setLoading(false); },
  }), [applyRoom, load, reportLoadError]);
  const refresh = reader.refresh;
  useFocusEffect(useCallback(() => {
    void reader.focus();
    // A capture from the global panel commits outside this screen; reload so the
    // note list and the Ask chunk selection see it without a reload. It is scoped
    // to focus so a retained, unfocused room does not keep reading the database.
    const stop = watchRoomCaptureRefresh(id ?? null, reader.refresh);
    const unsubscribe = reviewMarkController.subscribe(() => { void reader.refresh(); });
    return () => {
      stop();
      unsubscribe();
      // Blur drops reads and queued refreshes so they cannot apply after leaving.
      reader.blur();
    };
  }, [id, reader]));
  const openCitation = useCallback((next: ChunkFocus) => {
    setFocus(next);
  }, []);
  useEffect(() => {
    if (!focus || focus.end <= focus.start) return;
    const index = visible.findIndex((chunk) => chunk.id === focus.chunkId);
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reveal = () => {
      if (cancelled) return;
      const span = citedSpan();
      if (span) {
        if (spanIsVisible(span)) return;
        alignCitedSpan(span);
      } else if (index >= 0) {
        listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 });
      }
      if (attempt < 40) {
        attempt += 1;
        timer = setTimeout(reveal, 50);
      }
    };
    const frame = requestAnimationFrame(reveal);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [chunks, visible, phone, focus]);
  async function action(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try { await run(); await refresh(); }
    catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Could not save');
      await refresh().catch(() => undefined);
    } finally { setBusy(false); }
  }
  /**
   * Chunk edits from ChunkEditor. They skip `action`'s busy lock so autosave
   * never blocks other edits; commits are already queued by the boundary.
   */
  async function edit<K extends OpKind>(run: () => Promise<CommitResult<K>>): Promise<EditResult> {
    const result = await run();
    await refresh().catch(() => undefined);
    if (!result.ok) return { ok: false, message: readable(result.error) };
    const value = result.value as { revision?: number };
    return { ok: true, revision: value.revision };
  }
  const human = { source: 'human' as const, confirmed: false };

  /** Pasting several paragraphs into the composer adds one chunk per paragraph. */
  function onContentChange(next: string) {
    const paragraphs = pastedParagraphs(content, next);
    setContent(next);
    if (!paragraphs || !room) return;
    void action(async () => {
      const result = await commit({ opId: randomUUID(), kind: 'chunk.create', ...human,
        payload: { roomId: room.id, bodies: paragraphs, subjects: tags.split(','), sourceLink: source.trim() || null } });
      if (!result.ok) throw new Error(result.error.message);
      setContent('');
      setPasteNotice(`Added ${paragraphs.length} chunks from the pasted paragraphs.`);
    });
  }

  function formatComposer(format: NoteFormat) {
    const next = formatNote(content, composerSelectionRef.current, format);
    if (next.text.length > LIMITS.body) { setError('This note is too long to add formatting. Split it first.'); return; }
    setContent(next.text);
    composerSelectionRef.current = next.selection;
    setComposerSelection(next.selection);
    composerRef.current?.focus();
  }

  function formatBelow(format: NoteFormat) {
    const next = formatNote(belowText, belowSelectionRef.current, format);
    if (next.text.length > LIMITS.body) { setError('This note is too long to add formatting. Split it first.'); return; }
    setBelowText(next.text);
    belowSelectionRef.current = next.selection;
    setBelowSelection(next.selection);
    belowRef.current?.focus();
  }

  useEffect(() => {
    chunksRef.current = chunks;
    deletes.setCommit(async (entry) => {
      const latest = chunksRef.current.find((chunk) => chunk.id === entry.chunkId);
      if (!latest) return { ok: true };
      const result = await commit({ opId: randomUUID(), kind: 'chunk.delete', source: 'human', confirmed: false,
        expectedRevision: latest.revision, payload: { chunkId: latest.id } });
      await refresh().catch(() => undefined);
      return result.ok ? { ok: true } : { ok: false, message: readable(result.error) };
    });
  });

  /** Subjects stay for the next note (consecutive notes usually share a topic); the source link does not. */
  function addNote() {
    if (!content.trim() || !room || busy) return;
    void action(async () => {
      const result = await commit({ opId: randomUUID(), kind: 'chunk.create', ...human,
        payload: { roomId: room.id, bodies: [content], subjects: tags.split(','), sourceLink: source.trim() || null } });
      if (!result.ok) throw new Error(result.error.message);
      setContent(''); setSource(''); setPasteNotice(null);
      setAddedId(result.value.chunkIds[0] ?? null);
      requestAnimationFrame(() => composerRef.current?.focus());
    });
  }

  /**
   * The composer is at the top and new notes go to the end: "Show it" scrolls
   * there. Far rows are not drawn yet, so retry until the note is on screen
   * (the same approach as revealing a citation).
   */
  function showAdded() {
    const id = addedId;
    setAddedId(null);
    const index = shown.findIndex((chunk) => chunk.id === id);
    if (!id || index < 0) return;
    const doc = (globalThis as { document?: { querySelector(selector: string): { getBoundingClientRect(): { top: number; bottom: number } } | null } }).document;
    const viewHeight = (globalThis as { innerHeight?: number }).innerHeight ?? 0;
    let tries = 0;
    const step = () => {
      listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.3 });
      const rect = doc?.querySelector(`[data-testid="chunk-${id}"]`)?.getBoundingClientRect();
      const onScreen = rect !== undefined && rect.top >= 0 && rect.bottom <= viewHeight;
      if (!onScreen && tries < 20) {
        tries += 1;
        setTimeout(step, 60);
      }
    };
    step();
  }

  /** A new note right below `item`, taking its subjects. */
  function addBelow(item: ChunkWithAnnotations) {
    if (!belowText.trim() || !room || busy) return;
    void action(async () => {
      const result = await commit({ opId: randomUUID(), kind: 'chunk.create', ...human,
        payload: { roomId: room.id, bodies: [belowText], subjects: item.subjects, index: item.position + 1 } });
      if (!result.ok) throw new Error(result.error.message);
      setBelowText(''); setBelowId(null);
    });
  }

  /** Split: create the tail below first, then shorten this note, so a failure can duplicate text but never lose it. */
  async function splitNote(item: ChunkWithAnnotations, head: string, tail: string, rev: number): Promise<EditResult> {
    if (!room) return { ok: false, message: 'This room is not loaded.' };
    const created = await commit({ opId: randomUUID(), kind: 'chunk.create', ...human,
      payload: { roomId: room.id, bodies: [tail], subjects: item.subjects, index: item.position + 1 } });
    if (!created.ok) {
      await refresh().catch(() => undefined);
      return { ok: false, message: readable(created.error) };
    }
    return edit(() => commit({ opId: randomUUID(), kind: 'chunk.update', ...human, expectedRevision: rev, payload: { chunkId: item.id, body: head } }));
  }

  /** Merge the next note into this one: write the joined text first, then remove the next note. */
  async function mergeNext(item: ChunkWithAnnotations, rev: number): Promise<EditResult> {
    const next = chunksRef.current.find((chunk) => chunk.position === item.position + 1);
    if (!next) return { ok: false, message: 'There is no next note to merge.' };
    if (next.annotations.length) return { ok: false, message: 'The next note has annotations, and merging would lose them. Keep the notes separate.' };
    if (readDraft(next.id)) return { ok: false, message: 'The next note has unsaved changes. Let it save, then merge.' };
    const [current, following] = await Promise.all([getChunk(db, item.id), getChunk(db, next.id)]);
    if (!current || !following) return { ok: false, message: 'One of these notes no longer exists.' };
    const merged = mergeNotes(current, following);
    if ('error' in merged) return { ok: false, message: merged.error };
    const updated = await edit(() => commit({ opId: randomUUID(), kind: 'chunk.update', ...human, expectedRevision: rev,
      payload: { chunkId: item.id, body: merged.body, subjects: merged.subjects } }));
    if (!updated.ok) return updated;
    const removed = await commit({ opId: randomUUID(), kind: 'chunk.delete', ...human, expectedRevision: following.revision, payload: { chunkId: following.id } });
    await refresh().catch(() => undefined);
    if (!removed.ok) setActionError(`The notes were joined, but the next note could not be removed: ${readable(removed.error)}`);
    return updated;
  }

  async function removeLater(entry: PendingDelete): Promise<EditResult> {
    if (deletes.isHidden(entry.chunkId)) return { ok: true };
    await deletes.remove(entry);
    return { ok: true };
  }

  async function undoDelete() {
    const entry = deletes.undo();
    if (!entry?.restoreBody) return;
    const latest = chunksRef.current.find((chunk) => chunk.id === entry.chunkId);
    if (!latest) return;
    const result = await commit({ opId: randomUUID(), kind: 'chunk.update', ...human, expectedRevision: latest.revision,
      payload: { chunkId: latest.id, body: entry.restoreBody } });
    if (!result.ok) setActionError(readable(result.error));
    await refresh().catch(() => undefined);
  }

  const searching = query.trim().length > 0;
  // What the list shows: main's tab/subject filter, minus notes in the undo window, then the search.
  const shown = (phone ? visible : chunks).filter((chunk) => !deletes.isHidden(chunk.id) && matchesQuery(chunk, query));

  if (loading) return <Screen><SafeAreaView style={{ flex: 1 }}><ActivityIndicator color={theme.color.accent.bg} style={{ marginTop: 40 }} /></SafeAreaView></Screen>;
  if (!room) return <Screen><SafeAreaView style={{ flex: 1 }}><View style={[column, { paddingTop: theme.space.page }]}>
    <EmptyState title="This room was not found." body="It may have been deleted on this device.">
      <Button label="Back to rooms" size="compact" onPress={leaveRoom} />
    </EmptyState>
  </View></SafeAreaView></Screen>;

  const roomList = <Screen><SafeAreaView style={{ flex: 1 }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <FlatList ref={listRef} data={shown} extraData={[focus, belowId, belowText, pendingDelete]} keyExtractor={(chunk) => chunk.id} keyboardShouldPersistTaps="handled" testID="chunk-list"
        initialNumToRender={1} maxToRenderPerBatch={1} windowSize={1}
        onScroll={(event) => { scrollY.current = event.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
        onScrollToIndexFailed={({ index, highestMeasuredFrameIndex }) => {
          const goingDown = highestMeasuredFrameIndex < index;
          const next = goingDown ? scrollY.current + 800 : Math.max(0, scrollY.current - 800);
          scrollY.current = next;
          listRef.current?.scrollToOffset({ offset: next, animated: false });
        }}
        contentContainerStyle={[column, { paddingTop: theme.space.md, paddingBottom: 120, gap: theme.space.xl }]}
        ListHeaderComponent={<View style={{ gap: theme.space.section, marginBottom: theme.space.base }}>
          {phone ? <View style={{ gap: theme.space.lg }}>
            <PhoneRoomHeader name={room.name} status={`${stageName(room.stage)} · saved`}
              onBack={leaveRoom} onReview={() => router.push(`/rooms/${room.id}/review`)}
              onOptions={() => Alert.alert(room.name, undefined, [
                { text: 'Review this room', onPress: () => router.push(`/rooms/${room.id}/review`) },
                { text: 'Study materials', onPress: () => router.push(`/study/pick?roomId=${room.id}`) },
                { text: 'Slides', onPress: () => router.push(`/rooms/${room.id}/slides`) },
                { text: 'Whiteboard', onPress: () => router.push(`/rooms/${room.id}/whiteboard`) },
                { text: 'Import notes', onPress: () => router.push({ pathname: '/import', params: { roomId: room.id } }) },
                { text: 'Cancel', style: 'cancel' },
              ])} />
            <RoomTabs value={tab} onChange={setTab} />
            {tab === 'notes' ? <SubjectChips subjects={subjects} value={activeSubject} onChange={setSubject} /> : null}
          </View> : <>
            <RoomHeader room={room} chunkCount={chunks.length}
              onBack={leaveRoom}
              onImport={() => router.push({ pathname: '/import', params: { roomId: room.id } })}
              onNewNote={() => { listRef.current?.scrollToOffset({ offset: 0, animated: true }); composerRef.current?.focus(); }} />
          </>}
          {phone && tab !== 'notes' ? null : <View style={{ gap: theme.space.xl, backgroundColor: theme.color.bg.surface, borderRadius: theme.radius.float, borderWidth: 1, borderColor: theme.color.border.hairline, padding: theme.space.base, ...theme.shadow.card }}>
            <SectionTitle>New note</SectionTitle>
            <MarkdownToolbar context="new note" onFormat={formatComposer} />
            <Field ref={composerRef} accessibilityLabel="Note content" placeholder="Write a note chunk. Ctrl+Enter (or ⌘+Enter) adds it."
              multiline value={content} selection={composerSelection} onChangeText={onContentChange} style={{ minHeight: 112 }}
              onSelectionChange={(event) => {
                composerSelectionRef.current = event.nativeEvent.selection;
                setComposerSelection(undefined);
              }}
              onKeyPress={(event) => {
                if (!isSubmitShortcut(event as unknown as Parameters<typeof isSubmitShortcut>[0])) return;
                (event as unknown as { preventDefault?: () => void }).preventDefault?.();
                addNote();
              }} />
            {addedId ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
              <Text style={[theme.text('label'), { color: theme.color.status.success.text }]}>Added at the end of the notes.</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Show the note you just added" hitSlop={12} onPress={showAdded}>
                <Text style={[theme.text('label'), { color: theme.color.text.primary, textDecorationLine: 'underline' }]}>Show it</Text>
              </Pressable>
            </View> : null}
            <Text style={[theme.text('label'), { color: pasteNotice ? theme.color.status.success.text : theme.color.text.tertiary }]}>
              {pasteNotice ?? 'add a note chunk · or paste, it splits on blank lines'}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md }}>
              <View style={{ flexGrow: 1, flexBasis: 200 }}>
                <Field accessibilityLabel="Subject tags" placeholder="Subjects, comma separated (kept for the next note)" value={tags} onChangeText={setTags} />
              </View>
              <View style={{ flexGrow: 1, flexBasis: 200 }}>
                <Field accessibilityLabel="Source link" placeholder="Source link (optional)"
                  value={source} onChangeText={setSource} autoCapitalize="none" keyboardType="url" />
              </View>
            </View>
            <View style={{ alignSelf: 'flex-start' }}><Button label="Add note" disabled={!content.trim() || busy} onPress={addNote} /></View>
          </View>}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {chunks.length && !phone ? <SectionTitle>{activeSubject ? `Notes · ${activeSubject}` : 'Notes'}</SectionTitle> : null}
          {chunks.length && (!phone || tab === 'notes') ? <View style={{ gap: theme.space.sm }}>
            <Field accessibilityLabel="Search this room" placeholder="Search notes and subjects in this room"
              value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
            {searching ? <Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>
              {`${shown.length} of ${chunks.length} ${chunks.length === 1 ? 'note matches' : 'notes match'}. Reordering is off while searching.`}
            </Text> : null}
          </View> : null}
        </View>}
        ListEmptyComponent={phone && tab !== 'notes'
          ? <EmptyState title={`No ${tab} in this room yet`} body={`${tab === 'slides' ? 'Slides' : 'Boards'} will show up here once they are added.`} />
          : searching ? <EmptyState title="No notes match" body="Try fewer or different words, or clear the search." />
          : chunks.length ? <EmptyState title="No notes with this subject" body="Pick another subject, or choose all." />
          : <EmptyState title="No notes in this room yet" body="Write your first chunk above, or paste a few paragraphs at once." />}
        renderItem={({ item }) => {
          // Positions are in the full list: moves, "add below" and labels must not depend on filters.
          const index = chunks.indexOf(item);
          const cited = focus?.chunkId === item.id ? focus : null;
          const next = chunks[index + 1];
          return <ChunkEditor chunk={item} index={index} count={chunks.length} onError={setActionError}
            reorderDisabled={searching || Boolean(activeSubject && phone)}
            onAddBelow={() => { setBelowId(item.id); setBelowText(''); }}
            onSplit={(head, tail, rev) => splitNote(item, head, tail, rev)}
            onMergeNext={!searching && next && !deletes.isHidden(next.id) ? (rev) => mergeNext(item, rev) : undefined}
            onEmptied={(previousBody) => removeLater({ chunkId: item.id, label: 'Empty note removed', restoreBody: previousBody })}
            after={belowId === item.id ? <View style={{ gap: theme.space.md, paddingTop: theme.space.md, borderTopWidth: 1, borderTopColor: theme.color.border.hairline }}>
              <MarkdownToolbar context={`new note below note ${index + 1}`} onFormat={formatBelow} />
              <Field ref={belowRef} accessibilityLabel={`New note below chunk ${index + 1}`} placeholder="New note below this one. Ctrl+Enter adds, Esc cancels."
                multiline autoFocus value={belowText} selection={belowSelection} onChangeText={setBelowText} style={{ minHeight: 72 }}
                onSelectionChange={(event) => {
                  belowSelectionRef.current = event.nativeEvent.selection;
                  setBelowSelection(undefined);
                }}
                onKeyPress={(event) => {
                  const key = event as unknown as { key?: string; nativeEvent?: { key?: string } };
                  if ((key.key ?? key.nativeEvent?.key) === 'Escape') { setBelowId(null); return; }
                  if (!isSubmitShortcut(event as unknown as Parameters<typeof isSubmitShortcut>[0])) return;
                  (event as unknown as { preventDefault?: () => void }).preventDefault?.();
                  addBelow(item);
                }} />
              <View style={{ flexDirection: 'row', gap: theme.space.md }}>
                <Button label="Insert note" size="compact" disabled={!belowText.trim() || busy} onPress={() => addBelow(item)} />
                <Button label="Cancel" size="compact" variant="ghost" onPress={() => setBelowId(null)} />
              </View>
            </View> : undefined}
            nativeID={`chunk-${item.id}`} testID={`chunk-${item.id}`} highlighted={Boolean(cited)}
            // While a citation points into this chunk, show the highlighted passage; "Edit text" closes it.
            readView={cited ? <AnchoredChunkText body={item.body} focus={cited} /> : undefined}
            onExitReadView={() => setFocus(null)}
            onSaveBody={(body, rev) => edit(() => commit({ opId: randomUUID(), kind: 'chunk.update', ...human, expectedRevision: rev, payload: { chunkId: item.id, body } }))}
            onSetSubjects={(subjects, rev) => edit(() => commit({ opId: randomUUID(), kind: 'chunk.update', ...human, expectedRevision: rev, payload: { chunkId: item.id, subjects } }))}
            onMove={(toIndex, rev) => edit(() => commit({ opId: randomUUID(), kind: 'chunk.move', ...human, expectedRevision: rev, payload: { chunkId: item.id, toIndex } }))}
            onDelete={() => removeLater({ chunkId: item.id, label: 'Note deleted' })}>
          {item.sourceLink ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
            <Icon name="link" size={14} color={theme.color.text.tertiary} />
            <Text numberOfLines={1} style={[theme.text('label'), { flex: 1, color: theme.color.text.tertiary }]}>Source: {item.sourceLink}</Text>
          </View> : null}
          {item.annotations.map((annotation) => annotation.type === 'ai_answer' ? (
            <PinnedAnswer
              key={annotation.id}
              anchor={annotation.anchor}
              annotationId={annotation.id}
              answer={typeof annotation.payload.answer === 'string' ? annotation.payload.answer : ''}
              chunkBody={item.body}
              chunkId={item.id}
              grounding={annotation.payload}
              onOpen={openCitation}
            />
          ) : <Text key={annotation.id} style={[theme.text('bodySmall'), { color: theme.color.text.secondary, backgroundColor: theme.color.status.warning.wash, borderRadius: theme.radius.md, paddingHorizontal: theme.space.lg, paddingVertical: theme.space.sm, alignSelf: 'flex-start', overflow: 'hidden' }]} testID={`annotation-${annotation.id}`}>
            {annotationLabel(annotation)}
          </Text>)}
          {annotating === item.id ? <View style={{ gap: 8 }}>
            <Field accessibilityLabel="Whole-chunk highlight note" placeholder="Add a highlight note for this chunk"
              value={annotationText} onChangeText={setAnnotationText} autoFocus />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label="Save annotation" size="compact" disabled={!annotationText.trim() || !item.body.length || busy} onPress={() => void action(async () => {
                const result = await commit({ opId: randomUUID(), kind: 'annotation.create', source: 'human', confirmed: false,
                  expectedRevision: item.revision,
                  payload: { chunkId: item.id, type: 'highlight', anchor: { start: 0, end: item.body.length }, payload: { text: annotationText.trim() } } });
                if (!result.ok) throw new Error(result.error.message);
                setAnnotationText(''); setAnnotating(null);
              })} />
              <Button label="Cancel" size="compact" variant="ghost" onPress={() => setAnnotating(null)} />
            </View>
          </View> : <View style={{ alignSelf: 'flex-start' }}><Button label="Annotate" size="compact" variant="outline" onPress={() => setAnnotating(item.id)} /></View>}
          <MarkButtons
            chunkId={item.id}
            expectedRevision={item.revision}
            commit={commit}
            testID={`room-mark-${item.id}`}
          />
        </ChunkEditor>;
        }}
      />
      {pendingDelete ? (
        <View accessibilityLiveRegion="polite" style={{ position: 'absolute', left: theme.space.base, bottom: phone ? 96 : theme.space.section, flexDirection: 'row', alignItems: 'center', gap: theme.space.base, paddingVertical: theme.space.md, paddingHorizontal: theme.space.base, borderRadius: theme.radius.control, backgroundColor: theme.color.accent.bg, ...theme.shadow.float }}>
          <Text style={[theme.text('bodySmall'), { color: theme.color.accent.fg }]}>{pendingDelete.label}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Undo: ${pendingDelete.label}`} hitSlop={12} onPress={() => void undoDelete()}>
            <Text style={[theme.text('buttonCompact'), { color: theme.color.accent.fg, textDecorationLine: 'underline' }]}>Undo</Text>
          </Pressable>
        </View>
      ) : null}
      {phone ? <PhoneRoomActions
        onAddNote={() => { setTab('notes'); setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 0); }} /> : null}
    </KeyboardAvoidingView>
  </SafeAreaView></Screen>;

  // iPad: the room beside an ask column, with a floating pencil tool bar.
  // The ask backend is not wired to this panel yet; questions stay local.
  if (wide) return <View style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.color.bg.canvas }} testID="room-wide-view">
    <View style={{ flex: 1, minWidth: 0 }}>{roomList}</View>
    <View style={{ paddingTop: theme.space.page, paddingRight: theme.space.page }}>
      <RoomSidePanel roomId={room.id} subjects={subjects} chunks={chunks} dueToday={dueToday}
        activeSubject={activeSubject} onSubject={setSubject} />
    </View>
  </View>;
  if (!splitView) return roomList;
  return <View style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.color.bg.canvas }} testID="room-split-view">
    <View style={{ flex: 1, minWidth: 0 }}>
      {roomList}
      {penTool === 'lasso' && inkSelected ? <InkLassoActions
        onAsk={() => { setAskOpen(true); setAskMessages((prev) => [...prev, { id: randomUUID(), text: 'ask about this ink', note: 'from your ink' }]); setInkSelected(false); }}
        onConvert={() => setInkSelected(false)} /> : null}
      <PencilToolbar onChange={(tool) => { setPenTool(tool); if (tool === 'lasso') setInkSelected(true); }} />
    </View>
    {askOpen ? <RoomAskPanel
      subtitle={`your ink + ${chunks.length} ${chunks.length === 1 ? 'chunk' : 'chunks'}`}
      messages={askMessages} proposal={null}
      onSend={(text) => setAskMessages((prev) => [...prev, { id: randomUUID(), text }])}
      onPin={() => undefined} onDecline={() => undefined}
      onClose={() => setAskOpen(false)} /> : null}
  </View>;
}

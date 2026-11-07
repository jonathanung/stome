import { randomUUID } from 'expo-crypto';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform,
  Pressable, Text, TextInput, View,
} from 'react-native';

import { Button, Screen, useStoneTheme } from '../../design-theme/src/primitives';
import { createCommit } from '../data/commit';
import type { Annotation, Chunk, Room } from '../data/models';
import type { CommitError, CommitResult, OpKind } from '../data/operations';
import { getChunk, getRoom, listChunks, listRoomAnnotations } from '../data/queries';
import { expoDriver } from '../db/expo-driver';
import { AnchoredChunkText, PinnedAnswer } from '../features/ask/AnchoredChunkText';
import type { ChunkFocus } from '../features/ask/citations';
import { ChunkEditor, type EditResult } from '../features/chunks/ChunkEditor';
import { readDraft } from '../features/chunks/draft-store';
import { pastedParagraphs } from '../features/chunks/paste';
import { isSubmitShortcut, matchesQuery, mergeNotes } from '../features/notes/note-ops';
import { PendingDeletes, type PendingDelete } from '../features/notes/pending-delete';
import { ReviewEntry } from '../features/review/ReviewEntry';
import { Icon } from '../ui/Icon';
import { StageGlyph, stageName } from '../ui/StageGlyph';
import { BackButton, EmptyState, Field, Notice, SectionTitle, useColumn } from '../ui/kit';
import { HarnessPanel } from './HarnessPanel';

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
  const [error, setError] = useState<string | null>(null);
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [belowId, setBelowId] = useState<string | null>(null);
  const [belowText, setBelowText] = useState('');
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const composerRef = useRef<ComponentRef<typeof TextInput>>(null);

  const load = useCallback(async () => {
    if (!id) return { room: null, chunks: [] as ChunkWithAnnotations[] };
    const [nextRoom, notes, annotations] = await Promise.all([
      getRoom(db, id), listChunks(db, id), listRoomAnnotations(db, id),
    ]);
    const byChunk = new Map<string, Annotation[]>();
    for (const annotation of annotations) {
      const group = byChunk.get(annotation.chunkId) ?? [];
      group.push(annotation);
      byChunk.set(annotation.chunkId, group);
    }
    return { room: nextRoom, chunks: notes.map((chunk) => ({
      ...chunk, annotations: byChunk.get(chunk.id) ?? [],
    })) };
  }, [db, id]);
  const refresh = useCallback(async () => {
    const next = await load();
    setRoom(next.room);
    setChunks(next.chunks);
  }, [load]);
  useFocusEffect(useCallback(() => {
    let active = true;
    load().then((next) => {
      if (active) { setRoom(next.room); setChunks(next.chunks); setLoading(false); }
    }).catch((reason: unknown) => {
      if (active) { setError(reason instanceof Error ? reason.message : 'Could not load room'); setLoading(false); }
    });
    return () => { active = false; };
  }, [load]));
  const openCitation = useCallback((next: ChunkFocus) => {
    setFocus(next);
  }, []);
  useEffect(() => {
    if (!focus || focus.end <= focus.start) return;
    const index = chunks.findIndex((chunk) => chunk.id === focus.chunkId);
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
  }, [chunks, focus]);
  async function action(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await run(); await refresh(); }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save');
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

  /**
   * After adding, show the new note (it is at the end, right above the
   * composer) and keep typing. Scroll to the composer itself: the end of the
   * list is the AI panel below it.
   */
  const showNewNote = () => {
    requestAnimationFrame(() => {
      const node = composerRef.current as unknown as { scrollIntoView?: (options: { block: 'center'; behavior: 'smooth' }) => void } | null;
      if (Platform.OS === 'web' && node?.scrollIntoView) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      else listRef.current?.scrollToEnd({ animated: true });
      composerRef.current?.focus();
    });
  };

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
      showNewNote();
    });
  }

  /** Subjects stay for the next note (consecutive notes usually share a topic); the source link does not. */
  function addNote() {
    if (!content.trim() || !room || busy) return;
    void action(async () => {
      const result = await commit({ opId: randomUUID(), kind: 'chunk.create', ...human,
        payload: { roomId: room.id, bodies: [content], subjects: tags.split(','), sourceLink: source.trim() || null } });
      if (!result.ok) throw new Error(result.error.message);
      setContent(''); setSource(''); setPasteNotice(null);
      showNewNote();
    });
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
    if (!removed.ok) setError(`The notes were joined, but the next note could not be removed: ${readable(removed.error)}`);
    return updated;
  }

  // Deletes wait out an undo window; the commit runs after this render, so
  // the effect below keeps handing it the latest list and functions.
  const chunksRef = useRef<ChunkWithAnnotations[]>([]);
  const [deletes] = useState(() => new PendingDeletes({
    commit: async () => ({ ok: true }),
    onChange: setPendingDelete,
    onError: setError,
  }));
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
  // Leaving the room commits a pending delete rather than dropping it.
  useEffect(() => () => { void deletes.flush(); }, [deletes]);

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
    if (!result.ok) setError(readable(result.error));
    await refresh().catch(() => undefined);
  }

  const searching = query.trim().length > 0;
  const visibleChunks = chunks.filter((chunk) => !deletes.isHidden(chunk.id) && matchesQuery(chunk, query));

  if (loading) return <Screen><SafeAreaView style={{ flex: 1 }}><ActivityIndicator color={theme.color.accent.bg} style={{ marginTop: 40 }} /></SafeAreaView></Screen>;
  if (!room) return <Screen><SafeAreaView style={{ flex: 1 }}><View style={[column, { paddingTop: theme.space.page }]}>
    <EmptyState title="This room was not found." body="It may have been deleted on this device.">
      <Button label="Back to rooms" size="compact" onPress={() => router.replace('/')} />
    </EmptyState>
  </View></SafeAreaView></Screen>;

  return <Screen><SafeAreaView style={{ flex: 1 }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <FlatList ref={listRef} data={visibleChunks} extraData={[focus, belowId, belowText, pendingDelete]} keyExtractor={(chunk) => chunk.id} keyboardShouldPersistTaps="handled" testID="chunk-list"
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
          <View style={{ gap: theme.space.xs }}>
            <BackButton label="Rooms" accessibilityLabel="All rooms" onPress={() => router.replace('/')} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.base }}>
              <StageGlyph stage={room.stage} size={56} onCanvas />
              <View style={{ flex: 1, gap: theme.space.xxs }}>
                <Text accessibilityRole="header" style={[theme.text('screenTitle'), { color: theme.color.text.primary }]}>{room.name}</Text>
                <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>
                  {`${stageName(room.stage)} · ${chunks.length} ${chunks.length === 1 ? 'chunk' : 'chunks'}`}
                </Text>
              </View>
            </View>
          </View>
          <ReviewEntry roomId={room.id} />
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {chunks.length ? <View style={{ gap: theme.space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.md }}>
              <SectionTitle>Notes</SectionTitle>
              <Button label="New note" size="compact" variant="outline" onPress={showNewNote} />
            </View>
            <Field accessibilityLabel="Search this room" placeholder="Search notes and subjects in this room"
              value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
            {searching ? <Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>
              {`${visibleChunks.length} of ${chunks.length} ${chunks.length === 1 ? 'note matches' : 'notes match'}. Reordering is off while searching.`}
            </Text> : null}
          </View> : null}
        </View>}
        ListEmptyComponent={searching
          ? <EmptyState title="No notes match" body="Try fewer or different words, or clear the search." />
          : <EmptyState title="No notes in this room yet" body="Write your first note below, or paste a few paragraphs at once." />}
        ListFooterComponent={<View style={{ gap: theme.space.section }}>
          <View style={{ gap: theme.space.xl, backgroundColor: theme.color.bg.surface, borderRadius: theme.radius.float, borderWidth: 1, borderColor: theme.color.border.hairline, padding: theme.space.base, ...theme.shadow.card }}>
            <SectionTitle>New note</SectionTitle>
            <Field ref={composerRef} accessibilityLabel="Note content" placeholder="Write a note. Ctrl+Enter (or ⌘+Enter) adds it."
              multiline value={content} onChangeText={onContentChange} style={{ minHeight: 112 }}
              onKeyPress={(event) => {
                if (!isSubmitShortcut(event as unknown as Parameters<typeof isSubmitShortcut>[0])) return;
                (event as unknown as { preventDefault?: () => void }).preventDefault?.();
                addNote();
              }} />
            <Text style={[theme.text('label'), { color: pasteNotice ? theme.color.status.success.text : theme.color.text.tertiary }]}>
              {pasteNotice ?? 'Paste paragraphs separated by a blank line to add one note per paragraph.'}
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
          </View>
          <HarnessPanel roomId={room.id} chunks={chunks} appDb={sqlite} onOpenCitation={openCitation} onSaved={() => { void refresh(); }} />
        </View>}
        renderItem={({ item }) => {
          const index = chunks.indexOf(item);
          const cited = focus?.chunkId === item.id ? focus : null;
          const next = chunks[index + 1];
          return <ChunkEditor chunk={item} index={index} count={chunks.length} onError={setError}
            reorderDisabled={searching}
            onAddBelow={() => { setBelowId(item.id); setBelowText(''); }}
            onSplit={(head, tail, rev) => splitNote(item, head, tail, rev)}
            onMergeNext={!searching && next && !deletes.isHidden(next.id) ? (rev) => mergeNext(item, rev) : undefined}
            onEmptied={(previousBody) => removeLater({ chunkId: item.id, label: 'Empty note removed', restoreBody: previousBody })}
            after={belowId === item.id ? <View style={{ gap: theme.space.md, paddingTop: theme.space.md, borderTopWidth: 1, borderTopColor: theme.color.border.hairline }}>
              <Field accessibilityLabel={`New note below chunk ${index + 1}`} placeholder="New note below this one. Ctrl+Enter adds, Esc cancels."
                multiline autoFocus value={belowText} onChangeText={setBelowText} style={{ minHeight: 72 }}
                onKeyPress={(event) => {
                  const key = (event as unknown as { key?: string; nativeEvent?: { key?: string } });
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
        </ChunkEditor>;
        }}
      />
      {pendingDelete ? (
        <View accessibilityLiveRegion="polite" style={{ position: 'absolute', left: theme.space.base, bottom: theme.space.section, flexDirection: 'row', alignItems: 'center', gap: theme.space.base, paddingVertical: theme.space.md, paddingHorizontal: theme.space.base, borderRadius: theme.radius.control, backgroundColor: theme.color.accent.bg, ...theme.shadow.float }}>
          <Text style={[theme.text('bodySmall'), { color: theme.color.accent.fg }]}>{pendingDelete.label}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Undo: ${pendingDelete.label}`} hitSlop={12} onPress={() => void undoDelete()}>
            <Text style={[theme.text('buttonCompact'), { color: theme.color.accent.fg, textDecorationLine: 'underline' }]}>Undo</Text>
          </Pressable>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  </SafeAreaView></Screen>;
}

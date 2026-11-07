import { randomUUID } from 'expo-crypto';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform,
  Pressable, Text, TextInput, View,
} from 'react-native';

import { Button, Screen, useStoneTheme } from '../../design-theme/src/primitives';
import { createCommit } from '../data/commit';
import type { Annotation, Chunk, Room } from '../data/models';
import type { CommitError, CommitResult, OpKind } from '../data/operations';
import { getRoom, listChunks, listRoomAnnotations } from '../data/queries';
import { expoDriver } from '../db/expo-driver';
import { AnchoredChunkText, PinnedAnswer } from '../features/ask/AnchoredChunkText';
import type { ChunkFocus } from '../features/ask/citations';
import { ChunkEditor, type EditResult } from '../features/chunks/ChunkEditor';
import { pastedParagraphs } from '../features/chunks/paste';
import { ReviewEntry } from '../features/review/ReviewEntry';
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

  const input = {
    borderWidth: 1 as const, borderColor: theme.color.border.strong,
    borderRadius: theme.radius.control, backgroundColor: theme.color.bg.surface,
    color: theme.color.text.primary, fontSize: 16, padding: 12,
  };

  if (loading) return <Screen><SafeAreaView style={{ flex: 1 }}><ActivityIndicator style={{ marginTop: 40 }} /></SafeAreaView></Screen>;
  if (!room) return <Screen><SafeAreaView style={{ flex: 1 }}><View style={{ padding: 24, gap: 16 }}>
    <Text accessibilityRole="alert" style={{ color: theme.color.text.primary }}>This room was not found.</Text>
    <Button label="Back to rooms" onPress={() => router.replace('/')} />
  </View></SafeAreaView></Screen>;

  return <Screen><SafeAreaView style={{ flex: 1 }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <FlatList ref={listRef} data={chunks} extraData={focus} keyExtractor={(chunk) => chunk.id} keyboardShouldPersistTaps="handled" testID="chunk-list"
        initialNumToRender={1} maxToRenderPerBatch={1} windowSize={1}
        onScroll={(event) => { scrollY.current = event.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
        onScrollToIndexFailed={({ index, highestMeasuredFrameIndex }) => {
          const goingDown = highestMeasuredFrameIndex < index;
          const next = goingDown ? scrollY.current + 800 : Math.max(0, scrollY.current - 800);
          scrollY.current = next;
          listRef.current?.scrollToOffset({ offset: next, animated: false });
        }}
        contentContainerStyle={{ width: '100%', maxWidth: 760, alignSelf: 'center', padding: 20, paddingBottom: 48, gap: 12 }}
        ListHeaderComponent={<View style={{ gap: 14, marginBottom: 12 }}>
          <Pressable accessibilityRole="button" onPress={() => router.replace('/')}>
            <Text style={{ color: theme.color.text.secondary }}>← All rooms</Text>
          </Pressable>
          <Text accessibilityRole="header" style={{ color: theme.color.text.primary, fontSize: 32, fontWeight: '700' }}>{room.name}</Text>
          <Text style={{ color: theme.color.text.secondary }}>Stone stage: {room.stage}</Text>
          <ReviewEntry roomId={room.id} />
          <Text style={{ color: theme.color.text.primary, fontSize: 20, fontWeight: '600', marginTop: 8 }}>Notes</Text>
          <TextInput accessibilityLabel="Note content" placeholder="Write a note chunk" placeholderTextColor={theme.color.text.tertiary}
            multiline textAlignVertical="top" value={content} onChangeText={onContentChange} style={[input, { minHeight: 100 }]} />
          <Text style={{ color: theme.color.text.tertiary }}>
            {pasteNotice ?? 'Paste paragraphs separated by a blank line to add one chunk per paragraph.'}
          </Text>
          <TextInput accessibilityLabel="Subject tags" placeholder="Subject tags, separated by commas" placeholderTextColor={theme.color.text.tertiary}
            value={tags} onChangeText={setTags} style={input} />
          <TextInput accessibilityLabel="Source link" placeholder="Source link (optional)" placeholderTextColor={theme.color.text.tertiary}
            value={source} onChangeText={setSource} autoCapitalize="none" keyboardType="url" style={input} />
          <View style={{ alignSelf: 'flex-start' }}><Button label="Add note" disabled={!content.trim() || busy} onPress={() => void action(async () => {
            const result = await commit({ opId: randomUUID(), kind: 'chunk.create', source: 'human', confirmed: false,
              payload: { roomId: room.id, bodies: [content], subjects: tags.split(','), sourceLink: source.trim() || null } });
            if (!result.ok) throw new Error(result.error.message);
            setContent(''); setTags(''); setSource('');
          })} /></View>
          {error ? <Text accessibilityRole="alert" style={{ color: theme.color.status.danger.text }}>{error}</Text> : null}
        </View>}
        ListEmptyComponent={<Text style={{ color: theme.color.text.secondary }}>No notes in this room yet.</Text>}
        ListFooterComponent={<HarnessPanel roomId={room.id} chunks={chunks} appDb={sqlite} onOpenCitation={openCitation} onSaved={() => { void refresh(); }} />}
        renderItem={({ item, index }) => {
          const cited = focus?.chunkId === item.id ? focus : null;
          return <ChunkEditor chunk={item} index={index} count={chunks.length} onError={setError}
            nativeID={`chunk-${item.id}`} testID={`chunk-${item.id}`} highlighted={Boolean(cited)}
            // While a citation points into this chunk, show the highlighted passage; "Edit text" closes it.
            readView={cited ? <AnchoredChunkText body={item.body} focus={cited} /> : undefined}
            onExitReadView={() => setFocus(null)}
            onSaveBody={(body, rev) => edit(() => commit({ opId: randomUUID(), kind: 'chunk.update', ...human, expectedRevision: rev, payload: { chunkId: item.id, body } }))}
            onSetSubjects={(subjects, rev) => edit(() => commit({ opId: randomUUID(), kind: 'chunk.update', ...human, expectedRevision: rev, payload: { chunkId: item.id, subjects } }))}
            onMove={(toIndex, rev) => edit(() => commit({ opId: randomUUID(), kind: 'chunk.move', ...human, expectedRevision: rev, payload: { chunkId: item.id, toIndex } }))}
            onDelete={(rev) => edit(() => commit({ opId: randomUUID(), kind: 'chunk.delete', ...human, expectedRevision: rev, payload: { chunkId: item.id } }))}>
          {item.sourceLink ? <Text style={{ color: theme.color.text.secondary }}>Source: {item.sourceLink}</Text> : null}
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
          ) : <Text key={annotation.id} style={{ color: theme.color.text.secondary }} testID={`annotation-${annotation.id}`}>
            {annotationLabel(annotation)}
          </Text>)}
          {annotating === item.id ? <View style={{ gap: 8 }}>
            <TextInput accessibilityLabel="Whole-chunk highlight note" placeholder="Add a highlight note for this chunk"
              placeholderTextColor={theme.color.text.tertiary} value={annotationText} onChangeText={setAnnotationText} style={input} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label="Save annotation" disabled={!annotationText.trim() || !item.body.length || busy} onPress={() => void action(async () => {
                const result = await commit({ opId: randomUUID(), kind: 'annotation.create', source: 'human', confirmed: false,
                  expectedRevision: item.revision,
                  payload: { chunkId: item.id, type: 'highlight', anchor: { start: 0, end: item.body.length }, payload: { text: annotationText.trim() } } });
                if (!result.ok) throw new Error(result.error.message);
                setAnnotationText(''); setAnnotating(null);
              })} />
              <Button label="Cancel" variant="ghost" onPress={() => setAnnotating(null)} />
            </View>
          </View> : <View style={{ alignSelf: 'flex-start' }}><Button label="Annotate" variant="outline" onPress={() => setAnnotating(item.id)} /></View>}
        </ChunkEditor>;
        }}
      />
    </KeyboardAvoidingView>
  </SafeAreaView></Screen>;
}

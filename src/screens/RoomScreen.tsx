import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform,
  Pressable, Text, TextInput, View,
} from 'react-native';

import { Button, Screen, useStoneTheme } from '../../design-theme/src/primitives';
import { createCommit } from '../data/commit';
import type { Annotation, Chunk, Room } from '../data/models';
import { getRoom, listAnnotations, listChunks } from '../data/queries';
import { expoDriver } from '../db/expo-driver';

type ChunkWithAnnotations = Chunk & { annotations: Annotation[] };

export function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const commit = useMemo(() => createCommit(db, { now: Date.now, newId: randomUUID }), [db]);
  const theme = useStoneTheme();
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

  const load = useCallback(async () => {
    if (!id) return { room: null, chunks: [] as ChunkWithAnnotations[] };
    const [nextRoom, notes] = await Promise.all([getRoom(db, id), listChunks(db, id)]);
    const nextChunks = await Promise.all(notes.map(async (chunk) => ({
      ...chunk, annotations: await listAnnotations(db, chunk.id),
    })));
    return { room: nextRoom, chunks: nextChunks };
  }, [db, id]);
  const refresh = useCallback(async () => {
    const next = await load();
    setRoom(next.room);
    setChunks(next.chunks);
  }, [load]);
  useEffect(() => {
    let active = true;
    load().then((next) => {
      if (active) { setRoom(next.room); setChunks(next.chunks); setLoading(false); }
    }).catch((reason: unknown) => {
      if (active) { setError(reason instanceof Error ? reason.message : 'Could not load room'); setLoading(false); }
    });
    return () => { active = false; };
  }, [load]);
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
  const input = {
    borderWidth: 1 as const, borderColor: theme.color.border.strong,
    borderRadius: theme.radius.control, backgroundColor: theme.color.bg.surface,
    color: theme.color.text.primary, fontSize: 16, padding: 12,
  };

  if (loading) return <Screen><ActivityIndicator style={{ marginTop: 40 }} /></Screen>;
  if (!room) return <Screen><View style={{ padding: 24, gap: 16 }}>
    <Text accessibilityRole="alert" style={{ color: theme.color.text.primary }}>This room was not found.</Text>
    <Button label="Back to rooms" onPress={() => router.replace('/')} />
  </View></Screen>;

  return <Screen>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <FlatList data={chunks} keyExtractor={(chunk) => chunk.id} keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ width: '100%', maxWidth: 760, alignSelf: 'center', padding: 20, paddingBottom: 48, gap: 12 }}
        ListHeaderComponent={<View style={{ gap: 14, marginBottom: 12 }}>
          <Pressable accessibilityRole="button" onPress={() => router.replace('/')}>
            <Text style={{ color: theme.color.text.secondary }}>← All rooms</Text>
          </Pressable>
          <Text accessibilityRole="header" style={{ color: theme.color.text.primary, fontSize: 32, fontWeight: '700' }}>{room.name}</Text>
          <Text style={{ color: theme.color.text.primary, fontSize: 20, fontWeight: '600', marginTop: 8 }}>Notes</Text>
          <TextInput accessibilityLabel="Note content" placeholder="Write a note chunk" placeholderTextColor={theme.color.text.tertiary}
            multiline textAlignVertical="top" value={content} onChangeText={setContent} style={[input, { minHeight: 100 }]} />
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
        renderItem={({ item, index }) => <View style={{ backgroundColor: theme.color.bg.surface, borderColor: theme.color.border.hairline, borderWidth: 1, borderRadius: theme.radius.card, padding: 16, gap: 10 }}>
          <Text style={{ color: theme.color.text.tertiary }}>Chunk {index + 1} · {new Date(item.createdAt).toLocaleString()}</Text>
          <Text style={{ color: theme.color.text.primary, fontSize: 16, lineHeight: 24 }}>{item.body}</Text>
          {item.subjects.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {item.subjects.map((subject) => <Text key={subject} style={{ color: theme.color.text.secondary, borderColor: theme.color.border.strong, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>{subject}</Text>)}
          </View> : null}
          {item.sourceLink ? <Text style={{ color: theme.color.text.secondary }}>Source: {item.sourceLink}</Text> : null}
          {item.annotations.map((annotation) => <Text key={annotation.id} style={{ color: theme.color.text.secondary }}>
            Annotation · {annotation.type}: {String(annotation.payload.text ?? annotation.payload.note ?? '')}
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
        </View>}
      />
    </KeyboardAvoidingView>
  </Screen>;
}

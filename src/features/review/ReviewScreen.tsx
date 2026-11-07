import { randomUUID } from 'expo-crypto';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Screen, useStoneTheme } from '../../../design-theme/src/primitives';
import { createCommit } from '../../data/commit';
import type { ReviewMark, Room, RoomStage } from '../../data/models';
import { getChunk, getRoom, latestReviewMark, listChunks } from '../../data/queries';
import type { ReviewState } from '../../db/schema';
import { expoDriver } from '../../db/expo-driver';
import {
  REVIEW_LABEL,
  chunksReadyToReview,
  deviceTimeZone,
  formatDueAt,
  mockReviewQuestion,
  orderReviewQueue,
  reviewMarkOperation,
  type ReviewQueueChunk,
} from './session';

type Scheduled = {
  chunkId: string;
  state: ReviewState;
  localDay: string;
  dueAt: number;
};

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toCard(chunk: ReviewQueueChunk): ReviewQueueChunk {
  return {
    id: chunk.id,
    position: chunk.position,
    body: chunk.body,
    revision: chunk.revision,
  };
}

export function ReviewScreen() {
  const params = useLocalSearchParams<{ id?: string | string[]; chunk?: string | string[] }>();
  const roomId = one(params.id);
  const startChunkId = one(params.chunk);
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const commit = useMemo(() => createCommit(db, { now: Date.now, newId: randomUUID }), [db]);
  const theme = useStoneTheme();
  const [room, setRoom] = useState<Room | null>(null);
  const [stage, setStage] = useState<RoomStage>('stonehenge');
  const [cards, setCards] = useState<ReviewQueueChunk[]>([]);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [scheduled, setScheduled] = useState<Scheduled[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!roomId) return { missing: true, room: null, cards: [] as ReviewQueueChunk[], scheduled: [] as Scheduled[] };
    const found = await getRoom(db, roomId);
    if (!found) return { missing: true, room: null, cards: [] as ReviewQueueChunk[], scheduled: [] as Scheduled[] };
    const chunks = await listChunks(db, roomId);
    const marks = await Promise.all(chunks.map((chunk) => latestReviewMark(db, chunk.id)));
    const latest = new Map<string, ReviewMark>();
    chunks.forEach((chunk, index) => {
      const mark = marks[index];
      if (mark) latest.set(chunk.id, mark);
    });
    const ready = chunksReadyToReview(chunks, latest, Date.now());
    const cards = orderReviewQueue(ready, startChunkId, chunks).map(toCard);
    const scheduled = [...latest.values()]
      .filter((mark) => mark.dueAt > Date.now())
      .map((mark) => ({
        chunkId: mark.chunkId,
        state: mark.state,
        localDay: mark.localDay,
        dueAt: mark.dueAt,
      }))
      .sort((left, right) => left.dueAt - right.dueAt || left.chunkId.localeCompare(right.chunkId));
    return { missing: false, room: found, cards, scheduled };
  }, [db, roomId, startChunkId]);

  useFocusEffect(useCallback(() => {
    let active = true;
    load()
      .then((next) => {
        if (!active) return;
        setMissing(next.missing);
        setRoom(next.room);
        setStage(next.room?.stage ?? 'stonehenge');
        setCards(next.cards);
        setTotal(next.cards.length);
        setDone(0);
        setScheduled(next.scheduled);
        setSaved(null);
        setError(null);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'Could not open the review');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load]));

  function leave() {
    if (router.canGoBack()) router.back();
    else if (roomId) router.replace(`/rooms/${roomId}`);
    else router.replace('/');
  }

  const card = cards[0];
  const asked = card ? mockReviewQuestion(card) : null;

  async function mark(state: ReviewState) {
    if (!card || busy || !roomId) return;
    const seen = card;
    setBusy(true);
    setError(null);
    try {
      const result = await commit(reviewMarkOperation({
        opId: randomUUID(),
        chunkId: seen.id,
        state,
        expectedRevision: seen.revision,
        timeZone: deviceTimeZone(),
      }));
      if (!result.ok) {
        if (result.error.code === 'stale_revision') {
          setError('This note changed since you opened it. Nothing was saved and it did not count. Read the current note, then mark it again.');
          const fresh = await getChunk(db, seen.id);
          if (fresh && fresh.roomId === roomId) {
            setCards((current) => current.map((item) => (item.id === seen.id ? toCard(fresh) : item)));
          } else {
            setCards((current) => current.filter((item) => item.id !== seen.id));
          }
          return;
        }
        if (result.error.code === 'not_found') {
          setError('This note no longer exists.');
          setCards((current) => current.filter((item) => item.id !== seen.id));
          setDone((count) => count + 1);
          return;
        }
        setError(result.error.message);
        return;
      }
      const promoted = stage === 'stonehenge' && result.value.stage === 'brick' ? ' This room is now brick.' : '';
      setStage(result.value.stage);
      setSaved(`Saved ${REVIEW_LABEL[result.value.state]}. Due ${formatDueAt(result.value.dueAt)}.${promoted}`);
      setScheduled((current) => {
        const next = current.filter((item) => item.chunkId !== result.value.chunkId);
        next.push({
          chunkId: result.value.chunkId,
          state: result.value.state,
          localDay: result.value.localDay,
          dueAt: result.value.dueAt,
        });
        next.sort((left, right) => left.dueAt - right.dueAt || left.chunkId.localeCompare(right.chunkId));
        return next;
      });
      setCards((current) => current.filter((item) => item.id !== seen.id));
      setDone((count) => count + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the mark');
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    if (!card || busy) return;
    setCards((current) => current.filter((item) => item.id !== card.id));
    setDone((count) => count + 1);
    setError(null);
  }

  const inputColor = theme.color.text.primary;
  const muted = theme.color.text.secondary;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 32 }}>
          <View style={{ width: '100%', maxWidth: 760, alignSelf: 'center', padding: 20, gap: 16 }} testID="review-screen">
            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={leave} testID="review-back">
              <Text style={{ color: muted }}>← Back</Text>
            </Pressable>
            <Text accessibilityRole="header" style={{ color: inputColor, fontSize: 32, fontWeight: '700' }}>Review</Text>
            {loading ? <ActivityIndicator /> : null}
            {error ? <Text accessibilityRole="alert" testID="review-error" style={{ color: theme.color.status.danger.text }}>{error}</Text> : null}
            {!loading && missing ? (
              <View style={{ gap: 12 }}>
                <Text accessibilityRole="alert" style={{ color: inputColor }}>This room was not found.</Text>
                <Button label="Back to rooms" onPress={() => router.replace('/')} />
              </View>
            ) : null}
            {!loading && room ? (
              <View style={{ gap: 16 }}>
                <Text style={{ color: inputColor, fontSize: 20, fontWeight: '600' }}>{room.name}</Text>
                <Text testID="review-stage" style={{ color: muted }}>Stone stage: {stage}</Text>
                {saved ? <Text testID="review-saved" style={{ color: inputColor }}>{saved}</Text> : null}
                {card && asked ? (
                  <View style={{ backgroundColor: theme.color.bg.surface, borderColor: theme.color.border.hairline, borderRadius: theme.radius.card, borderWidth: 1, gap: 12, padding: 16 }}>
                    <Text testID="review-progress" style={{ color: muted }}>
                      {`Note ${Math.min(done + 1, total)} of ${total}`}
                    </Text>
                    <Text testID="review-revision" style={{ color: muted }}>{`Revision ${card.revision}`}</Text>
                    <Text testID="review-chunk" style={{ color: inputColor, fontSize: 18, lineHeight: 26 }}>{card.body}</Text>
                    {asked.ok ? (
                      <Text testID="review-question" style={{ color: inputColor, fontSize: 16, lineHeight: 24 }}>{asked.question.split('\n')[0]}</Text>
                    ) : (
                      <View style={{ gap: 8 }}>
                        <Text accessibilityRole="alert" testID="review-question-error" style={{ color: theme.color.status.danger.text }}>{asked.message}</Text>
                        <Button label="Skip this note" variant="ghost" disabled={busy} onPress={skip} />
                      </View>
                    )}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {(Object.keys(REVIEW_LABEL) as ReviewState[]).map((state) => (
                        <Button
                          key={state}
                          label={REVIEW_LABEL[state]}
                          variant="outline"
                          disabled={busy}
                          onPress={() => void mark(state)}
                        />
                      ))}
                    </View>
                  </View>
                ) : (
                  <Text testID="review-empty" style={{ color: inputColor, fontSize: 18 }}>
                    {total === 0 && scheduled.length === 0 ? 'No notes to review.' : 'Nothing is due right now.'}
                  </Text>
                )}
                {scheduled.length ? (
                  <View style={{ gap: 8 }} testID="review-schedule">
                    <Text style={{ color: inputColor, fontSize: 18, fontWeight: '600' }}>Coming up</Text>
                    {scheduled.map((item) => (
                      <Text key={item.chunkId} testID={`review-scheduled-${item.chunkId}`} style={{ color: muted }}>
                        {`${REVIEW_LABEL[item.state]} · ${item.localDay} · due ${formatDueAt(item.dueAt)}`}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

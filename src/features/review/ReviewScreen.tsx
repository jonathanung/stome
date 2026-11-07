import { randomUUID } from 'expo-crypto';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Screen, useStoneTheme } from '../../../design-theme/src/primitives';
import { StageGlyph } from '../../ui/StageGlyph';
import { REVIEW_TONE, StatusMark } from '../../ui/StatusMark';
import { BackButton, EmptyState, Group, Notice, ScreenHeader, SectionTitle, useColumn } from '../../ui/kit';
import { createCommit } from '../../data/commit';
import type { ReviewMark, Room, RoomStage } from '../../data/models';
import { getChunk, getRoom, latestReviewMark, listChunks } from '../../data/queries';
import type { ReviewState } from '../../db/schema';
import { expoDriver } from '../../db/expo-driver';
import { reviewMarkController } from './mark-attempt';
import { acknowledgeDisplayedCards, reviewQueueOnOpen } from './mark-progress';
import {
  REVIEW_LABEL,
  chunksReadyToReview,
  deviceTimeZone,
  formatDueAt,
  mockReviewQuestion,
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

/** The browser harness sets this gate to pause a mark before it is written. */
function deferredReviewMark(): Promise<void> | undefined {
  const host = globalThis as typeof globalThis & {
    __stomeDeferReviewMark?: Promise<void>;
    __stomeDeferReviewMarkEntered?: boolean;
  };
  const gate = host.__stomeDeferReviewMark;
  if (!gate) return undefined;
  host.__stomeDeferReviewMarkEntered = true;
  return gate;
}

function consumeLostReviewReport(): boolean {
  const host = globalThis as typeof globalThis & { __stomeLoseNextReviewReport?: boolean };
  if (!host.__stomeLoseNextReviewReport) return false;
  host.__stomeLoseNextReviewReport = false;
  return true;
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
  const column = useColumn();
  const [room, setRoom] = useState<Room | null>(null);
  const [stage, setStage] = useState<RoomStage>('stonehenge');
  const stageRef = useRef<RoomStage>('stonehenge');
  const marking = useRef(false);
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
    const retainedIds = chunks.filter((chunk) => reviewMarkController.retained(chunk.id)).map((chunk) => chunk.id);
    const cards = reviewQueueOnOpen({ ready, all: chunks, startId: startChunkId, retainedIds }).map(toCard);
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
        stageRef.current = next.room?.stage ?? 'stonehenge';
        setStage(stageRef.current);
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
      reviewMarkController.invalidate();
    };
  }, [load]));

  function leave() {
    const go = () => {
      if (router.canGoBack()) router.back();
      else if (roomId) router.replace(`/rooms/${roomId}`);
      else router.replace('/');
    };
    void reviewMarkController.requestLeave(go);
  }

  const card = cards[0];
  const asked = card && roomId ? mockReviewQuestion({ id: card.id, body: card.body, roomId }) : null;
  const pending = !busy && card ? reviewMarkController.retained(card.id) : null;
  const shownError = error ?? (pending
    ? `The previous ${REVIEW_LABEL[pending.payload.state]} mark did not finish. Retry that choice. It will not be counted twice.`
    : null);

  async function mark(state: ReviewState) {
    if (!card || !roomId || marking.current) return;
    const seen = card;
    const gen = reviewMarkController.generation();
    marking.current = true;
    setBusy(true);
    setError(null);
    try {
      const outcome = await reviewMarkController.submit({
        newId: randomUUID,
        timeZone: deviceTimeZone,
        commit: async (attempt) => {
          const gate = deferredReviewMark();
          if (gate) await gate;
          return commit(attempt);
        },
        request: { chunkId: seen.id, state, expectedRevision: seen.revision },
        report: (result, attempt) => {
          if (consumeLostReviewReport()) throw new Error('response lost');
          const was = stageRef.current;
          stageRef.current = result.value.stage;
          const promoted = was === 'stonehenge' && result.value.stage === 'brick' ? ' This room is now brick.' : '';
          const progress = acknowledgeDisplayedCards({
            cards: [seen],
            done: 0,
            displayedId: seen.id,
            displayedRevision: seen.revision,
            markedRevision: attempt.expectedRevision,
          });
          setStage(result.value.stage);
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
          if (!progress.reviewedDisplayedRevision) {
            setSaved(`The earlier ${REVIEW_LABEL[result.value.state]} mark was saved. This note is still open.`);
            return;
          }
          setSaved(`Saved ${REVIEW_LABEL[result.value.state]}. Due ${formatDueAt(result.value.dueAt)}.${promoted}`);
          setCards((current) => current.filter((item) => item.id !== seen.id));
          setDone((count) => count + 1);
        },
      });
      if (reviewMarkController.generation() !== gen) return;
      if (outcome.status === 'busy') return;
      if (outcome.status === 'blocked') {
        const held = REVIEW_LABEL[outcome.attempt.payload.state];
        setError(`The previous ${held} mark did not finish. Retry that choice. It will not be counted twice.`);
        return;
      }
      if (outcome.status === 'ambiguous') {
        setError('That mark may have saved. Retry the same choice. It will not be counted twice.');
        return;
      }
      if (outcome.status !== 'rejected') return;
      const failure = outcome.result.error;
      if (failure.code === 'stale_revision') {
        setError('This note changed since you opened it. Nothing was saved and it did not count. Read the current note, then mark it again.');
        const fresh = await getChunk(db, seen.id);
        if (reviewMarkController.generation() !== gen) return;
        if (fresh && fresh.roomId === roomId) {
          setCards((current) => current.map((item) => (item.id === seen.id ? toCard(fresh) : item)));
        } else {
          setCards((current) => current.filter((item) => item.id !== seen.id));
        }
        return;
      }
      if (failure.code === 'not_found') {
        setError('This note no longer exists.');
        setCards((current) => current.filter((item) => item.id !== seen.id));
        setDone((count) => count + 1);
        return;
      }
      setError(failure.message);
    } catch (reason) {
      if (reviewMarkController.generation() !== gen) return;
      setError(reason instanceof Error ? reason.message : 'Could not save the mark');
    } finally {
      marking.current = false;
      if (reviewMarkController.generation() === gen) setBusy(false);
    }
  }

  function skip() {
    if (!card || marking.current) return;
    setCards((current) => current.filter((item) => item.id !== card.id));
    setDone((count) => count + 1);
    setError(null);
  }

  const ink = theme.color.text.primary;
  const muted = theme.color.text.secondary;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 120 }}>
          <View style={[column, { gap: theme.space.section }]} testID="review-screen">
            <ScreenHeader
              back={<BackButton label={room?.name ?? 'Back'} accessibilityLabel="Back" onPress={leave} testID="review-back" />}
              title="Review"
            >
              {room ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, marginTop: theme.space.xs }}>
                  <StageGlyph stage={stage} size={28} />
                  <Text testID="review-stage" style={[theme.text('bodySmall'), { color: muted }]}>Stone stage: {stage}</Text>
                </View>
              ) : null}
            </ScreenHeader>
            {loading ? <ActivityIndicator color={theme.color.accent.bg} /> : null}
            {shownError ? <Notice tone="danger" testID="review-error">{shownError}</Notice> : null}
            {!loading && missing ? (
              <EmptyState title="This room was not found." body="It may have been deleted on this device.">
                <Button label="Back to rooms" size="compact" onPress={() => router.replace('/')} />
              </EmptyState>
            ) : null}
            {!loading && room ? (
              <View style={{ gap: theme.space.section }}>
                {saved ? <Notice tone="success" testID="review-saved">{saved}</Notice> : null}
                {card && asked ? (
                  <View style={{ backgroundColor: theme.color.bg.surface, borderColor: theme.color.border.hairline, borderRadius: theme.radius.card, borderWidth: 1, gap: theme.space.base, padding: theme.space.card, ...theme.shadow.card }}>
                    <View style={{ gap: theme.space.md }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text testID="review-progress" style={[theme.text('label'), { color: theme.color.text.tertiary }]}>
                          {`Note ${Math.min(done + 1, total)} of ${total}`}
                        </Text>
                        <Text testID="review-revision" style={[theme.text('label'), { color: theme.color.text.tertiary }]}>{`Revision ${card.revision}`}</Text>
                      </View>
                      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', gap: 4 }}>
                        {Array.from({ length: total }, (_, index) => (
                          <View key={index} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: index < done ? theme.color.accent.bg : theme.color.bg.inset }} />
                        ))}
                      </View>
                    </View>
                    <Text testID="review-chunk" style={[theme.text('reading'), { color: ink }]}>{card.body}</Text>
                    {asked.ok ? (
                      <View style={{ backgroundColor: theme.color.bg.canvas, borderRadius: theme.radius.lg, padding: theme.space.base }}>
                        <Text testID="review-question" style={[theme.text('actionTitle'), { color: ink }]}>{asked.question.split('\n')[0]}</Text>
                      </View>
                    ) : (
                      <View style={{ gap: theme.space.md, alignItems: 'flex-start' }}>
                        <Text accessibilityRole="alert" testID="review-question-error" style={[theme.text('bodySmall'), { color: theme.color.status.danger.text }]}>{asked.message}</Text>
                        <Button label="Skip this note" size="compact" variant="ghost" disabled={busy} onPress={skip} />
                      </View>
                    )}
                    <View style={{ flexDirection: 'row', gap: theme.space.md }}>
                      {(Object.keys(REVIEW_LABEL) as ReviewState[]).map((state) => (
                        <MarkButton key={state} state={state} label={REVIEW_LABEL[state]} disabled={busy} onPress={() => void mark(state)} />
                      ))}
                    </View>
                  </View>
                ) : (
                  <EmptyState
                    testID="review-empty"
                    title={total === 0 && scheduled.length === 0 ? 'No notes to review.' : 'Nothing is due right now.'}
                    body={total === 0 && scheduled.length === 0 ? 'Add notes to this room, then come back to review them.' : 'Marked notes come back on the day shown below.'}
                  />
                )}
                {scheduled.length ? (
                  <View style={{ gap: theme.space.xl }} testID="review-schedule">
                    <SectionTitle>Coming up</SectionTitle>
                    <Group>
                      {scheduled.map((item) => (
                        <View key={item.chunkId} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xl, minHeight: 52, paddingHorizontal: theme.space.base, paddingVertical: theme.space.md }}>
                          <StatusMark state={item.state} size={24} />
                          <Text testID={`review-scheduled-${item.chunkId}`} style={[theme.text('bodySmall'), { flex: 1, color: muted }]}>
                            {`${REVIEW_LABEL[item.state]} · ${item.localDay} · due ${formatDueAt(item.dueAt)}`}
                          </Text>
                        </View>
                      ))}
                    </Group>
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

/** One review choice, tinted with its status wash so the three read apart at a glance. */
function MarkButton({ state, label, disabled, onPress }: { state: ReviewState; label: string; disabled: boolean; onPress: () => void }) {
  const theme = useStoneTheme();
  const pair = theme.color.status[REVIEW_TONE[state]];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 56,
        borderRadius: theme.radius.lg,
        backgroundColor: pair.wash,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space.xs,
        paddingVertical: theme.space.md,
        opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
      })}
    >
      <StatusMark state={state} size={22} />
      <Text style={[theme.text('buttonCompact'), { color: pair.text }]}>{label}</Text>
    </Pressable>
  );
}

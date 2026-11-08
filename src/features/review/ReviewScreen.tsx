import { randomUUID } from 'expo-crypto';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Screen, useStoneTheme } from '../../../design-theme/src/primitives';
import { Icon } from '../../ui/Icon';
import { REVIEW_ICON, REVIEW_TONE, StatusMark } from '../../ui/StatusMark';
import { EmptyState, Group, Notice, SectionTitle, useColumn } from '../../ui/kit';
import { createCommit } from '../../data/commit';
import type { Annotation, ReviewMark, Room, RoomStage } from '../../data/models';
import { getAnnotation, getChunk, getRoom, latestAnswerMark, latestReviewMark, listChunks, listRoomAnnotations } from '../../data/queries';
import type { ReviewState } from '../../db/schema';
import { expoDriver } from '../../db/expo-driver';
import { citationFromAnnotation } from '../ask/citations';
import { companionProvider } from '../../harness/companionClient';
import { getCompanionSettings, useCompanionSettings } from '../../harness/companionSettings';
import { EMPTY_TALLY, ReviewDone, nextUpSummary, type ReviewTally } from './ReviewDone';
import {
  chooseReviewQuestion,
  questionCacheKey,
  requestReviewQuestion,
  type QuestionChoice,
} from './question';
import { reviewMarkController } from './mark-attempt';
import { acknowledgeDisplayedCards } from './mark-progress';
import {
  REVIEW_LABEL,
  deviceTimeZone,
  formatDueAt,
  localReviewQuestion,
  mockAnswerQuestion,
  orderReviewQueue,
  reviewCardId,
  reviewQueueForRoom,
  type ReviewCard,
  type ReviewQueueAnswer,
} from './session';

type Scheduled = {
  key: string;
  chunkId: string;
  annotationId: string | null;
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

function toCard(chunk: { id: string; position: number; body: string; revision: number }): ReviewCard {
  return {
    kind: 'chunk',
    chunk: { id: chunk.id, position: chunk.position, body: chunk.body, revision: chunk.revision },
  };
}

function answerText(annotation: Annotation): string {
  const answer = annotation.payload.answer;
  return typeof answer === 'string' ? answer : '';
}

function savedQuote(grounding: unknown): string | null {
  if (typeof grounding !== 'object' || grounding === null || Array.isArray(grounding)) return null;
  const quote = (grounding as { quote?: unknown }).quote;
  return typeof quote === 'string' && quote.length > 0 ? quote : null;
}

function toAnswerCard(
  annotation: Annotation,
  chunk: { id: string; position: number; body: string; revision: number },
): ReviewCard {
  const answer: ReviewQueueAnswer = {
    id: annotation.id,
    annotationId: annotation.id,
    chunkId: chunk.id,
    position: chunk.position,
    answer: answerText(annotation),
    quote: savedQuote(annotation.payload),
    chunkBody: chunk.body,
    chunkRevision: chunk.revision,
    anchor: annotation.anchor,
    grounding: annotation.payload,
  };
  return { kind: 'answer', answer };
}

function stageSummary(roomName: string, card: ReviewCard, lastState: Record<string, ReviewState>): string {
  const last = lastState[reviewCardId(card)];
  if (last) return `${roomName} · ${REVIEW_LABEL[last].toLowerCase()} last time`;
  return `${roomName} · ${card.kind === 'answer' ? 'saved answer' : 'new note'}`;
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
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [outcomes, setOutcomes] = useState<(ReviewState | 'skipped')[]>([]);
  const [scheduled, setScheduled] = useState<Scheduled[]>([]);
  const [lastState, setLastState] = useState<Record<string, ReviewState>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tally, setTally] = useState<ReviewTally>(EMPTY_TALLY);
  const [promotedNow, setPromotedNow] = useState(false);
  const [sessionDue, setSessionDue] = useState<number[]>([]);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [finishedAt, setFinishedAt] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!roomId) return { missing: true, room: null, cards: [] as ReviewCard[], scheduled: [] as Scheduled[] };
    const found = await getRoom(db, roomId);
    if (!found) return { missing: true, room: null, cards: [] as ReviewCard[], scheduled: [] as Scheduled[] };
    const now = Date.now();
    const chunks = await listChunks(db, roomId);
    const marks = await Promise.all(chunks.map((chunk) => latestReviewMark(db, chunk.id)));
    const latest = new Map<string, ReviewMark>();
    chunks.forEach((chunk, index) => {
      const mark = marks[index];
      if (mark) latest.set(chunk.id, mark);
    });
    const annotations = (await listRoomAnnotations(db, roomId)).filter((annotation) => annotation.type === 'ai_answer');
    const byChunk = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const answerMarks = await Promise.all(annotations.map((annotation) => latestAnswerMark(db, annotation.id)));
    const latestAnswers = new Map<string, { dueAt: number }>();
    answerMarks.forEach((mark, index) => {
      const annotation = annotations[index];
      if (mark && annotation) latestAnswers.set(annotation.id, mark);
    });
    const answers = annotations.flatMap((annotation) => {
      const chunk = byChunk.get(annotation.chunkId);
      if (!chunk) return [];
      const card = toAnswerCard(annotation, chunk);
      return card.kind === 'answer' ? [card.answer] : [];
    });
    const queue = reviewQueueForRoom({
      chunks: chunks.map((chunk) => ({ id: chunk.id, position: chunk.position, body: chunk.body, revision: chunk.revision })),
      answers,
      latestByChunk: latest,
      latestByAnnotation: latestAnswers,
      now,
    });
    const entries = queue.map((card) => ({ id: reviewCardId(card), card }));
    const retainedIds = entries.filter((entry) => reviewMarkController.retained(entry.id)).map((entry) => entry.id);
    const startId = startChunkId ?? retainedIds.find((id) => entries.some((entry) => entry.id === id));
    const cards = orderReviewQueue(entries, startId, entries).map((entry) => entry.card);
    const scheduled: Scheduled[] = [
      ...[...latest.values()]
        .filter((mark) => mark.dueAt > now)
        .map((mark) => ({
          key: mark.chunkId,
          chunkId: mark.chunkId,
          annotationId: null as string | null,
          state: mark.state,
          localDay: mark.localDay,
          dueAt: mark.dueAt,
        })),
      ...answerMarks.flatMap((mark) =>
        mark !== null && mark.dueAt > now
          ? [{
              key: mark.annotationId,
              chunkId: mark.chunkId,
              annotationId: mark.annotationId,
              state: mark.state,
              localDay: mark.localDay,
              dueAt: mark.dueAt,
            }]
          : [],
      ),
    ].sort((left, right) => left.dueAt - right.dueAt || left.key.localeCompare(right.key));
    const last: Record<string, ReviewState> = {};
    latest.forEach((mark, id) => { last[id] = mark.state; });
    answerMarks.forEach((mark) => {
      if (mark) last[mark.annotationId] = mark.state;
    });
    return { missing: false, room: found, cards, scheduled, last };
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
        setOutcomes([]);
        setTally(EMPTY_TALLY);
        setPromotedNow(false);
        setSessionDue([]);
        setStartedAt(Date.now());
        setScheduled(next.scheduled);
        setLastState(next.last ?? {});
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
  const chunk = card?.kind === 'chunk' ? card.chunk : null;
  const settings = useCompanionSettings();
  const paired = settings.token.trim().length > 0;
  const [questionCache, setQuestionCache] = useState<Record<string, QuestionChoice>>({});
  const [shownAnswerKey, setShownAnswerKey] = useState<string | null>(null);
  const cardKey = chunk ? questionCacheKey(chunk) : null;
  const cardId = chunk?.id;
  const cardBody = chunk?.body;
  const cachedChoice = cardKey ? questionCache[cardKey] : undefined;
  const hasCached = cachedChoice !== undefined;

  useEffect(() => {
    if (!cardKey || cardId === undefined || cardBody === undefined || !roomId || hasCached) return;
    const current = getCompanionSettings();
    if (!current.token.trim() || !cardBody.trim()) return;
    const controller = new AbortController();
    requestReviewQuestion({
      roomId,
      chunk: { id: cardId, roomId, body: cardBody },
      provider: companionProvider({ baseUrl: current.url, token: current.token }),
      scenario: current.scenario,
      signal: controller.signal,
    })
      .then((result) => chooseReviewQuestion({ token: current.token, result }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return null;
        return chooseReviewQuestion({ token: current.token, result: { error } });
      })
      .then((choice) => {
        if (!choice || controller.signal.aborted) return;
        setQuestionCache((cache) => ({ ...cache, [cardKey]: choice }));
      });
    return () => controller.abort();
  }, [cardKey, cardId, cardBody, roomId, hasCached, paired]);

  const local = chunk ? localReviewQuestion(chunk) : null;
  const choice = cachedChoice ?? (paired ? null : chooseReviewQuestion({ token: '', result: null }));
  const waiting = Boolean(chunk && local?.ok && paired && !choice);
  const chunkAsked: typeof local = !chunk || !local
    ? null
    : choice?.source === 'companion'
      ? { ok: true, question: choice.question }
      : local;
  const asked = !card ? null : card.kind === 'answer' ? mockAnswerQuestion(card.answer) : chunkAsked;
  const questionNotice = chunk && local?.ok && choice?.source === 'local' ? choice.notice : null;
  const answer = chunk && choice?.source === 'companion' ? choice.answer : null;
  const pending = !busy && card ? reviewMarkController.retained(reviewCardId(card)) : null;
  const shownError = error ?? (pending
    ? `The previous ${REVIEW_LABEL[pending.payload.state]} mark did not finish. Retry that choice. It will not be counted twice.`
    : null);

  // The last note's mark did not save: stay on the summary and offer a retry.
  const reviewedAny = tally.got_it + tally.unclear + tally.missed > 0;
  const showDone = reviewedAny && (!card ? total > 0 && done > 0 : cards.length === 1 && pending !== null);

  async function mark(state: ReviewState) {
    if (!card || !roomId || marking.current) return;
    const seen = card;
    const seenKey = reviewCardId(seen);
    const seenChunkId = seen.kind === 'answer' ? seen.answer.chunkId : seen.chunk.id;
    const seenRevision = seen.kind === 'answer' ? seen.answer.chunkRevision : seen.chunk.revision;
    const seenAnnotationId = seen.kind === 'answer' ? seen.answer.annotationId : undefined;
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
        request: seenAnnotationId === undefined
          ? { chunkId: seenChunkId, state, expectedRevision: seenRevision }
          : { chunkId: seenChunkId, annotationId: seenAnnotationId, state, expectedRevision: seenRevision },
        report: (result, attempt) => {
          if (consumeLostReviewReport()) throw new Error('response lost');
          const was = stageRef.current;
          stageRef.current = result.value.stage;
          const promoted = was === 'stonehenge' && result.value.stage === 'brick' ? ' This room is now brick.' : '';
          const progress = acknowledgeDisplayedCards({
            cards: [],
            done: 0,
            displayedId: seenKey,
            displayedRevision: seenRevision,
            markedRevision: attempt.expectedRevision,
          });
          setStage(result.value.stage);
          const scheduledKey = result.value.annotationId ?? result.value.chunkId;
          setScheduled((current) => {
            const next = current.filter((item) => item.key !== scheduledKey);
            next.push({
              key: scheduledKey,
              chunkId: result.value.chunkId,
              annotationId: result.value.annotationId,
              state: result.value.state,
              localDay: result.value.localDay,
              dueAt: result.value.dueAt,
            });
            next.sort((left, right) => left.dueAt - right.dueAt || left.key.localeCompare(right.key));
            return next;
          });
          if (!progress.reviewedDisplayedRevision) {
            setSaved(`The earlier ${REVIEW_LABEL[result.value.state]} mark was saved. This note is still open.`);
            return;
          }
          setSaved(`Saved ${REVIEW_LABEL[result.value.state]}. Due ${formatDueAt(result.value.dueAt)}.${promoted}`);
          setCards((current) => current.filter((item) => reviewCardId(item) !== seenKey));
          setDone((count) => count + 1);
          setOutcomes((current) => [...current, result.value.state]);
          setTally((current) => ({ ...current, [result.value.state]: current[result.value.state] + 1 }));
          setSessionDue((current) => [...current, result.value.dueAt]);
          setFinishedAt(Date.now());
          if (promoted) setPromotedNow(true);
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
        if (seenAnnotationId === undefined) {
          setError('This note changed since you opened it. Nothing was saved and it did not count. Read the current note, then mark it again.');
          const fresh = await getChunk(db, seenChunkId);
          if (reviewMarkController.generation() !== gen) return;
          if (fresh && fresh.roomId === roomId) {
            setCards((current) => current.map((item) => (reviewCardId(item) === seenKey ? toCard(fresh) : item)));
          } else {
            setCards((current) => current.filter((item) => reviewCardId(item) !== seenKey));
          }
          return;
        }
        setError('This saved answer no longer matches the note. Nothing was saved and it did not count. Ask again, then mark the new answer.');
        const fresh = await getChunk(db, seenChunkId);
        if (reviewMarkController.generation() !== gen) return;
        if (fresh && fresh.roomId === roomId) {
          const pin = await getAnnotation(db, seenAnnotationId);
          if (pin && pin.chunkId === fresh.id) {
            setCards((current) => current.map((item) => (reviewCardId(item) === seenKey ? toAnswerCard(pin, fresh) : item)));
            return;
          }
        }
        setCards((current) => current.filter((item) => reviewCardId(item) !== seenKey));
        return;
      }
      if (failure.code === 'not_found') {
        setError(seenAnnotationId === undefined ? 'This note no longer exists.' : 'This saved answer no longer exists.');
        setCards((current) => current.filter((item) => reviewCardId(item) !== seenKey));
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
    const skipped = reviewCardId(card);
    setCards((current) => current.filter((item) => reviewCardId(item) !== skipped));
    setDone((count) => count + 1);
    setOutcomes((current) => [...current, 'skipped']);
    setError(null);
  }

  const ink = theme.color.text.primary;
  const muted = theme.color.text.secondary;
  const tertiary = theme.color.text.tertiary;
  const cardStyle = {
    backgroundColor: theme.color.bg.surface,
    borderColor: theme.color.border.hairline,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    gap: theme.space.base,
    paddingHorizontal: theme.space.card,
    paddingVertical: 20,
  } as const;
  const segmentColor = (index: number): string => {
    if (index < done) {
      const outcome = outcomes[index];
      if (outcome && outcome !== 'skipped') return theme.color.status[REVIEW_TONE[outcome]].fill;
      return theme.color.border.strong;
    }
    return index === done ? theme.color.accent.bg : theme.color.bg.inset;
  };

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: theme.space.section }}>
          <View style={[column, { flexGrow: 1, gap: theme.space.base }]} testID="review-screen">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="End review"
                testID="review-back"
                onPress={leave}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="cross" size={20} color={ink} />
              </Pressable>
              <View
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: total, now: Math.min(done, total) }}
                style={{ flex: 1, flexDirection: 'row', gap: 4 }}
              >
                {Array.from({ length: total }, (_, index) => (
                  <View key={index} style={{ flex: 1, height: 8, borderRadius: theme.radius.sm, backgroundColor: segmentColor(index) }} />
                ))}
              </View>
              {card ? (
                <Text testID="review-progress" style={[theme.text('caption'), { color: tertiary, minWidth: 44, textAlign: 'center', fontVariant: ['tabular-nums'] }]}>
                  {`${Math.min(done + 1, total)} / ${total}`}
                </Text>
              ) : null}
            </View>
            {loading ? <ActivityIndicator color={theme.color.accent.bg} /> : null}
            {shownError && !(showDone && !error) ? <Notice tone="danger" testID="review-error">{shownError}</Notice> : null}
            {!loading && missing ? (
              <EmptyState title="This room was not found." body="It may have been deleted on this device.">
                <Button label="Back to rooms" size="compact" onPress={() => router.replace('/')} />
              </EmptyState>
            ) : null}
            {!loading && room ? (
              <View style={{ flexGrow: 1, gap: theme.space.base }}>
                {saved ? <Notice tone="success" testID="review-saved">{saved}</Notice> : null}
                {card && asked && !showDone ? (
                  <>
                    <View accessibilityLabel="Question" style={[cardStyle, theme.shadow.card]}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.space.md }}>
                        <Text testID="review-stage" numberOfLines={1} style={[theme.text('eyebrow'), { flex: 1, color: tertiary }]}>
                          {stageSummary(room.name, card, lastState)}
                        </Text>
                        <Text testID="review-revision" style={[theme.text('caption'), { color: tertiary }]}>
                          {card.kind === 'answer' ? `Revision ${card.answer.chunkRevision}` : `Revision ${card.chunk.revision}`}
                        </Text>
                      </View>
                      <Text style={[theme.text('caption'), { color: tertiary }]}>Practice question</Text>
                      {waiting ? (
                        <Text testID="review-question-loading" accessibilityRole="progressbar" style={[theme.text('bodySmall'), { color: muted }]}>Writing a question…</Text>
                      ) : asked.ok ? (
                        <Text testID="review-question" accessibilityRole="header" style={[theme.text('actionTitle'), { color: ink, fontSize: 22, lineHeight: 28, letterSpacing: -0.4 }]}>
                          {asked.question.split('\n')[0]}
                        </Text>
                      ) : (
                        <View style={{ gap: theme.space.md, alignItems: 'flex-start' }}>
                          <Text accessibilityRole="alert" testID="review-question-error" style={[theme.text('bodySmall'), { color: theme.color.status.danger.text }]}>{asked.message}</Text>
                        </View>
                      )}
                      {questionNotice ? (
                        <Text testID="review-question-notice" style={[theme.text('caption'), { color: tertiary }]}>{questionNotice}</Text>
                      ) : null}
                      {answer ? (
                        shownAnswerKey === cardKey ? (
                          <Text testID="review-answer" style={[theme.text('bodySmall'), { color: ink }]}>{answer}</Text>
                        ) : (
                          <Pressable accessibilityRole="button" accessibilityLabel="Show answer" testID="review-show-answer" onPress={() => setShownAnswerKey(cardKey)} style={{ minHeight: 44, justifyContent: 'center' }}>
                            <Text style={[theme.text('nav'), { color: muted }]}>Show answer</Text>
                          </Pressable>
                        )
                      ) : null}
                    </View>
                    {card.kind === 'answer'
                      ? <AnswerCardBody card={card} roomId={roomId} />
                      : (
                        <View accessibilityLabel="Your note" style={[cardStyle, { gap: 10, paddingVertical: 18 }]}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={[theme.text('eyebrow'), { color: tertiary }]}>Your note</Text>
                            <Pressable accessibilityRole="link" testID="review-open-room" onPress={() => void reviewMarkController.requestLeave(() => router.replace(`/rooms/${roomId}`))} style={{ minHeight: 44, justifyContent: 'center' }}>
                              <Text style={[theme.text('caption'), { color: muted }]}>Open in room</Text>
                            </Pressable>
                          </View>
                          <Text testID="review-chunk" style={[theme.text('reading'), { color: ink, fontSize: 16, lineHeight: 26 }]}>{card.chunk.body}</Text>
                        </View>
                      )}
                    <Text style={[theme.text('caption'), { color: tertiary, textAlign: 'center' }]}>How well did you know it?</Text>
                    <View style={{ flexDirection: 'row', gap: theme.space.md, marginTop: 'auto' }}>
                      {(Object.keys(REVIEW_LABEL) as ReviewState[]).map((state) => (
                        <MarkButton key={state} state={state} label={REVIEW_LABEL[state]} hint={REVIEW_HINT[state]} disabled={busy} onPress={() => void mark(state)} />
                      ))}
                    </View>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={skip} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={[theme.text('nav'), { color: muted }]}>{card.kind === 'answer' ? 'Skip this answer' : 'Skip this note'}</Text>
                    </Pressable>
                  </>
                ) : null}
                {showDone ? (
                  <ReviewDone
                    roomName={room.name}
                    stage={stage}
                    promoted={promotedNow}
                    tally={tally}
                    minutes={Math.round((finishedAt - startedAt) / 60000)}
                    nextUp={nextUpSummary(sessionDue, finishedAt)}
                    unsaved={pending ? { count: 1, busy, onRetry: () => void mark(pending.payload.state) } : null}
                    onToday={() => router.replace('/today')}
                    onHome={() => router.replace('/stone')}
                  />
                ) : !(card && asked) ? (
                  <EmptyState
                    testID="review-empty"
                    title={total === 0 && scheduled.length === 0 ? 'No notes to review.' : 'Nothing is due right now.'}
                    body={total === 0 && scheduled.length === 0 ? 'Add notes to this room, then come back to review them.' : 'Marked notes come back on the day shown below.'}
                  />
                ) : null}
                {scheduled.length ? (
                  <View style={{ gap: theme.space.xl }} testID="review-schedule">
                    <SectionTitle>Coming up</SectionTitle>
                    <Group>
                      {scheduled.map((item) => (
                        <View key={item.key} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xl, minHeight: 52, paddingHorizontal: theme.space.base, paddingVertical: theme.space.md }}>
                          <StatusMark state={item.state} size={24} />
                          <Text testID={`review-scheduled-${item.key}`} style={[theme.text('bodySmall'), { flex: 1, color: muted }]}>
                            {item.annotationId
                              ? `Saved answer · ${REVIEW_LABEL[item.state]} · ${item.localDay} · due ${formatDueAt(item.dueAt)}`
                              : `${REVIEW_LABEL[item.state]} · ${item.localDay} · due ${formatDueAt(item.dueAt)}`}
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

/** When each mark comes back; matches the fixed due intervals in the review_marks decision (#40). */
const REVIEW_HINT: Record<ReviewState, string> = {
  missed: 'again soon',
  unclear: 'in 1 day',
  got_it: 'in 3 days',
};

/** A pinned answer under review: the saved answer plus its cited passage, or the stale warning. */
function AnswerCardBody({ card, roomId }: { card: Extract<ReviewCard, { kind: 'answer' }>; roomId: string | undefined }) {
  const theme = useStoneTheme();
  const cited = citationFromAnnotation(card.answer.chunkBody, card.answer.anchor, card.answer.grounding);
  return (
    <View accessibilityLabel="Your saved answer" style={{ backgroundColor: theme.color.bg.surface, borderColor: theme.color.border.hairline, borderRadius: theme.radius.card, borderWidth: 1, gap: 10, paddingHorizontal: theme.space.card, paddingVertical: 18 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>Saved answer</Text>
        <Pressable accessibilityRole="link" testID="review-open-room" onPress={() => void reviewMarkController.requestLeave(() => router.replace(roomId ? `/rooms/${roomId}` : '/'))} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={[theme.text('caption'), { color: theme.color.text.secondary }]}>Open in room</Text>
        </Pressable>
      </View>
      <Text testID="review-saved-answer" style={[theme.text('reading'), { color: theme.color.text.primary, fontSize: 16, lineHeight: 26 }]}>
        {card.answer.answer || 'AI answer'}
      </Text>
      {cited.ok ? (
        <Text testID="review-saved-quote" style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>
          {`Cited passage: ${cited.quote}`}
        </Text>
      ) : (
        <Text accessibilityRole="alert" testID="review-saved-error" style={[theme.text('bodySmall'), { color: theme.color.status.danger.text }]}>
          {cited.message}
        </Text>
      )}
    </View>
  );
}

/** One review choice: a solid status fill carrying its icon, label and next-due hint. */function MarkButton({ state, label, hint, disabled, onPress }: { state: ReviewState; label: string; hint: string; disabled: boolean; onPress: () => void }) {
  const theme = useStoneTheme();
  const fill = theme.color.status[REVIEW_TONE[state]].fill;
  const onFill = theme.color.text.onFill;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 64,
        borderRadius: theme.radius.bubble,
        backgroundColor: fill,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
      })}
    >
      <Icon name={REVIEW_ICON[state]} size={18} strokeWidth={2.75} color={onFill} />
      <Text style={[theme.text('buttonCompact'), { color: onFill }]}>{label}</Text>
      <Text style={[theme.text('eyebrow'), { color: onFill, opacity: 0.85, letterSpacing: 0, fontWeight: '400' }]}>{hint}</Text>
    </Pressable>
  );
}

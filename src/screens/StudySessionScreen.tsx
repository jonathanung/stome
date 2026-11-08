import { randomUUID } from 'expo-crypto';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Screen, useStoneTheme } from '../../design-theme/src/primitives';
import { createCommit } from '../data/commit';
import type { Chunk, SlideOutline, StudyCard, StudyQuestion } from '../data/models';
import {
  getRoom,
  getSlideOutline,
  getStudyDeck,
  getStudyQuiz,
  listChunks,
  listSlideOutlines,
  listStudyCards,
  listStudyDecks,
  listStudyQuestions,
  listStudyQuizzes,
} from '../data/queries';
import { expoDriver } from '../db/expo-driver';
import { BackButton, EmptyState, Notice, SectionTitle, useColumn } from '../ui/kit';
import { deviceTimeZone } from '../features/review/session';
import { SessionDeck } from '../features/study/sessionDeck';
import { SessionQuiz, type QuizAnswers } from '../features/study/sessionQuiz';
import { SessionSlides } from '../features/study/sessionSlides';
import {
  inStudyOrder,
  isStale,
  mockDeckForChunks,
  mockQuizForChunks,
  ratingToMark,
  RATING_LABEL,
  type StudyRating,
} from '../features/study/session';

type Tab = 'deck' | 'quiz' | 'slides';

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function mockOutlineForChunks(roomName: string, chunks: Chunk[]): SlideOutline {
  return {
    id: 'mock-outline',
    roomId: chunks[0]?.roomId ?? '',
    title: roomName ? `${roomName} — outline` : 'Study outline',
    slides: chunks.map((chunk) => ({
      title: chunk.body.trim().split('\n')[0]?.slice(0, 80) || 'Untitled note',
      bullets: chunk.body.trim().split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 4),
      notes: '',
      sourceChunkIds: [chunk.id],
      sourceRevision: chunk.revision,
    })),
    sourceChunkIds: chunks.map((chunk) => chunk.id),
    sourceRevision: chunks[0]?.revision ?? 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

export function StudySessionScreen() {
  const params = useLocalSearchParams<{ id?: string | string[]; tab?: string | string[] }>();
  const roomId = one(params.id);
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const commit = useMemo(() => createCommit(db, { now: Date.now, newId: randomUUID }), [db]);
  const theme = useStoneTheme();
  const column = useColumn();

  const [tab, setTab] = useState<Tab>(() => {
    const initial = one(params.tab);
    return initial === 'quiz' || initial === 'slides' ? initial : 'deck';
  });
  const [roomName, setRoomName] = useState<string | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [deckId, setDeckId] = useState<string | null>(null);
  const [deckTitle, setDeckTitle] = useState<string | null>(null);
  const [deckCards, setDeckCards] = useState<StudyCard[]>([]);
  const [deckOptions, setDeckOptions] = useState<{ id: string; title: string }[]>([]);
  const [quizId, setQuizId] = useState<string | null>(null);
  const [quizTitle, setQuizTitle] = useState<string | null>(null);
  const [quizQuestions, setQuizQuestions] = useState<StudyQuestion[]>([]);
  const [quizOptions, setQuizOptions] = useState<{ id: string; title: string }[]>([]);
  const [outlineId, setOutlineId] = useState<string | null>(null);
  const [outline, setOutline] = useState<SlideOutline | null>(null);
  const [outlineOptions, setOutlineOptions] = useState<{ id: string; title: string }[]>([]);
  const [usingMocks, setUsingMocks] = useState(false);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Deck runner state.
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [marking, setMarking] = useState(false);
  const [deckSaved, setDeckSaved] = useState<string | null>(null);
  const [rated, setRated] = useState(0);

  // Quiz runner state.
  const [quizKey, setQuizKey] = useState(0);
  const [quizDone, setQuizDone] = useState<null | { answers: QuizAnswers; score: string }>(null);
  const [quizSaving, setQuizSaving] = useState(false);
  const [quizNotice, setQuizNotice] = useState<string | null>(null);

  // Slide present state.
  const [slideIndex, setSlideIndex] = useState(0);

  const revisionByChunk = useMemo(() => {
    const map = new Map<string, number>();
    for (const chunk of chunks) map.set(chunk.id, chunk.revision);
    return map;
  }, [chunks]);
  const chunksById = useMemo(() => new Map(chunks.map((chunk) => [chunk.id, chunk])), [chunks]);

  const load = useCallback(async () => {
    if (!roomId) return { missing: true };
    const room = await getRoom(db, roomId);
    if (!room) return { missing: true };
    const notes = await listChunks(db, roomId);
    const [decks, quizzes, outlines] = await Promise.all([
      listStudyDecks(db, roomId),
      listStudyQuizzes(db, roomId),
      listSlideOutlines(db, roomId),
    ]);
    return { missing: false, room, notes, decks, quizzes, outlines };
  }, [db, roomId]);

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    load()
      .then(async (next) => {
        if (!active || next.missing) {
          if (active) { setMissing(true); setLoading(false); }
          return;
        }
        if (!active) return;
        setMissing(false);
        setRoomName(next.room!.name);
        setChunks(next.notes!);
        setError(null);

        const deckOpts = next.decks!.map((deck) => ({ id: deck.id, title: deck.title }));
        const quizOpts = next.quizzes!.map((quiz) => ({ id: quiz.id, title: quiz.title }));
        const outlineOpts = next.outlines!.map((item) => ({ id: item.id, title: item.title }));
        setDeckOptions(deckOpts);
        setQuizOptions(quizOpts);
        setOutlineOptions(outlineOpts);

        if (next.decks!.length > 0 || next.quizzes!.length > 0 || next.outlines!.length > 0) {
          setUsingMocks(false);
          const firstDeck = next.decks![0] ?? null;
          const firstQuiz = next.quizzes![0] ?? null;
          const firstOutline = next.outlines![0] ?? null;
          const [cards, questions, fullOutline] = await Promise.all([
            firstDeck ? listStudyCards(db, firstDeck.id) : Promise.resolve([] as StudyCard[]),
            firstQuiz ? listStudyQuestions(db, firstQuiz.id) : Promise.resolve([] as StudyQuestion[]),
            firstOutline ? getSlideOutline(db, firstOutline.id) : Promise.resolve(null),
          ]);
          if (!active) return;
          setDeckId(firstDeck?.id ?? null);
          setDeckTitle(firstDeck?.title ?? null);
          setDeckCards(inStudyOrder(cards));
          setQuizId(firstQuiz?.id ?? null);
          setQuizTitle(firstQuiz?.title ?? null);
          setQuizQuestions(inStudyOrder(questions));
          setOutlineId(firstOutline?.id ?? null);
          setOutline(fullOutline);
        } else {
          // Deterministic fixtures until STUDY.2/3 land: same chunk, same mocks.
          setUsingMocks(true);
          setDeckId(null);
          setDeckTitle(next.notes!.length ? 'Mock deck — same note, same cards' : null);
          setDeckCards(mockDeckForChunks(next.notes!));
          setQuizId(null);
          setQuizTitle(next.notes!.length ? 'Mock quiz — same note, same questions' : null);
          setQuizQuestions(mockQuizForChunks(next.notes!));
          setOutlineId(null);
          setOutline(next.notes!.length ? mockOutlineForChunks(next.room!.name, next.notes!) : null);
        }
        setCardIndex(0);
        setFlipped(false);
        setRated(0);
        setDeckSaved(null);
        setQuizDone(null);
        setQuizNotice(null);
        setSlideIndex(0);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'Could not open the study session');
        setLoading(false);
      });
    return () => { active = false; };
  }, [load, db]));

  async function selectDeck(id: string) {
    setError(null);
    const deck = await getStudyDeck(db, id);
    if (!deck) { setError('That deck no longer exists.'); return; }
    const cards = await listStudyCards(db, id);
    setDeckId(id);
    setDeckTitle(deck.title);
    setDeckCards(inStudyOrder(cards));
    setCardIndex(0);
    setFlipped(false);
    setDeckSaved(null);
  }

  async function selectQuiz(id: string) {
    setError(null);
    const quiz = await getStudyQuiz(db, id);
    if (!quiz) { setError('That quiz no longer exists.'); return; }
    const questions = await listStudyQuestions(db, id);
    setQuizId(id);
    setQuizTitle(quiz.title);
    setQuizQuestions(inStudyOrder(questions));
    setQuizDone(null);
    setQuizNotice(null);
    setQuizKey((key) => key + 1);
  }

  async function selectOutline(id: string) {
    setError(null);
    const found = await getSlideOutline(db, id);
    if (!found) { setError('That outline no longer exists.'); return; }
    setOutlineId(id);
    setOutline(found);
    setSlideIndex(0);
  }

  /** Deck rating writes one human review.mark per source chunk. Survives reload. */
  async function rate(rating: StudyRating) {
    const card = deckCards[cardIndex];
    if (!card || marking) return;
    setMarking(true);
    setError(null);
    try {
      const state = ratingToMark(rating);
      const zone = deviceTimeZone();
      let saved = 0;
      for (const chunkId of card.sourceChunkIds) {
        const chunk = chunksById.get(chunkId);
        if (!chunk) continue;
        const result = await commit({
          opId: randomUUID(),
          kind: 'review.mark',
          source: 'human',
          confirmed: false,
          expectedRevision: chunk.revision,
          payload: { chunkId, state, timeZone: zone },
        });
        if (!result.ok) {
          if (result.error.code === 'stale_revision') {
            setError('That note changed since you opened it. Nothing was saved for it — read the current note, then rate again.');
            const fresh = await listChunks(db, roomId!);
            setChunks(fresh);
            continue;
          }
          throw new Error(result.error.message);
        }
        saved += 1;
      }
      setRated((count) => count + 1);
      if (saved > 0) {
        setDeckSaved(`Saved ${RATING_LABEL[rating]} for ${saved} note${saved === 1 ? '' : 's'}.`);
      } else {
        setDeckSaved(null);
      }
      if (cardIndex + 1 < deckCards.length) {
        setCardIndex(cardIndex + 1);
        setFlipped(false);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the rating');
    } finally {
      setMarking(false);
    }
  }

  /** Quiz finish marks each source note got_it/missed. Cancel writes nothing. */
  async function finishQuiz(answers: QuizAnswers) {
    setQuizSaving(true);
    setError(null);
    try {
      const zone = deviceTimeZone();
      const byId = new Map(quizQuestions.map((question) => [question.id, question]));
      let correct = 0;
      for (const answer of answers) {
        const question = byId.get(answer.questionId);
        if (!question) continue;
        if (answer.correct) correct += 1;
        const state = answer.correct ? 'got_it' : 'missed';
        for (const chunkId of question.sourceChunkIds) {
          const chunk = chunksById.get(chunkId);
          if (!chunk) continue;
          const result = await commit({
            opId: randomUUID(),
            kind: 'review.mark',
            source: 'human',
            confirmed: false,
            expectedRevision: chunk.revision,
            payload: { chunkId, state, timeZone: zone },
          });
          if (!result.ok && result.error.code !== 'stale_revision') throw new Error(result.error.message);
        }
      }
      const fresh = await listChunks(db, roomId!);
      setChunks(fresh);
      setQuizDone({ answers, score: `${correct}/${answers.length}` });
      setQuizNotice(`Finished ${correct} of ${answers.length}. Marks saved.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save quiz marks');
    } finally {
      setQuizSaving(false);
    }
  }

  function cancelQuiz() {
    // Buffered runner: nothing was committed mid-run, so cancel writes nothing.
    setQuizDone(null);
    setQuizNotice('Run cancelled — nothing was saved.');
    setQuizKey((key) => key + 1);
  }

  const deckStale = deckCards.length
    ? isStale(deckCards[cardIndex]?.sourceRevision ?? 0, deckCards[cardIndex]?.sourceChunkIds ?? [], revisionByChunk)
    : false;
  const quizStale = quizQuestions.map((question) => isStale(question.sourceRevision, question.sourceChunkIds, revisionByChunk));
  const slideStale = outline && outline.slides[slideIndex]
    ? isStale(outline.slides[slideIndex]!.sourceRevision, outline.slides[slideIndex]!.sourceChunkIds, revisionByChunk)
    : false;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: theme.space.section }}>
          <View style={[column, { flexGrow: 1, gap: theme.space.base, paddingTop: theme.space.base }]} testID="study-session-screen">
            <BackButton label="Back" testID="study-session-back" accessibilityLabel="Back to room" onPress={() => {
              if (router.canGoBack()) router.back();
              else if (roomId) router.replace(`/rooms/${roomId}`);
              else router.replace('/');
            }} />
            <View style={{ gap: theme.space.xs }}>
              <Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>
                {roomName ?? 'Study session'}
              </Text>
              <Text accessibilityRole="header" style={[theme.text('screenTitle'), { color: theme.color.text.primary }]}>
                Study session
              </Text>
              <Text style={[theme.text('caption'), { color: theme.color.text.tertiary }]}>
                {usingMocks
                  ? 'Preview fixtures — the same note always shows the same mock card and question until the generator lands.'
                  : 'Saved materials — flip, run, and present offline.'}
              </Text>
            </View>

            {loading ? <ActivityIndicator color={theme.color.accent.bg} /> : null}
            {error ? <Notice tone="danger" testID="study-session-error">{error}</Notice> : null}
            {!loading && missing ? (
              <EmptyState title="This room was not found." body="It may have been deleted on this device.">
                <Button label="Back to rooms" size="compact" onPress={() => router.replace('/')} />
              </EmptyState>
            ) : null}

            {!loading && !missing ? (
              <View style={{ gap: theme.space.base }}>
                <View
                  accessibilityRole="tablist"
                  accessibilityLabel="Study modes"
                  style={{ flexDirection: 'row', gap: theme.space.sm }}
                >
                  {(['deck', 'quiz', 'slides'] as Tab[]).map((mode) => {
                    const selected = tab === mode;
                    return (
                      <Pressable
                        key={mode}
                        accessibilityRole="tab"
                        accessibilityState={{ selected }}
                        accessibilityLabel={mode === 'deck' ? 'Deck session' : mode === 'quiz' ? 'Quiz runner' : 'Slide present'}
                        onPress={() => setTab(mode)}
                        testID={`study-tab-${mode}`}
                        style={{
                          flex: 1,
                          minHeight: 44,
                          borderRadius: theme.radius.control,
                          borderWidth: 1,
                          borderColor: selected ? theme.color.text.primary : theme.color.border.hairline,
                          backgroundColor: selected ? theme.color.text.primary : theme.color.bg.surface,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={[theme.text('buttonCompact'), { color: selected ? theme.color.bg.canvas : theme.color.text.primary }]}>
                          {mode === 'deck' ? 'Deck' : mode === 'quiz' ? 'Quiz' : 'Slides'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {tab === 'deck' ? (
                  <View style={{ gap: theme.space.base }}>
                    <SectionTitle aside={<Text style={[theme.text('caption'), { color: theme.color.text.tertiary }]}>{rated > 0 ? `${rated} rated` : ''}</Text>}>
                      {deckTitle ?? 'Deck'}
                    </SectionTitle>
                    {deckOptions.length > 1 ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
                        {deckOptions.map((option) => (
                          <Pressable
                            key={option.id}
                            accessibilityRole="button"
                            accessibilityState={{ selected: option.id === deckId }}
                            accessibilityLabel={`Open deck ${option.title}`}
                            onPress={() => void selectDeck(option.id)}
                            testID={`study-deck-option-${option.id.slice(0, 8)}`}
                            style={{
                              minHeight: 44,
                              paddingHorizontal: 12,
                              borderRadius: theme.radius.pill,
                              borderWidth: 1,
                              borderColor: option.id === deckId ? theme.color.text.primary : theme.color.border.hairline,
                              justifyContent: 'center',
                            }}
                          >
                            <Text style={[theme.text('caption'), { color: theme.color.text.secondary }]}>{option.title}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    {deckCards.length ? (
                      <SessionDeck
                        cards={deckCards}
                        index={Math.min(cardIndex, deckCards.length - 1)}
                        flipped={flipped}
                        stale={deckStale}
                        busy={marking}
                        saved={deckSaved}
                        onFlip={() => setFlipped((value) => !value)}
                        onRate={(rating) => void rate(rating)}
                        onPrev={() => { setCardIndex((i) => Math.max(0, i - 1)); setFlipped(false); }}
                        onNext={() => { setCardIndex((i) => Math.min(deckCards.length - 1, i + 1)); setFlipped(false); }}
                      />
                    ) : (
                      <EmptyState title="No deck cards." body="Generate a deck first, or add notes to preview fixtures." testID="study-deck-empty" />
                    )}
                  </View>
                ) : null}

                {tab === 'quiz' ? (
                  <View style={{ gap: theme.space.base }}>
                    <SectionTitle>{quizTitle ?? 'Quiz'}</SectionTitle>
                    {quizOptions.length > 1 ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
                        {quizOptions.map((option) => (
                          <Pressable
                            key={option.id}
                            accessibilityRole="button"
                            accessibilityState={{ selected: option.id === quizId }}
                            accessibilityLabel={`Open quiz ${option.title}`}
                            onPress={() => void selectQuiz(option.id)}
                            testID={`study-quiz-option-${option.id.slice(0, 8)}`}
                            style={{
                              minHeight: 44,
                              paddingHorizontal: 12,
                              borderRadius: theme.radius.pill,
                              borderWidth: 1,
                              borderColor: option.id === quizId ? theme.color.text.primary : theme.color.border.hairline,
                              justifyContent: 'center',
                            }}
                          >
                            <Text style={[theme.text('caption'), { color: theme.color.text.secondary }]}>{option.title}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    {quizNotice ? <Notice tone={quizDone ? 'success' : 'neutral'} testID="study-quiz-notice">{quizNotice}</Notice> : null}
                    {quizSaving ? <ActivityIndicator color={theme.color.accent.bg} /> : null}
                    {quizDone ? (
                      <View style={{ gap: theme.space.base }} testID="study-quiz-done">
                        <Notice tone="success" testID="study-quiz-score">
                          {`Score ${quizDone.score}. Marks saved to each source note.`}
                        </Notice>
                        <Button label="Run again" onPress={() => { setQuizDone(null); setQuizNotice(null); setQuizKey((key) => key + 1); }} />
                      </View>
                    ) : quizQuestions.length ? (
                      <SessionQuiz
                        key={`${quizId ?? 'mock'}-${quizKey}`}
                        questions={quizQuestions}
                        staleByQuestion={quizStale}
                        onFinish={(answers) => void finishQuiz(answers)}
                        onCancel={cancelQuiz}
                      />
                    ) : (
                      <EmptyState title="No quiz questions." body="Generate a quiz first, or add notes to preview fixtures." testID="study-quiz-empty" />
                    )}
                  </View>
                ) : null}

                {tab === 'slides' ? (
                  <View style={{ gap: theme.space.base }}>
                    <SectionTitle>{outline?.title ?? 'Slides'}</SectionTitle>
                    {outlineOptions.length > 1 ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
                        {outlineOptions.map((option) => (
                          <Pressable
                            key={option.id}
                            accessibilityRole="button"
                            accessibilityState={{ selected: option.id === outlineId }}
                            accessibilityLabel={`Open outline ${option.title}`}
                            onPress={() => void selectOutline(option.id)}
                            testID={`study-outline-option-${option.id.slice(0, 8)}`}
                            style={{
                              minHeight: 44,
                              paddingHorizontal: 12,
                              borderRadius: theme.radius.pill,
                              borderWidth: 1,
                              borderColor: option.id === outlineId ? theme.color.text.primary : theme.color.border.hairline,
                              justifyContent: 'center',
                            }}
                          >
                            <Text style={[theme.text('caption'), { color: theme.color.text.secondary }]}>{option.title}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    {outline && outline.slides.length ? (
                      <SessionSlides
                        outline={outline}
                        index={Math.min(slideIndex, outline.slides.length - 1)}
                        chunksById={chunksById}
                        stale={slideStale ?? false}
                        onPrev={() => setSlideIndex((i) => Math.max(0, i - 1))}
                        onNext={() => setSlideIndex((i) => Math.min(outline.slides.length - 1, i + 1))}
                      />
                    ) : (
                      <EmptyState title="No slides." body="Generate an outline first, or add notes to preview fixtures." testID="study-slides-empty" />
                    )}
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

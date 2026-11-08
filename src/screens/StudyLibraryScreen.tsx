import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, Screen, useStoneTheme } from '../../design-theme/src/primitives';
import type { Room, SlideOutline, StudyDeck, StudyQuiz } from '../data/models';
import {
  getRoom,
  listChunks,
  listSlideOutlines,
  listStudyAttempts,
  listStudyCards,
  listStudyDecks,
  listStudyQuestions,
  listStudyQuizzes,
  listRooms,
} from '../data/queries';
import { expoDriver } from '../db/expo-driver';
import { isStudyStale, revisionMap } from '../features/study/library';
import { BackButton, EmptyState, Notice, Row, ScreenHeader, SectionTitle, useColumn } from '../ui/kit';

interface DeckEntry {
  deck: StudyDeck;
  cards: number;
  stale: boolean;
}

interface QuizEntry {
  quiz: StudyQuiz;
  questions: number;
  attempts: number;
  stale: boolean;
}

interface OutlineEntry {
  outline: SlideOutline;
  stale: boolean;
}

function NewSetButton({ roomId }: { roomId: string }) {
  return <Button label="New study set" size="compact" onPress={() => router.push(`/study/pick?roomId=${roomId}`)} />;
}

export function StudyLibraryScreen() {
  const { roomId } = useLocalSearchParams<{ roomId?: string }>();
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const theme = useStoneTheme();
  const column = useColumn();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const [decks, setDecks] = useState<DeckEntry[]>([]);
  const [quizzes, setQuizzes] = useState<QuizEntry[]>([]);
  const [outlines, setOutlines] = useState<OutlineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedId = roomId && rooms.some((r) => r.id === roomId) ? roomId : rooms[0]?.id;

  const load = useCallback(async () => {
    const allRooms = await listRooms(db);
    const target = (roomId && allRooms.some((r) => r.id === roomId) ? roomId : allRooms[0]?.id) ?? null;
    if (!target) {
      setRooms(allRooms);
      setRoom(null);
      setDecks([]);
      setQuizzes([]);
      setOutlines([]);
      return;
    }
    const [nextRoom, notes, rawDecks, rawQuizzes, rawOutlines] = await Promise.all([
      getRoom(db, target),
      listChunks(db, target),
      listStudyDecks(db, target),
      listStudyQuizzes(db, target),
      listSlideOutlines(db, target),
    ]);
    const revisions = revisionMap(notes);
    const deckEntries = await Promise.all(rawDecks.map(async (deck) => ({
      deck,
      cards: (await listStudyCards(db, deck.id)).length,
      stale: isStudyStale(deck.sourceChunkIds, deck.sourceRevision, revisions),
    })));
    const quizEntries = await Promise.all(rawQuizzes.map(async (quiz) => ({
      quiz,
      questions: (await listStudyQuestions(db, quiz.id)).length,
      attempts: (await listStudyAttempts(db, quiz.id)).length,
      stale: isStudyStale(quiz.sourceChunkIds, quiz.sourceRevision, revisions),
    })));
    setRooms(allRooms);
    setRoom(nextRoom);
    setDecks(deckEntries);
    setQuizzes(quizEntries);
    setOutlines(rawOutlines.map((outline) => ({
      outline,
      stale: isStudyStale(outline.sourceChunkIds, outline.sourceRevision, revisions),
    })));
  }, [db, roomId]);

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    load()
      .then(() => { if (active) setLoading(false); })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'Could not load the library');
        setLoading(false);
      });
    return () => { active = false; };
  }, [load]));

  const anyStale = decks.some((d) => d.stale) || quizzes.some((q) => q.stale) || outlines.some((o) => o.stale);

  if (loading) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1 }}>
          <ActivityIndicator testID="study-library-loading" color={theme.color.accent.bg} style={{ marginTop: 40 }} />
        </SafeAreaView>
      </Screen>
    );
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} testID="study-library">
        <ScrollView contentContainerStyle={[column, { paddingTop: theme.space.md, paddingBottom: 48, gap: theme.space.base }]}>
          <BackButton label="← rooms" accessibilityLabel="All rooms" onPress={() => router.replace('/')} />
          <ScreenHeader
            kicker="study"
            title="Library"
            action={selectedId ? <NewSetButton roomId={selectedId} /> : undefined}
          >
            <Text style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>
              Saved decks, quizzes and slide outlines — one room at a time.
            </Text>
          </ScreenHeader>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {rooms.length === 0 ? (
            <EmptyState
              title="No rooms yet"
              body="Create a room and add notes first — study sets grow out of room notes."
              testID="study-library-no-rooms"
            >
              <Button label="Back to rooms" size="compact" onPress={() => router.replace('/')} />
            </EmptyState>
          ) : (
            <View style={{ gap: theme.space.base }}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                accessibilityRole="tablist"
                accessibilityLabel="Rooms"
                contentContainerStyle={{ gap: theme.space.sm }}
                style={{ flexGrow: 0 }}
              >
                {rooms.map((candidate) => {
                  const on = candidate.id === selectedId;
                  return (
                    <Pressable
                      key={candidate.id}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`Study library for ${candidate.name}`}
                      testID={`study-room-${candidate.id}`}
                      onPress={() => router.replace(`/study?roomId=${candidate.id}`)}
                      style={{
                        minHeight: theme.layout.control,
                        paddingHorizontal: theme.space.xl,
                        borderRadius: theme.radius.pill,
                        borderWidth: 1,
                        justifyContent: 'center',
                        borderColor: on ? theme.color.accent.bg : theme.color.border.hairline,
                        backgroundColor: on ? theme.color.accent.bg : theme.color.bg.surface,
                      }}
                    >
                      <Text style={[theme.text('buttonCompact'), { color: on ? theme.color.accent.fg : theme.color.text.secondary }]}>
                        {candidate.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {room && (decks.length + quizzes.length + outlines.length > 0) && anyStale ? (
                <Notice tone="warning" testID="study-stale-legend">
                  Stale means a source note changed after the set was saved. The set is kept as-is.
                </Notice>
              ) : null}
              <View style={{ gap: theme.space.xs }}>
                <SectionTitle aside={<Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>{decks.length}</Text>}>
                  Decks
                </SectionTitle>
                {decks.length === 0 ? (
                  <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>
                    No flashcard decks in {room?.name ?? 'this room'} yet.
                  </Text>
                ) : decks.map(({ deck, cards, stale }) => (
                  <View
                    key={deck.id}
                    testID={`study-deck-${deck.id}`}
                    style={{
                      backgroundColor: theme.color.bg.surface, borderRadius: theme.radius.float,
                      borderWidth: 1, borderColor: theme.color.border.hairline, ...theme.shadow.card,
                    }}
                  >
                    <Row
                      title={deck.title}
                      subtitle={`${cards} ${cards === 1 ? 'card' : 'cards'} · from ${deck.sourceChunkIds.length} ${deck.sourceChunkIds.length === 1 ? 'chunk' : 'chunks'}`}
                      trailing={stale ? <View testID={`study-stale-${deck.id}`}><Badge tone="warning" label="stale" /></View> : undefined}
                      chevron={false}
                    />
                  </View>
                ))}
              </View>
              <View style={{ gap: theme.space.xs }}>
                <SectionTitle aside={<Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>{quizzes.length}</Text>}>
                  Quizzes
                </SectionTitle>
                {quizzes.length === 0 ? (
                  <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>
                    No quizzes in {room?.name ?? 'this room'} yet.
                  </Text>
                ) : quizzes.map(({ quiz, questions, attempts, stale }) => (
                  <View
                    key={quiz.id}
                    testID={`study-quiz-${quiz.id}`}
                    style={{
                      backgroundColor: theme.color.bg.surface, borderRadius: theme.radius.float,
                      borderWidth: 1, borderColor: theme.color.border.hairline, ...theme.shadow.card,
                    }}
                  >
                    <Row
                      title={quiz.title}
                      subtitle={`${questions} ${questions === 1 ? 'question' : 'questions'} · ${attempts} ${attempts === 1 ? 'attempt' : 'attempts'} · from ${quiz.sourceChunkIds.length} ${quiz.sourceChunkIds.length === 1 ? 'chunk' : 'chunks'}`}
                      trailing={stale ? <View testID={`study-stale-${quiz.id}`}><Badge tone="warning" label="stale" /></View> : undefined}
                      chevron={false}
                    />
                  </View>
                ))}
              </View>
              <View style={{ gap: theme.space.xs }}>
                <SectionTitle aside={<Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>{outlines.length}</Text>}>
                  Slide outlines
                </SectionTitle>
                {outlines.length === 0 ? (
                  <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>
                    No slide outlines in {room?.name ?? 'this room'} yet.
                  </Text>
                ) : outlines.map(({ outline, stale }) => (
                  <View
                    key={outline.id}
                    testID={`study-outline-${outline.id}`}
                    style={{
                      backgroundColor: theme.color.bg.surface, borderRadius: theme.radius.float,
                      borderWidth: 1, borderColor: theme.color.border.hairline, ...theme.shadow.card,
                    }}
                  >
                    <Row
                      title={outline.title}
                      subtitle={`${outline.slides.length} ${outline.slides.length === 1 ? 'slide' : 'slides'} · from ${outline.sourceChunkIds.length} ${outline.sourceChunkIds.length === 1 ? 'chunk' : 'chunks'}`}
                      trailing={stale ? <View testID={`study-stale-${outline.id}`}><Badge tone="warning" label="stale" /></View> : undefined}
                      chevron={false}
                    />
                  </View>
                ))}
              </View>
              {room && decks.length + quizzes.length + outlines.length === 0 ? (
                <EmptyState
                  title={`No study sets in ${room.name} yet`}
                  body="Pick source notes and review every item before saving."
                  testID="study-library-empty"
                >
                  <NewSetButton roomId={room.id} />
                </EmptyState>
              ) : null}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

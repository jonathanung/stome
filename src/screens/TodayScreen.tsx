import { randomUUID } from 'expo-crypto';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Screen, useStoneTheme } from '../../design-theme/src/primitives';
import { createCommit } from '../data/commit';
import { isDueAnswer, type DueItem } from '../data/models';
import { listDueAnswers, listDueChunks, listRooms } from '../data/queries';
import { planDueItems } from '../data/today';
import { expoDriver } from '../db/expo-driver';
import { MarkButtons } from '../features/review/MarkButtons';
import { reviewMarkController } from '../features/review/mark-attempt';
import { reviewHref } from '../features/review/session';
import { TodaySummary } from './TodaySummary';
import { StatusMark } from '../ui/StatusMark';
import { EmptyState, Notice, RoundAction, Row, ScreenHeader, useColumn } from '../ui/kit';

const STATE_LABEL = {
  missed: 'missed',
  unclear: 'unclear',
  got_it: 'got it',
} as const;

const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);

/** When the mark was made: "today 9:40", "yesterday", or a short weekday. */
export function markedLabel(markedAt: number, now = Date.now()): string {
  const days = Math.round((dayStart(now) - dayStart(markedAt)) / 86_400_000);
  if (days <= 0) {
    return `today ${new Date(markedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: false })}`;
  }
  if (days === 1) return 'yesterday';
  if (days < 7) return new Date(markedAt).toLocaleDateString(undefined, { weekday: 'short' }).toLowerCase();
  return new Date(markedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toLowerCase();
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).toLowerCase();
}

function dueLabel(dueAt: number): string {
  if (dayStart(dueAt) < dayStart(Date.now())) return 'earlier';
  return `today ${new Date(dueAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: false })}`;
}

function itemKey(item: DueItem): string {
  return isDueAnswer(item) ? item.annotation.id : item.chunk.id;
}

function answerText(item: Extract<DueItem, { annotation: unknown }>): string {
  const payload = item.annotation.payload as { answer?: unknown };
  return typeof payload.answer === 'string' && payload.answer.trim() ? payload.answer : item.chunk.body;
}

export function TodayScreen() {
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const commit = useMemo(() => createCommit(db, { now: Date.now, newId: randomUUID }), [db]);
  const theme = useStoneTheme();
  const column = useColumn();
  const [items, setItems] = useState<DueItem[]>([]);
  const [roomNames, setRoomNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const now = Date.now();
    const [chunks, answers] = await Promise.all([listDueChunks(db, now), listDueAnswers(db, now)]);
    setItems(planDueItems([...chunks, ...answers]));
    setRoomNames(Object.fromEntries((await listRooms(db)).map((room) => [room.id, room.name])));
  }, [db]);

  useFocusEffect(useCallback(() => {
    let active = true;
    let ticket = 0;
    const load = () => {
      const mine = ++ticket;
      const now = Date.now();
      return Promise.all([listDueChunks(db, now), listDueAnswers(db, now), listRooms(db)])
        .then(([chunks, answers, rooms]) => {
          if (!active || mine !== ticket) return;
          setItems(planDueItems([...chunks, ...answers]));
          setRoomNames(Object.fromEntries(rooms.map((room) => [room.id, room.name])));
          setLoading(false);
        })
        .catch((reason: unknown) => {
          if (!active || mine !== ticket) return;
          setError(reason instanceof Error ? reason.message : 'Could not read today’s list');
          setLoading(false);
        });
    };
    void load();
    const unsubscribe = reviewMarkController.subscribe(() => {
      void load();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [db]));

  const groups = useMemo(() => {
    const byRoom = new Map<string, DueItem[]>();
    for (const item of items) byRoom.set(item.chunk.roomId, [...(byRoom.get(item.chunk.roomId) ?? []), item]);
    return [...byRoom].map(([roomId, list]) => ({ roomId, items: list }));
  }, [items]);

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 120 }}>
        <View style={[column, { gap: theme.space.section }]} testID="today-screen">
          <ScreenHeader
            kicker={todayLabel()}
            title="today"
            action={<RoundAction
              icon="refresh"
              label="Refresh"
              variant="quiet"
              testID="today-refresh"
              onPress={() => {
                void refresh().catch((reason: unknown) => {
                  setError(reason instanceof Error ? reason.message : 'Could not refresh today’s list');
                });
              }}
            />}
          />
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {loading ? <ActivityIndicator color={theme.color.accent.bg} /> : null}
          {!loading && items.length === 0 ? (
            <EmptyState testID="today-empty" title="Nothing due today" body="Notes you mark in a review come back here when they are due.">
              <Button label="Open a room" size="compact" onPress={() => router.navigate('/')} />
              <Button label="Capture a note" size="compact" variant="outline" onPress={() => router.navigate('/notes')} />
            </EmptyState>
          ) : null}
          {items.length ? <TodaySummary items={items} /> : null}
          {groups.length ? (
            <View
              testID="today-list"
              style={{
                backgroundColor: theme.color.bg.surface,
                borderRadius: theme.radius.float,
                borderWidth: 1,
                borderColor: theme.color.border.hairline,
                overflow: 'hidden',
                paddingHorizontal: theme.space.xs,
                ...theme.shadow.card,
              }}
            >
              {groups.map((group) => (
                <View key={group.roomId}>
                  <Text
                    accessibilityRole="header"
                    style={[theme.text('label'), {
                      color: theme.color.text.tertiary,
                      letterSpacing: 0.8,
                      textTransform: 'lowercase',
                      paddingHorizontal: theme.space.base,
                      paddingTop: theme.space.xl,
                      paddingBottom: theme.space.xxs,
                    }]}
                  >
                    {roomNames[group.roomId] ?? 'Room'}
                  </Text>
                  {group.items.map((item) => {
                    const key = itemKey(item);
                    if (isDueAnswer(item)) {
                      const title = answerText(item).split('\n')[0]?.slice(0, 80) || 'Saved answer';
                      const subtitle = item.mark === null
                        ? 'saved answer · due now'
                        : `saved answer · ${STATE_LABEL[item.mark.state]} ${markedLabel(item.mark.markedAt)} · due ${dueLabel(item.mark.dueAt)}`;
                      return (
                        <View key={key} style={{ paddingBottom: theme.space.lg }}>
                          <Row
                            title={title}
                            subtitle={subtitle}
                            leading={item.mark ? <StatusMark state={item.mark.state} /> : <FreshDot />}
                            accessibilityLabel={`Review saved answer ${title}`}
                            onPress={() => router.push(reviewHref(item.chunk.roomId, item.chunk.id))}
                            testID={`today-item-${key}`}
                          />
                          <View style={{ paddingHorizontal: theme.space.base, paddingTop: theme.space.sm }}>
                            <MarkButtons
                              chunkId={item.chunk.id}
                              annotationId={item.annotation.id}
                              expectedRevision={item.chunk.revision}
                              commit={commit}
                              testID={`today-mark-${key}`}
                            />
                          </View>
                        </View>
                      );
                    }
                    const title = item.chunk.body.split('\n')[0]?.slice(0, 80) || 'Empty chunk';
                    return (
                      <View key={key} style={{ paddingBottom: theme.space.lg }}>
                        <Row
                          title={title}
                          subtitle={`${STATE_LABEL[item.mark.state]} ${markedLabel(item.mark.markedAt)} · due ${dueLabel(item.mark.dueAt)}`}
                          leading={<StatusMark state={item.mark.state} />}
                          accessibilityLabel={`Review ${title}`}
                          onPress={() => router.push(reviewHref(item.chunk.roomId, item.chunk.id))}
                          testID={`today-item-${key}`}
                        />
                        <View style={{ paddingHorizontal: theme.space.base, paddingTop: theme.space.sm }}>
                          <MarkButtons
                            chunkId={item.chunk.id}
                            expectedRevision={item.chunk.revision}
                            commit={commit}
                            testID={`today-mark-${key}`}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          ) : null}
          {items.length ? (
            <Button
              label={`review all ${items.length}`}
              onPress={() => router.push(reviewHref(items[0].chunk.roomId, items[0].chunk.id))}
            />
          ) : null}
        </View>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

/** Neutral day tile for a pinned answer with no mark yet. */
function FreshDot() {
  const theme = useStoneTheme();
  const size = 28;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: (size / 8) * 2,
        backgroundColor: theme.color.bg.inset,
        borderWidth: 1,
        borderColor: theme.color.border.strong,
      }}
    />
  );
}

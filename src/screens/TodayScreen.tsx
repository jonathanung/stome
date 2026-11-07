import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Screen, useStoneTheme } from '../../design-theme/src/primitives';
import type { DueChunk } from '../data/models';
import { listDueChunks, listRooms } from '../data/queries';
import { planToday } from '../data/today';
import { expoDriver } from '../db/expo-driver';
import { reviewMarkController } from '../features/review/mark-attempt';
import { reviewHref } from '../features/review/session';
import { TodaySummary } from './TodaySummary';
import { StatusMark } from '../ui/StatusMark';
import { BackButton, EmptyState, Group, Notice, RoundAction, Row, ScreenHeader, useColumn } from '../ui/kit';

const STATE_LABEL = {
  missed: 'Missed',
  unclear: 'Unclear',
  got_it: 'Got it',
} as const;

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function dueLabel(dueAt: number): string {
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  if (day(dueAt) < day(Date.now())) return 'earlier';
  return 'today';
}

export function TodayScreen() {
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const theme = useStoneTheme();
  const column = useColumn();
  const [items, setItems] = useState<DueChunk[]>([]);
  const [roomNames, setRoomNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const due = await listDueChunks(db, Date.now());
    setItems(planToday(due));
    setRoomNames(Object.fromEntries((await listRooms(db)).map((room) => [room.id, room.name])));
  }, [db]);

  useFocusEffect(useCallback(() => {
    let active = true;
    let ticket = 0;
    const load = () => {
      const mine = ++ticket;
      return Promise.all([listDueChunks(db, Date.now()), listRooms(db)])
        .then(([due, rooms]) => {
          if (!active || mine !== ticket) return;
          setItems(planToday(due));
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
    const byRoom = new Map<string, DueChunk[]>();
    for (const item of items) byRoom.set(item.chunk.roomId, [...(byRoom.get(item.chunk.roomId) ?? []), item]);
    return [...byRoom].map(([roomId, list]) => ({ roomId, items: list }));
  }, [items]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 120 }}>
        <View style={[column, { gap: theme.space.section }]} testID="today-screen">
          <ScreenHeader
            back={<BackButton label="Rooms" onPress={back} />}
            kicker={todayLabel()}
            title="Today"
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
          {groups.map((group) => (
            <View key={group.roomId} style={{ gap: theme.space.xs }}>
              <Text style={[theme.text('label'), { color: theme.color.text.tertiary, letterSpacing: 0.8, textTransform: 'lowercase' }]}>
                {roomNames[group.roomId] ?? 'Room'}
              </Text>
              <Group>
                {group.items.map((item) => {
                  const title = item.chunk.body.split('\n')[0]?.slice(0, 80) || 'Empty chunk';
                  return (
                    <Row
                      key={item.chunk.id}
                      title={title}
                      subtitle={`${STATE_LABEL[item.mark.state]} · due ${dueLabel(item.mark.dueAt)}`}
                      leading={<StatusMark state={item.mark.state} />}
                      accessibilityLabel={`Review ${title}`}
                      onPress={() => router.push(reviewHref(item.chunk.roomId, item.chunk.id))}
                      testID={`today-item-${item.chunk.id}`}
                    />
                  );
                })}
              </Group>
            </View>
          ))}
          {items.length ? (
            <Button
              label={`Review all ${items.length}`}
              onPress={() => router.push(reviewHref(items[0].chunk.roomId, items[0].chunk.id))}
            />
          ) : null}
        </View>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

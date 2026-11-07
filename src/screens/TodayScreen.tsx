import { Link, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Screen, useStoneTheme } from '../../design-theme/src/primitives';
import type { DueChunk } from '../data/models';
import { listDueChunks } from '../data/queries';
import { planToday } from '../data/today';
import { expoDriver } from '../db/expo-driver';

const STATE_LABEL = {
  missed: 'Missed',
  unclear: 'Unclear',
  got_it: 'Got it',
} as const;

export function TodayScreen() {
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const theme = useStoneTheme();
  const [items, setItems] = useState<DueChunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const due = await listDueChunks(db, Date.now());
    setItems(planToday(due));
  }, [db]);

  useFocusEffect(useCallback(() => {
    let active = true;
    listDueChunks(db, Date.now())
      .then((due) => {
        if (active) {
          setItems(planToday(due));
          setLoading(false);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'Could not read today’s list');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [db]));

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 32 }}>
        <View style={{ width: '100%', maxWidth: 760, alignSelf: 'center', padding: 20, gap: 16 }} testID="today-screen">
          <Text accessibilityRole="header" style={{ color: theme.color.text.primary, fontSize: 32, fontWeight: '700' }}>Today</Text>
          <Text style={{ color: theme.color.text.secondary }}>Due notes from this device. The list is built when you open it.</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh"
            onPress={() => {
              void refresh().catch((reason: unknown) => {
                setError(reason instanceof Error ? reason.message : 'Could not refresh today’s list');
              });
            }}
            style={{ alignSelf: 'flex-start', borderColor: theme.color.border.strong, borderRadius: theme.radius.control, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 }}
            testID="today-refresh"
          >
            <Text style={{ color: theme.color.text.primary, fontSize: 16 }}>Refresh</Text>
          </Pressable>
          {error ? <Text accessibilityRole="alert" style={{ color: theme.color.status.danger.text }}>{error}</Text> : null}
          {loading ? <ActivityIndicator /> : null}
          {!loading && items.length === 0 ? (
            <View testID="today-empty" style={{ gap: 8 }}>
              <Text style={{ color: theme.color.text.primary, fontSize: 18 }}>Nothing due today</Text>
              <Link href="/" style={{ color: theme.color.text.primary, textDecorationLine: 'underline' }}>Open a room</Link>
              <Link href="/notes" style={{ color: theme.color.text.primary, textDecorationLine: 'underline' }}>Capture a note</Link>
            </View>
          ) : null}
          {items.map((item) => {
            const title = item.chunk.body.split('\n')[0]?.slice(0, 80) || 'Empty chunk';
            return (
              <View
                key={item.chunk.id}
                style={{ backgroundColor: theme.color.bg.surface, borderColor: theme.color.border.hairline, borderRadius: theme.radius.card, borderWidth: 1, gap: 6, padding: 16 }}
                testID={`today-item-${item.chunk.id}`}
              >
                <Text style={{ color: theme.color.text.secondary }}>{STATE_LABEL[item.mark.state]}</Text>
                <Text style={{ color: theme.color.text.primary, fontSize: 18 }}>{title}</Text>
              </View>
            );
          })}
        </View>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

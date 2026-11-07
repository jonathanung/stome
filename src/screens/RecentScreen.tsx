import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Screen, useStoneTheme } from '../../design-theme/src/primitives';
import type { RecentChunk } from '../data/models';
import { listRecentChunks } from '../data/queries';
import { expoDriver } from '../db/expo-driver';
import { BackButton, EmptyState, Notice, ScreenHeader, useColumn } from '../ui/kit';

const RECENT_LIMIT = 30;

/** "2h ago" style label; falls back to the date after a week. */
function ago(timestamp: number, now = Date.now()): string {
  const minutes = Math.round((now - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString();
}

/** The most recently edited chunks across every room, newest first (#39). */
export function RecentScreen() {
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const theme = useStoneTheme();
  const column = useColumn();
  const [chunks, setChunks] = useState<RecentChunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      listRecentChunks(db, RECENT_LIMIT)
        .then((rows) => {
          if (active) {
            setChunks(rows);
            setLoading(false);
          }
        })
        .catch((reason: unknown) => {
          if (active) {
            setError(reason instanceof Error ? reason.message : 'Could not load recent notes');
            setLoading(false);
          }
        });
      return () => {
        active = false;
      };
    }, [db]),
  );

  const last = chunks.length - 1;
  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <FlatList
          data={chunks}
          keyExtractor={(chunk) => chunk.id}
          contentContainerStyle={[column, { paddingBottom: 120 }]}
          ListHeaderComponent={
            <View style={{ gap: theme.space.base, marginBottom: theme.space.section }}>
              <ScreenHeader back={<BackButton label="Rooms" accessibilityLabel="All rooms" onPress={() => router.replace('/')} />} title="Recent notes">
                <Text style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>
                  The chunks you edited most recently, across all rooms.
                </Text>
              </ScreenHeader>
              {loading ? <ActivityIndicator color={theme.color.accent.bg} /> : null}
              {error ? <Notice tone="danger">{error}</Notice> : null}
            </View>
          }
          ListEmptyComponent={loading ? undefined : <EmptyState title="Nothing edited yet" body="Notes you write show up here, newest first." />}
          renderItem={({ item, index }) => (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Open ${item.roomName}: ${item.body.slice(0, 60)}`}
              onPress={() => router.push(`/rooms/${item.roomId}`)}
              style={({ pressed }) => ({
                backgroundColor: pressed ? theme.color.bg.alt : theme.color.bg.surface,
                borderColor: theme.color.border.hairline,
                borderLeftWidth: 1,
                borderRightWidth: 1,
                borderTopWidth: 1,
                borderBottomWidth: index === last ? 1 : 0,
                borderTopLeftRadius: index === 0 ? theme.radius.float : 0,
                borderTopRightRadius: index === 0 ? theme.radius.float : 0,
                borderBottomLeftRadius: index === last ? theme.radius.float : 0,
                borderBottomRightRadius: index === last ? theme.radius.float : 0,
                paddingHorizontal: theme.space.base,
                paddingVertical: theme.space.xxl,
                gap: theme.space.sm,
                minHeight: theme.layout.control,
              })}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space.xl }}>
                <Text numberOfLines={1} style={[theme.text('label'), { flex: 1, color: theme.color.text.secondary }]}>{item.roomName}</Text>
                <Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>{ago(item.updatedAt)}</Text>
              </View>
              <Text numberOfLines={3} style={[theme.text('bodySmall'), { color: theme.color.text.primary }]}>
                {item.body.trim() ? item.body.slice(0, 280) : 'Empty chunk'}
              </Text>
              {item.subjects.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
                  {item.subjects.map((subject) => (
                    <Text key={subject} style={[theme.text('label'), { color: theme.color.text.secondary, backgroundColor: theme.color.bg.inset, borderRadius: theme.radius.pill, paddingHorizontal: theme.space.lg, paddingVertical: 2, overflow: 'hidden' }]}>
                      {subject}
                    </Text>
                  ))}
                </View>
              ) : null}
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Screen>
  );
}

import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Screen, StoneText, useStoneTheme } from '../../design-theme/src/primitives';
import type { RecentChunk } from '../data/models';
import { listRecentChunks } from '../data/queries';
import { expoDriver } from '../db/expo-driver';

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

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <FlatList
          data={chunks}
          keyExtractor={(chunk) => chunk.id}
          contentContainerStyle={{ width: '100%', maxWidth: theme.layout.paperMax, alignSelf: 'center', padding: theme.space.card, gap: theme.space.xl }}
          ListHeaderComponent={
            <View style={{ gap: theme.space.md, marginBottom: theme.space.md }}>
              <Pressable accessibilityRole="button" hitSlop={12} onPress={() => router.replace('/')} style={{ alignSelf: 'flex-start' }}>
                <Text style={{ color: theme.color.text.secondary }}>← All rooms</Text>
              </Pressable>
              <View accessibilityRole="header">
                <StoneText role="screenTitle">Recent notes</StoneText>
              </View>
              <StoneText role="bodySmall" tone="secondary">
                The chunks you edited most recently, across all rooms.
              </StoneText>
              {loading ? <ActivityIndicator color={theme.color.accent.bg} /> : null}
              {error ? (
                <Text accessibilityRole="alert" style={{ color: theme.color.status.danger.text }}>
                  {error}
                </Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={loading ? undefined : <StoneText tone="secondary">Nothing edited yet. Notes you write show up here.</StoneText>}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Open ${item.roomName}: ${item.body.slice(0, 60)}`}
              onPress={() => router.push(`/rooms/${item.roomId}`)}
              style={({ pressed }) => ({
                backgroundColor: theme.color.bg.surface,
                borderColor: theme.color.border.hairline,
                borderWidth: 1,
                borderRadius: theme.radius.card,
                padding: theme.space.base,
                gap: theme.space.xs,
                minHeight: theme.layout.control,
                opacity: pressed ? 0.7 : 1,
              })}>
              <StoneText role="bodySmall">{item.body.trim() ? item.body.slice(0, 280) : 'Empty chunk'}</StoneText>
              <StoneText role="label" tone="tertiary">
                {`${item.roomName} · ${ago(item.updatedAt)}${item.subjects.length ? ` · ${item.subjects.join(', ')}` : ''}`}
              </StoneText>
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Screen>
  );
}

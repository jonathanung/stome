import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Screen, useStoneTheme } from '../../design-theme/src/primitives';
import type { RecentChunk } from '../data/models';
import { listRecentChunks } from '../data/queries';
import { searchNotes, type SearchHit, type SearchKind } from '../data/search';
import { expoDriver } from '../db/expo-driver';
import { Icon } from '../ui/Icon';
import { BackButton, EmptyState, Field, Notice, ScreenHeader, useColumn } from '../ui/kit';
import { Eyebrow, FilterChip, RecentRow, SearchResult, groupByRecency } from './RecentSearchParts';

const RECENT_LIMIT = 30;
const WIDE = 1000;
const KINDS: { label: string; kinds: SearchKind[] }[] = [
  { label: 'Everything', kinds: [] },
  { label: 'Chunks', kinds: ['chunk'] },
  { label: 'Highlights', kinds: ['highlight'] },
  { label: 'AI answers', kinds: ['ai_answer'] },
];

/** Search across rooms plus the most recently edited chunks, newest first (#39, #10). */
export function RecentScreen() {
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const theme = useStoneTheme();
  const column = useColumn();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const [chunks, setChunks] = useState<RecentChunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [kindIndex, setKindIndex] = useState(0);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

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

  const trimmed = query.trim();
  const shownHits = trimmed ? hits : [];
  useEffect(() => {
    if (!trimmed) return;
    let active = true;
    const timer = setTimeout(() => {
      setSearching(true);
      searchNotes(db, trimmed, { kinds: KINDS[kindIndex].kinds, roomId })
        .then((rows) => active && setHits(rows))
        .catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : 'Search failed'))
        .finally(() => active && setSearching(false));
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [db, trimmed, kindIndex, roomId]);

  const rooms = useMemo(() => {
    const seen = new Map<string, string>();
    for (const chunk of chunks) seen.set(chunk.roomId, chunk.roomName);
    return [...seen];
  }, [chunks]);
  const roomName = rooms.find(([id]) => id === roomId)?.[1];
  const cycleRoom = () => {
    const at = rooms.findIndex(([id]) => id === roomId);
    setRoomId(at + 1 < rooms.length ? rooms[at + 1][0] : null);
  };

  const groups = useMemo(() => {
    const order: string[] = [];
    const byRoom = new Map<string, SearchHit[]>();
    for (const hit of shownHits) {
      if (!byRoom.has(hit.roomName)) order.push(hit.roomName);
      byRoom.set(hit.roomName, [...(byRoom.get(hit.roomName) ?? []), hit]);
    }
    return order.map((name) => ({ name, items: byRoom.get(name) ?? [] }));
  }, [shownHits]);

  const open = (id: string) => router.push(`/rooms/${id}`);
  const recent = (
    <View style={{ gap: theme.space.xs, padding: theme.space.card, borderRadius: theme.radius.card, borderWidth: 1, borderColor: theme.color.border.hairline, backgroundColor: theme.color.bg.surface }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={[theme.text('title'), { color: theme.color.text.primary }]}>Recent notes</Text>
        <Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>This device</Text>
      </View>
      {loading ? <ActivityIndicator color={theme.color.accent.bg} /> : null}
      {!loading && !chunks.length ? <EmptyState title="Nothing edited yet" body="Notes you write show up here, newest first." /> : null}
      {groupByRecency(chunks).map((group) => (
        <View key={group.label}>
          <Eyebrow top={theme.space.xxl}>{group.label}</Eyebrow>
          {group.items.map((chunk, i) => (
            <RecentRow key={chunk.id} chunk={chunk} last={i === group.items.length - 1} onPress={() => open(chunk.roomId)} />
          ))}
        </View>
      ))}
    </View>
  );

  const results = trimmed ? (
    <View style={{ gap: theme.space.xl }}>
      {searching && !shownHits.length ? <ActivityIndicator color={theme.color.accent.bg} /> : null}
      {!searching && !shownHits.length ? <EmptyState title="No matches" body="Try a different word, or widen the filters." /> : null}
      {groups.map((group, i) => (
        <View key={group.name} style={{ gap: theme.space.xl }}>
          <Eyebrow top={i ? theme.space.md : 0}>{`${group.name} · ${group.items.length}`}</Eyebrow>
          {group.items.map((hit) => (
            <SearchResult key={hit.key} hit={hit} query={trimmed} onPress={() => open(hit.roomId)} />
          ))}
        </View>
      ))}
    </View>
  ) : null;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={[column, { paddingBottom: 120, gap: theme.space.card }, wide ? { maxWidth: 1180 } : null]} keyboardShouldPersistTaps="handled">
          <ScreenHeader back={<BackButton label="Rooms" accessibilityLabel="All rooms" onPress={() => router.replace('/')} />} title="Find a note" />
          <View
            accessibilityRole="search"
            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xl, paddingLeft: 18, paddingRight: theme.space.md, minHeight: 56, borderRadius: 18, borderWidth: 1.5, borderColor: theme.color.text.primary, backgroundColor: theme.color.bg.surface }}>
            <Icon name="search" size={20} color={theme.color.text.secondary} />
            <Field
              value={query}
              onChangeText={setQuery}
              placeholder="Search notes, highlights and answers"
              accessibilityLabel="Search notes, highlights and answers"
              returnKeyType="search"
              autoCorrect={false}
              style={{ flex: 1, backgroundColor: 'transparent', borderColor: 'transparent' }}
            />
            {trimmed && !searching ? <Text style={[theme.text('label'), { color: theme.color.text.tertiary, paddingRight: theme.space.md }]}>{shownHits.length === 1 ? '1 result' : `${shownHits.length} results`}</Text> : null}
          </View>
          <View accessibilityRole="toolbar" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md }}>
            {KINDS.map((kind, i) => (
              <FilterChip key={kind.label} label={kind.label} on={i === kindIndex} onPress={() => setKindIndex(i)} />
            ))}
            <FilterChip label={roomName ? `${roomName} ▾` : 'All rooms ▾'} on={!!roomId} onPress={cycleRoom} />
          </View>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {wide && results ? (
            <View style={{ flexDirection: 'row', gap: theme.space.section, alignItems: 'flex-start' }}>
              <View style={{ flex: 1.5 }}>{results}</View>
              <View style={{ flex: 1 }}>{recent}</View>
            </View>
          ) : (
            <>
              {results}
              {recent}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

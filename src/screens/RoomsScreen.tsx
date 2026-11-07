import { randomUUID } from 'expo-crypto';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform,
  Pressable, Text, View,
} from 'react-native';

import { Button, Screen, TrilithonMark, useStoneTheme } from '../../design-theme/src/primitives';
import { createCommit } from '../data/commit';
import type { Room } from '../data/models';
import { listRooms } from '../data/queries';
import { expoDriver } from '../db/expo-driver';
import { Icon, type IconName } from '../ui/Icon';
import { StageGlyph, stageName } from '../ui/StageGlyph';
import { EmptyState, Field, Group, Notice, Row, SectionTitle, useColumn } from '../ui/kit';

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong. Try again.';
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function Shortcut({ icon, title, subtitle, onPress, testID }: {
  icon: IconName; title: string; subtitle: string; onPress: () => void; testID?: string;
}) {
  const theme = useStoneTheme();
  return (
    <Row
      title={title}
      subtitle={subtitle}
      onPress={onPress}
      accessibilityRole="link"
      testID={testID}
      leading={
        <View style={{ width: 40, height: 40, borderRadius: theme.radius.control, backgroundColor: theme.color.bg.inset, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={20} color={theme.color.text.primary} />
        </View>
      }
    />
  );
}

export function RoomsScreen() {
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const commit = useMemo(() => createCommit(db, { now: Date.now, newId: randomUUID }), [db]);
  const theme = useStoneTheme();
  const column = useColumn();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState('');
  const [managingId, setManagingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => setRooms(await listRooms(db)), [db]);
  useFocusEffect(useCallback(() => {
    let active = true;
    listRooms(db).then((rows) => {
      if (active) { setRooms(rows); setLoading(false); }
    }).catch((reason: unknown) => {
      if (active) { setError(message(reason)); setLoading(false); }
    });
    return () => { active = false; };
  }, [db]));

  async function action(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await run(); await refresh(); }
    catch (reason) { setError(message(reason)); await refresh().catch(() => undefined); }
    finally { setBusy(false); }
  }

  async function create() {
    const result = await commit({
      opId: randomUUID(), kind: 'room.create', source: 'human', confirmed: false,
      payload: { name },
    });
    if (!result.ok) throw new Error(result.error.message);
    setName('');
    router.push(`/rooms/${result.value.roomId}`);
  }

  function closeManage() {
    setManagingId(null);
    setEditingId(null);
    setDeletingId(null);
  }

  const header = <View style={{ gap: theme.space.section, paddingTop: theme.space.base, marginBottom: theme.space.base }}>
    <View style={{ gap: theme.space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
        <TrilithonMark width={22} height={15} />
        <Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>{todayLabel()}</Text>
      </View>
      <Text accessibilityRole="header" style={[theme.text('screenTitle'), { color: theme.color.text.primary }]}>Study rooms</Text>
      <Text style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>Your rooms and notes stay on this device.</Text>
    </View>

    <Group>
      <Shortcut icon="today" title="Today" subtitle="Notes due for review" onPress={() => router.push('/today')} testID="open-today" />
      <Shortcut icon="clock" title="Recent notes" subtitle="What you edited last, across rooms" onPress={() => router.push('/recent')} />
      <Shortcut icon="upload" title="Import Markdown" subtitle="Bring notes in from .md files" onPress={() => router.push('/import')} />
    </Group>

    <View style={{ gap: theme.space.xl }}>
      <SectionTitle>Your rooms</SectionTitle>
      <View style={{ flexDirection: 'row', gap: theme.space.md, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Field accessibilityLabel="New room name" placeholder="New room name"
            value={name} onChangeText={setName} returnKeyType="done"
            onSubmitEditing={() => { if (name.trim() && !busy) void action(create); }} />
        </View>
        <Button label="Create" disabled={!name.trim() || busy} onPress={() => void action(create)} />
      </View>
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </View>
  </View>;

  return <Screen><SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <FlatList
        data={rooms}
        keyExtractor={(room) => room.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[column, { paddingBottom: 120 }]}
        ListHeaderComponent={header}
        ListEmptyComponent={loading
          ? <ActivityIndicator color={theme.color.accent.bg} />
          : <EmptyState title="No rooms yet" body="Name a room above to start studying. Each room holds the notes for one subject." />}
        ListFooterComponent={<Pressable accessibilityRole="link" onPress={() => router.push('/notes')} hitSlop={8}
          style={({ pressed }) => ({ alignSelf: 'center', marginTop: theme.space.page, minHeight: theme.layout.control, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Text style={[theme.text('label'), { color: theme.color.text.tertiary, textDecorationLine: 'underline' }]}>Original notes and companion</Text>
        </Pressable>}
        renderItem={({ item, index }) => {
          const first = index === 0;
          const last = index === rooms.length - 1;
          const managing = managingId === item.id;
          return <View style={{
            backgroundColor: theme.color.bg.surface,
            borderColor: theme.color.border.hairline,
            borderLeftWidth: 1, borderRightWidth: 1, borderTopWidth: 1,
            borderBottomWidth: last ? 1 : 0,
            borderTopLeftRadius: first ? theme.radius.float : 0,
            borderTopRightRadius: first ? theme.radius.float : 0,
            borderBottomLeftRadius: last ? theme.radius.float : 0,
            borderBottomRightRadius: last ? theme.radius.float : 0,
            overflow: 'hidden',
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Row
                  title={item.name}
                  subtitle={stageName(item.stage)}
                  leading={<StageGlyph stage={item.stage} size={48} />}
                  accessibilityLabel={`Open ${item.name}`}
                  chevron={false}
                  onPress={() => router.push(`/rooms/${item.id}`)}
                />
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Manage ${item.name}`} accessibilityState={{ expanded: managing }}
                onPress={() => { if (managing) closeManage(); else { closeManage(); setManagingId(item.id); } }}
                style={({ pressed }) => ({ width: theme.layout.control, height: theme.layout.control, marginRight: theme.space.sm, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: managing || pressed ? theme.color.bg.inset : 'transparent' })}>
                <Icon name="more" size={22} strokeWidth={2.5} color={theme.color.text.secondary} />
              </Pressable>
            </View>
            {managing ? <View style={{ paddingHorizontal: theme.space.base, paddingBottom: theme.space.base, gap: theme.space.md }}>
              {editingId === item.id ? <>
                <Field accessibilityLabel="Rename room" value={editName} onChangeText={setEditName} autoFocus />
                <View style={{ flexDirection: 'row', gap: theme.space.md }}>
                  <Button label="Save" size="compact" disabled={!editName.trim() || busy} onPress={() => void action(async () => {
                    const result = await commit({ opId: randomUUID(), kind: 'room.rename', source: 'human', confirmed: false, expectedRevision: item.revision, payload: { roomId: item.id, name: editName } });
                    if (!result.ok) throw new Error(result.error.message);
                    closeManage();
                  })} />
                  <Button label="Cancel" size="compact" variant="ghost" onPress={() => setEditingId(null)} />
                </View>
              </> : deletingId === item.id ? <>
                <Notice tone="danger">Delete “{item.name}” and all its notes? This cannot be undone.</Notice>
                <View style={{ flexDirection: 'row', gap: theme.space.md }}>
                  <Button label="Delete room" size="compact" variant="danger" disabled={busy} onPress={() => void action(async () => {
                    const result = await commit({ opId: randomUUID(), kind: 'room.delete', source: 'human', confirmed: true, expectedRevision: item.revision, payload: { roomId: item.id } });
                    if (!result.ok) throw new Error(result.error.message);
                    closeManage();
                  })} />
                  <Button label="Cancel" size="compact" variant="ghost" onPress={() => setDeletingId(null)} />
                </View>
              </> : <View style={{ flexDirection: 'row', gap: theme.space.md }}>
                <Button label="Rename" size="compact" variant="outline" onPress={() => { setEditName(item.name); setEditingId(item.id); }} />
                <Button label="Delete" size="compact" variant="ghost" onPress={() => setDeletingId(item.id)} />
              </View>}
            </View> : null}
          </View>;
        }}
      />
    </KeyboardAvoidingView>
  </SafeAreaView></Screen>;
}

import { randomUUID } from 'expo-crypto';
import { Link, router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform,
  Pressable, Text, TextInput, View,
} from 'react-native';

import { Button, Screen, TrilithonMark, useStoneTheme } from '../../design-theme/src/primitives';
import { createCommit } from '../data/commit';
import type { Room } from '../data/models';
import { listRooms } from '../data/queries';
import { expoDriver } from '../db/expo-driver';

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong. Try again.';
}

export function RoomsScreen() {
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const commit = useMemo(() => createCommit(db, { now: Date.now, newId: randomUUID }), [db]);
  const theme = useStoneTheme();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState('');
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

  const fieldStyle = {
    borderColor: theme.color.border.strong, borderWidth: 1 as const,
    borderRadius: theme.radius.control, padding: 12,
    color: theme.color.text.primary, backgroundColor: theme.color.bg.surface,
    fontSize: 16, minWidth: 0 as const,
  };

  return <Screen><SafeAreaView style={{ flex: 1 }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <FlatList
        data={rooms}
        keyExtractor={(room) => room.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ width: '100%', maxWidth: 760, alignSelf: 'center', padding: 20, paddingBottom: 48, gap: 12 }}
        ListHeaderComponent={<View style={{ gap: 16, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <TrilithonMark width={40} height={28} />
            <Text accessibilityRole="header" style={{ color: theme.color.text.primary, fontSize: 32, fontWeight: '700' }}>Study rooms</Text>
          </View>
          <Text style={{ color: theme.color.text.secondary }}>Your rooms and notes stay on this device.</Text>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <Link href="/import" style={{ color: theme.color.text.primary, textDecorationLine: 'underline' }}>Import Markdown</Link>
            <Link href="/notes" style={{ color: theme.color.text.primary, textDecorationLine: 'underline' }}>Original notes and companion</Link>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput accessibilityLabel="New room name" placeholder="New room name" placeholderTextColor={theme.color.text.tertiary}
              value={name} onChangeText={setName} onSubmitEditing={() => { if (name.trim() && !busy) void action(create); }}
              style={[fieldStyle, { flex: 1 }]} />
            <Button label="Create" disabled={!name.trim() || busy} onPress={() => void action(create)} />
          </View>
          {error ? <Text accessibilityRole="alert" style={{ color: theme.color.status.danger.text }}>{error}</Text> : null}
          <Text style={{ color: theme.color.text.primary, fontSize: 20, fontWeight: '600', marginTop: 10 }}>Your rooms</Text>
        </View>}
        ListEmptyComponent={loading ? <ActivityIndicator /> : <Text style={{ color: theme.color.text.secondary }}>No rooms yet. Create one to start studying.</Text>}
        renderItem={({ item }) => <View style={{ backgroundColor: theme.color.bg.surface, borderColor: theme.color.border.hairline, borderWidth: 1, borderRadius: theme.radius.card, padding: 16, gap: 12 }}>
          {editingId === item.id ? <View style={{ gap: 8 }}>
            <TextInput accessibilityLabel="Rename room" value={editName} onChangeText={setEditName} style={fieldStyle} autoFocus />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label="Save" disabled={!editName.trim() || busy} onPress={() => void action(async () => {
                const result = await commit({ opId: randomUUID(), kind: 'room.rename', source: 'human', confirmed: false, expectedRevision: item.revision, payload: { roomId: item.id, name: editName } });
                if (!result.ok) throw new Error(result.error.message);
                setEditingId(null);
              })} />
              <Button label="Cancel" variant="ghost" onPress={() => setEditingId(null)} />
            </View>
          </View> : <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.name}`} onPress={() => router.push(`/rooms/${item.id}`)}>
            <Text style={{ color: theme.color.text.primary, fontSize: 20, fontWeight: '600' }}>{item.name}</Text>
            <Text style={{ color: theme.color.text.secondary, marginTop: 4 }}>Open room →</Text>
          </Pressable>}
          {deletingId === item.id ? <View style={{ gap: 8 }}>
            <Text style={{ color: theme.color.status.danger.text }}>Delete “{item.name}” and all its notes?</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label="Delete room" variant="danger" disabled={busy} onPress={() => void action(async () => {
                const result = await commit({ opId: randomUUID(), kind: 'room.delete', source: 'human', confirmed: true, expectedRevision: item.revision, payload: { roomId: item.id } });
                if (!result.ok) throw new Error(result.error.message);
                setDeletingId(null);
              })} />
              <Button label="Cancel" variant="ghost" onPress={() => setDeletingId(null)} />
            </View>
          </View> : <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Rename" variant="outline" onPress={() => { setEditName(item.name); setEditingId(item.id); setDeletingId(null); }} />
            <Button label="Delete" variant="ghost" onPress={() => { setDeletingId(item.id); setEditingId(null); }} />
          </View>}
        </View>}
      />
    </KeyboardAvoidingView>
  </SafeAreaView></Screen>;
}

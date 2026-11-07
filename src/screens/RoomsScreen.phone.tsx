import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Screen, useStoneTheme } from '../../design-theme/src/primitives';
import type { Room } from '../data/models';
import type { RoomStats } from '../data/roomStats';
import { Icon } from '../ui/Icon';
import { StageGlyph, stageName } from '../ui/StageGlyph';
import { EmptyState, Field, Notice, RoundAction } from '../ui/kit';

export interface RoomsPhoneProps {
  rooms: Room[];
  stats: Record<string, RoomStats>;
  loading: boolean;
  error: string | null;
  busy: boolean;
  onCreate: (name: string) => Promise<boolean>;
  onRename: (room: Room, name: string) => Promise<boolean>;
  onDelete: (room: Room) => Promise<boolean>;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Phone rooms list: lowercase title, round add, search, one rounded card of rooms. */
export function RoomsPhone({ rooms, stats, loading, error, busy, onCreate, onRename, onDelete }: RoomsPhoneProps) {
  const theme = useStoneTheme();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [managingId, setManagingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rooms.filter((room) => room.name.toLowerCase().includes(q)) : rooms;
  }, [rooms, query]);

  function closeManage() {
    setManagingId(null);
    setEditingId(null);
    setDeletingId(null);
  }

  const header = (
    <View style={{ gap: theme.space.xxl, paddingTop: theme.space.base }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <Text accessibilityRole="header" style={[theme.text('screenTitle'), { color: theme.color.text.primary }]}>rooms</Text>
        <RoundAction icon={adding ? 'cross' : 'plus'} label={adding ? 'cancel new room' : 'new room'} onPress={() => setAdding((v) => !v)} testID="new-room" />
      </View>
      {adding ? (
        <View style={{ gap: theme.space.md }}>
          <View style={{ flexDirection: 'row', gap: theme.space.md, alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Field accessibilityLabel="New room name" placeholder="New room name" autoFocus value={name} onChangeText={setName}
                returnKeyType="done"
                onSubmitEditing={() => { if (name.trim() && !busy) void onCreate(name).then((ok) => { if (ok) { setName(''); setAdding(false); } }); }} />
            </View>
            <Button label="Create" disabled={!name.trim() || busy}
              onPress={() => void onCreate(name).then((ok) => { if (ok) { setName(''); setAdding(false); } })} />
          </View>
        </View>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, minHeight: theme.layout.control, paddingHorizontal: theme.space.xl, borderRadius: theme.radius.control, backgroundColor: theme.color.bg.inset }}>
        <Icon name="search" size={16} color={theme.color.text.tertiary} />
        <TextInput accessibilityLabel="search rooms" placeholder="search rooms" placeholderTextColor={theme.color.text.tertiary}
          value={query} onChangeText={setQuery} returnKeyType="search" autoCorrect={false}
          style={[theme.text('body'), { flex: 1, minWidth: 0, color: theme.color.text.primary, paddingVertical: 0 }]} />
      </View>
    </View>
  );

  const footer = (
    <View style={{ gap: theme.space.xxl, marginTop: theme.space.xxl }}>
      <Pressable accessibilityRole="link" accessibilityLabel="import markdown" onPress={() => router.push('/import')}
        style={({ pressed }) => ({ minHeight: theme.layout.control, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border.strong, opacity: pressed ? 0.7 : 1 })}>
        <Text style={[theme.text('button'), { color: theme.color.text.primary }]}>import markdown</Text>
      </Pressable>
    </View>
  );

  return (
    <Screen><SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <FlatList
          data={shown}
          keyExtractor={(room) => room.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: theme.space.base, paddingBottom: 120 }}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          ListEmptyComponent={loading
            ? <ActivityIndicator style={{ marginTop: theme.space.xxl }} color={theme.color.accent.bg} />
            : <View style={{ marginTop: theme.space.xxl }}><EmptyState
              title={query.trim() ? 'No matching rooms' : 'No rooms yet'}
              body={query.trim() ? 'Try a different name.' : 'Tap + to name a room. Each room holds the notes for one subject.'} /></View>}
          renderItem={({ item, index }) => {
            const first = index === 0;
            const last = index === shown.length - 1;
            const managing = managingId === item.id;
            const s = stats[item.id] ?? { chunks: 0, due: 0 };
            const sub = [stageName(item.stage).toLowerCase(), plural(s.chunks, 'chunk'), s.due ? `${s.due} due` : null].filter(Boolean).join(' · ');
            return (
              <View style={{
                marginTop: first ? theme.space.xxl : 0,
                backgroundColor: theme.color.bg.surface,
                borderColor: theme.color.border.hairline,
                borderLeftWidth: 1, borderRightWidth: 1, borderTopWidth: 1, borderBottomWidth: last ? 1 : 0,
                borderTopLeftRadius: first ? theme.radius.float : 0, borderTopRightRadius: first ? theme.radius.float : 0,
                borderBottomLeftRadius: last ? theme.radius.float : 0, borderBottomRightRadius: last ? theme.radius.float : 0,
                overflow: 'hidden',
                ...(first ? theme.shadow.card : {}),
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: last || managing ? 0 : 1, borderBottomColor: theme.color.border.hairline }}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.name}`} onPress={() => router.push(`/rooms/${item.id}`)}
                    style={({ pressed }) => ({ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: theme.space.xl, minHeight: 64, paddingVertical: theme.space.lg, paddingLeft: theme.space.base, backgroundColor: pressed ? theme.color.bg.alt : 'transparent' })}>
                    <StageGlyph stage={item.stage} size={48} />
                    <View style={{ flex: 1, minWidth: 0, gap: theme.space.xxs }}>
                      <Text numberOfLines={1} style={[theme.text('button'), { color: theme.color.text.primary }]}>{item.name}</Text>
                      <Text numberOfLines={1} style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>{sub}</Text>
                    </View>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Manage ${item.name}`} accessibilityState={{ expanded: managing }}
                    onPress={() => { if (managing) closeManage(); else { closeManage(); setManagingId(item.id); } }}
                    style={({ pressed }) => ({ width: theme.layout.control, height: theme.layout.control, marginHorizontal: theme.space.sm, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: managing || pressed ? theme.color.bg.inset : 'transparent' })}>
                    <Icon name="more" size={22} strokeWidth={2.5} color={theme.color.text.secondary} />
                  </Pressable>
                </View>
                {managing ? <View style={{ paddingHorizontal: theme.space.base, paddingBottom: theme.space.base, gap: theme.space.md }}>
                  {editingId === item.id ? <>
                    <Field accessibilityLabel="Rename room" value={editName} onChangeText={setEditName} autoFocus />
                    <View style={{ flexDirection: 'row', gap: theme.space.md }}>
                      <Button label="Save" size="compact" disabled={!editName.trim() || busy}
                        onPress={() => void onRename(item, editName).then((ok) => { if (ok) closeManage(); })} />
                      <Button label="Cancel" size="compact" variant="ghost" onPress={() => setEditingId(null)} />
                    </View>
                  </> : deletingId === item.id ? <>
                    <Notice tone="danger">Delete “{item.name}” and all its notes? This cannot be undone.</Notice>
                    <View style={{ flexDirection: 'row', gap: theme.space.md }}>
                      <Button label="Delete room" size="compact" variant="danger" disabled={busy}
                        onPress={() => void onDelete(item).then((ok) => { if (ok) closeManage(); })} />
                      <Button label="Cancel" size="compact" variant="ghost" onPress={() => setDeletingId(null)} />
                    </View>
                  </> : <View style={{ flexDirection: 'row', gap: theme.space.md }}>
                    <Button label="Rename" size="compact" variant="outline" onPress={() => { setEditName(item.name); setEditingId(item.id); }} />
                    <Button label="Delete" size="compact" variant="ghost" onPress={() => setDeletingId(item.id)} />
                  </View>}
                </View> : null}
              </View>
            );
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView></Screen>
  );
}

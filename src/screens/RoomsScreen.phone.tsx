import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, FlatList, KeyboardAvoidingView, PanResponder, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Screen, useStoneTheme } from '../../design-theme/src/primitives';
import type { Room } from '../data/models';
import type { RoomStats } from '../data/roomStats';
import { roomRowPress } from '../navigation/room-row';
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

const ACTION_WIDTH = 66;

interface SwipeAction { label: string; tone: 'strong' | 'danger'; onPress: () => void }

/** A row that slides left to reveal action buttons. Only one row is open at a time (parent owns `open`). */
function SwipeActions({ open, onOpenChange, actions, borderBottom, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; actions: SwipeAction[]; borderBottom: boolean; children: ReactNode;
}) {
  const theme = useStoneTheme();
  const reveal = ACTION_WIDTH * actions.length;
  const [x] = useState(() => new Animated.Value(0));
  const live = useRef({ base: 0, open, reveal, notify: onOpenChange });
  const [pan, setPan] = useState<ReturnType<typeof PanResponder.create> | null>(null);
  // `live` carries the latest props into the gesture callbacks; it is only touched in effects and handlers.
  useEffect(() => {
    const m = live.current;
    m.open = open; m.reveal = reveal; m.notify = onOpenChange; m.base = open ? -reveal : 0;
    Animated.timing(x, { toValue: m.base, duration: 160, useNativeDriver: true }).start();
  }, [x, open, reveal, onOpenChange]);
  useEffect(() => {
    const m = live.current;
    setPan(PanResponder.create({
      onMoveShouldSetPanResponder: (_e, s) => Math.abs(s.dx) > 8 && Math.abs(s.dx) > Math.abs(s.dy) * 1.5,
      onPanResponderMove: (_e, s) => x.setValue(Math.max(-m.reveal, Math.min(0, m.base + s.dx))),
      onPanResponderRelease: (_e, s) => {
        const next = m.base + s.dx < -m.reveal / 2 || s.vx < -0.5;
        if (next === m.open) Animated.timing(x, { toValue: next ? -m.reveal : 0, duration: 120, useNativeDriver: true }).start();
        else m.notify(next);
      },
      onPanResponderTerminate: () => Animated.timing(x, { toValue: m.open ? -m.reveal : 0, duration: 120, useNativeDriver: true }).start(),
    }));
  }, [x]);

  return (
    <View style={{ flexDirection: 'row', overflow: 'hidden', borderBottomWidth: borderBottom ? 1 : 0, borderBottomColor: theme.color.border.hairline }}>
      <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, flexDirection: 'row' }}>
        {actions.map((a) => (
          <Pressable key={a.label} accessibilityRole="button" accessibilityLabel={a.label} disabled={!open} onPress={a.onPress}
            style={{ width: ACTION_WIDTH, alignItems: 'center', justifyContent: 'center', backgroundColor: a.tone === 'danger' ? theme.color.status.danger.fill : theme.color.border.strong }}>
            <Text style={[theme.text('bodySmall'), { color: theme.color.text.onFill, fontWeight: '600' }]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
      <Animated.View {...pan?.panHandlers} style={{ flex: 1, flexDirection: 'row', transform: [{ translateX: x }] }}>{children}</Animated.View>
    </View>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Phone rooms list: lowercase title, round add, search, one rounded card of rooms; swipe a row left for rename and delete. */
export function RoomsPhone({ rooms, stats, loading, error, busy, onCreate, onRename, onDelete }: RoomsPhoneProps) {
  const theme = useStoneTheme();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [managingId, setManagingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [swipedId, setSwipedId] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rooms.filter((room) => room.name.toLowerCase().includes(q)) : rooms;
  }, [rooms, query]);

  function closeManage() {
    setSwipedId(null);
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
                <SwipeActions
                  open={swipedId === item.id}
                  onOpenChange={(open) => setSwipedId(open ? item.id : null)}
                  borderBottom={!(last || managing)}
                  actions={[
                    { label: 'rename', tone: 'strong', onPress: () => { closeManage(); setManagingId(item.id); setEditName(item.name); setEditingId(item.id); } },
                    { label: 'delete', tone: 'danger', onPress: () => { closeManage(); setManagingId(item.id); setDeletingId(item.id); } },
                  ]}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.name}`}
                    accessibilityActions={[{ name: 'rename', label: `Rename ${item.name}` }, { name: 'delete', label: `Delete ${item.name}` }]}
                    onAccessibilityAction={(e) => {
                      closeManage(); setManagingId(item.id);
                      if (e.nativeEvent.actionName === 'rename') { setEditName(item.name); setEditingId(item.id); } else setDeletingId(item.id);
                    }}
                    onPress={() => {
                      if (roomRowPress(swipedId, item.id) === 'close') { setSwipedId(null); return; }
                      setSwipedId(null);
                      router.push(`/rooms/${item.id}`);
                    }}
                    style={({ pressed }) => ({ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: theme.space.xl, minHeight: 72, paddingHorizontal: theme.space.base, backgroundColor: pressed ? theme.color.bg.alt : theme.color.bg.surface })}>
                    <StageGlyph stage={item.stage} size={52} />
                    <View style={{ flex: 1, minWidth: 0, gap: theme.space.xxs }}>
                      <Text numberOfLines={1} style={[theme.text('button'), { color: theme.color.text.primary }]}>{item.name}</Text>
                      <Text numberOfLines={1} style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>{sub}</Text>
                    </View>
                    <Icon name="chevronRight" size={16} color={theme.color.text.tertiary} />
                  </Pressable>
                </SwipeActions>
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

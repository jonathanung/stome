import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, Screen, useStoneTheme } from '../../design-theme/src/primitives';
import type { Room } from '../data/models';
import { listRooms } from '../data/queries';
import { expoDriver } from '../db/expo-driver';
import { listRoomImports, listRoomLedger, type ImportActivity, type LedgerEntry } from '../features/stone/ledger';
import { stoneHeadline, stoneProgress, stoneSubline } from '../features/stone/stone-progress';
import { Icon } from '../ui/Icon';
import { EmptyState, useColumn } from '../ui/kit';
import { PathArrow, StagePicture, type PathStage } from '../ui/StonePath';

const WIDE = 900;
const MARK_LABEL = { got_it: 'got it', unclear: 'unclear', missed: 'missed' } as const;
const MARK_TONE = { got_it: 'success', unclear: 'warning', missed: 'danger' } as const;

function whenLabel(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return `today ${time}`;
  const day = d.toLocaleDateString(undefined, { weekday: 'short' }).toLowerCase();
  return `${day} ${time}`;
}

function Card({ children, label }: { children: ReactNode; label: string }) {
  const theme = useStoneTheme();
  return (
    <View
      accessibilityLabel={label}
      style={{
        backgroundColor: theme.color.bg.surface,
        borderRadius: theme.radius.float,
        borderWidth: 1,
        borderColor: theme.color.border.hairline,
        padding: theme.space.card,
        gap: theme.space.md,
        ...theme.shadow.card,
      }}
    >
      {children}
    </View>
  );
}

function Rule({ ok, tone, children }: { ok: 'check' | 'cross' | 'note'; tone: 'success' | 'danger' | 'warning'; children: string }) {
  const theme = useStoneTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space.xl, alignItems: 'flex-start', paddingVertical: theme.space.md }}>
      <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: theme.color.status[tone].fill, alignItems: 'center', justifyContent: 'center' }}>
        {ok === 'note'
          ? <Text style={[theme.text('label'), { color: theme.color.text.onFill }]}>!</Text>
          : <Icon name={ok === 'check' ? 'check' : 'cross'} size={13} strokeWidth={3} color={theme.color.text.onFill} />}
      </View>
      <Text style={[theme.text('body'), { flex: 1, color: theme.color.text.primary }]}>{children}</Text>
    </View>
  );
}

function FilledBadge({ text }: { text: string }) {
  const theme = useStoneTheme();
  return <View style={{ paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999, backgroundColor: theme.color.accent.bg }}>
    <Text style={[theme.text('label'), { color: theme.color.accent.fg }]}>{text}</Text>
  </View>;
}

function PlainBadge({ text, dashed = false }: { text: string; dashed?: boolean }) {
  const theme = useStoneTheme();
  return <View style={{ paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderStyle: dashed ? 'dashed' : 'solid', borderColor: theme.color.border.strong }}>
    <Text style={[theme.text('label'), { color: theme.color.text.secondary }]}>{text}</Text>
  </View>;
}

function StageColumn({ stage, label, badge, meta, dim = false }: { stage: PathStage; label: string; badge: ReactNode; meta: string; dim?: boolean }) {
  const theme = useStoneTheme();
  return <View style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: theme.space.md, opacity: dim ? 0.75 : 1 }}>
    <StagePicture stage={stage} width={110} label={label} />
    {badge}
    <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary, textAlign: 'center' }]}>{meta}</Text>
  </View>;
}

function ArrowSlot() {
  return <View style={{ marginBottom: 52 }}><PathArrow /></View>;
}

function RoomPicker({ rooms, selectedId, onSelect }: { rooms: Room[]; selectedId: string; onSelect: (id: string) => void }) {
  const theme = useStoneTheme();
  return (
    <View style={{ gap: theme.space.xs }}>
      <Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>ROOM</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space.md }}>
        {rooms.map((room) => {
          const selected = room.id === selectedId;
          return (
            <Pressable
              key={room.id}
              accessibilityRole="button"
              accessibilityLabel={`Show ${room.name}`}
              accessibilityState={{ selected }}
              onPress={() => onSelect(room.id)}
              style={{
                minHeight: theme.layout.control,
                paddingHorizontal: theme.space.xl,
                justifyContent: 'center',
                borderRadius: theme.radius.control,
                borderWidth: 1,
                borderColor: selected ? theme.color.accent.bg : theme.color.border.strong,
                backgroundColor: selected ? theme.color.accent.bg : theme.color.bg.surface,
              }}
            >
              <Text style={[theme.text('chip'), { color: selected ? theme.color.accent.fg : theme.color.text.primary }]}>{room.name.toLowerCase()}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function StoneHomeScreen() {
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const theme = useStoneTheme();
  const column = useColumn();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [imports, setImports] = useState<ImportActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const room = rooms.find((r) => r.id === selectedId) ?? rooms[0] ?? null;
  const roomId: string | null = rooms.some((r) => r.id === selectedId) ? selectedId : (rooms[0]?.id ?? null);

  useFocusEffect(useCallback(() => {
    let active = true;
    listRooms(db).then((rows) => { if (active) { setRooms(rows); setLoading(false); } })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [db]));

  useFocusEffect(useCallback(() => {
    if (!roomId) { setLedger([]); setImports([]); return undefined; }
    let active = true;
    listRoomLedger(db, roomId).then((rows) => { if (active) setLedger(rows); }).catch(() => { if (active) setLedger([]); });
    listRoomImports(db, roomId).then((rows) => { if (active) setImports(rows); }).catch(() => { if (active) setImports([]); });
    return () => { active = false; };
  }, [db, roomId]));

  const activity = useMemo(() => [
    ...ledger.map((entry) => ({ kind: 'mark' as const, key: `${entry.chunkId}:${entry.localDay}`, at: entry.markedAt, entry })),
    ...imports.map((imp) => ({ kind: 'import' as const, key: `import:${imp.sourceId}`, at: imp.importedAt, imp })),
  ].sort((a, b) => b.at - a.at), [ledger, imports]);

  const progress = room ? stoneProgress(ledger.length, room.stage) : null;
  const isBrick = room?.stage === 'brick';

  return <Screen><SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={[column, { paddingBottom: 120, gap: theme.space.section }]}>
      <View style={{ gap: theme.space.xs }}>
        <Text accessibilityRole="header" style={[theme.text('screenTitle'), { color: theme.color.text.primary }]}>stone home</Text>
        <Text style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>
          real study builds your rooms. stones come from reviews you finish yourself, not from imports or ai.
        </Text>
      </View>

      {loading ? <ActivityIndicator color={theme.color.accent.bg} /> : null}
      {!loading && !room ? <EmptyState title="No rooms yet" body="Create a room and finish a review to start earning stones.">
        <Button label="Go to rooms" onPress={() => router.replace('/')} />
      </EmptyState> : null}

      {room && progress ? <>
        {rooms.length > 1 ? <RoomPicker rooms={rooms} selectedId={room.id} onSelect={setSelectedId} /> : null}

        <Card label="stage path">
          <View style={{ flexDirection: wide ? 'row' : 'column', justifyContent: 'space-between', alignItems: wide ? 'center' : 'flex-start', gap: theme.space.xl }}>
            <View style={{ flex: wide ? 1 : undefined, gap: theme.space.xs }}>
              <Text accessibilityRole="header" style={[theme.text('title'), { color: theme.color.text.primary }]}>{stoneHeadline(room.name, room.stage)}</Text>
              <Text style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>{stoneSubline(progress, room.stage)}</Text>
            </View>
            <Button label={`review ${room.name.toLowerCase()}`} onPress={() => router.push(`/rooms/${room.id}/review`)} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space.md }}>
            <StageColumn
              stage="stonehenge"
              label={isBrick ? 'stonehenge, earlier stage' : 'stonehenge, current stage'}
              badge={isBrick ? <PlainBadge text="stonehenge" /> : <FilledBadge text="stonehenge · now" />}
              meta="every new room"
            />
            <ArrowSlot />
            <StageColumn
              stage="drystone"
              dim
              label="drystone wall, proposed stage"
              badge={<PlainBadge text="drystone wall · proposed" dashed />}
              meta="not in the schema yet"
            />
            <ArrowSlot />
            <StageColumn
              stage="brick"
              label={isBrick ? 'brick house, current stage' : 'brick house, next stage'}
              badge={isBrick
                ? <FilledBadge text="brick · now" />
                : <Badge tone="success" label={`brick · ${progress.remaining} ${progress.remaining === 1 ? 'credit' : 'credits'} away`} />}
              meta={`${progress.needed} human review credits`}
            />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.lg }}>
            <Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>CREDITS</Text>
            <View accessible accessibilityRole="image" accessibilityLabel={`${progress.earned} of ${progress.needed} credits earned`} style={{ flexDirection: 'row', gap: 6 }}>
              {Array.from({ length: progress.needed }, (_, i) => (
                <View key={i} style={{
                  width: 28, height: 28, borderRadius: 7, boxSizing: 'border-box',
                  backgroundColor: i < progress.earned ? theme.color.accent.bg : 'transparent',
                  borderWidth: i < progress.earned ? 0 : 1.5,
                  borderColor: theme.color.border.strong,
                }} />
              ))}
            </View>
          </View>
        </Card>

        <View style={{ flexDirection: wide ? 'row' : 'column', gap: theme.space.xl, alignItems: 'flex-start' }}>
          <View style={{ flex: wide ? 1 : undefined, width: wide ? undefined : '100%' }}>
            <Card label="what counts">
              <Text accessibilityRole="header" style={[theme.text('title'), { color: theme.color.text.primary }]}>what counts</Text>
              <Rule ok="check" tone="success">you mark a note missed, unclear or got it in a review. one credit per note per day.</Rule>
              <Rule ok="cross" tone="danger">importing notes. imports never award stones.</Rule>
              <Rule ok="cross" tone="danger">ai answers and ai edits. pinning one is not studying it.</Rule>
              <Rule ok="note" tone="warning">marking the same note again today replaces the mark. it does not add a second credit.</Rule>
            </Card>
          </View>
          <View style={{ flex: wide ? 1.3 : undefined, width: wide ? undefined : '100%' }}>
            <Card label="ledger">
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text accessibilityRole="header" style={[theme.text('title'), { color: theme.color.text.primary }]}>ledger</Text>
                <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>{room.name.toLowerCase()} · newest first</Text>
              </View>
              {activity.length === 0
                ? <Text style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>no credits yet. finish a review and it shows up here.</Text>
                : <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
                    <Text style={[theme.text('label'), { width: 84, color: theme.color.text.tertiary }]}>WHEN</Text>
                    <Text style={[theme.text('label'), { flex: 1, color: theme.color.text.tertiary }]}>NOTE</Text>
                    <Text style={[theme.text('label'), { width: 76, color: theme.color.text.tertiary }]}>MARK</Text>
                    <Text style={[theme.text('label'), { width: 64, textAlign: 'right', color: theme.color.text.tertiary }]}>CREDIT</Text>
                  </View>
                  {activity.map((item) => (
                    <View key={item.key} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingVertical: theme.space.md, borderTopWidth: 1, borderTopColor: theme.color.border.hairline }}>
                      <Text style={[theme.text('bodySmall'), { width: 84, color: theme.color.text.tertiary, fontVariant: ['tabular-nums'] }]}>{whenLabel(item.at)}</Text>
                      {item.kind === 'mark' ? <>
                        <Text numberOfLines={1} style={[theme.text('bodySmall'), { flex: 1, color: theme.color.text.primary }]}>{item.entry.title}</Text>
                        <View style={{ width: 76, alignItems: 'flex-start' }}><Badge tone={MARK_TONE[item.entry.state]} label={MARK_LABEL[item.entry.state]} /></View>
                        <Text style={[theme.text('button'), { width: 64, textAlign: 'right', color: theme.color.text.primary }]}>+1</Text>
                      </> : <>
                        <Text numberOfLines={1} style={[theme.text('bodySmall'), { flex: 1, color: theme.color.text.primary }]}>{`${item.imp.noteCount} ${item.imp.noteCount === 1 ? 'note' : 'notes'} imported`}</Text>
                        <View style={{ width: 76, alignItems: 'flex-start' }}><PlainBadge text="import" /></View>
                        <Text style={[theme.text('bodySmall'), { width: 64, textAlign: 'right', color: theme.color.text.tertiary }]}>no credit</Text>
                      </>}
                    </View>
                  ))}
                </>}
            </Card>
          </View>
        </View>
      </> : null}
    </ScrollView>
  </SafeAreaView></Screen>;
}

import { Pressable, Text, View } from 'react-native';
import Svg, { G, Path, Rect } from 'react-native-svg';
import type { ReactNode } from 'react';

import { Badge, Button, Card, TrilithonMark, useStoneTheme } from '../../design-theme/src/primitives';
import type { Room, RoomStage } from '../data/models';
import { EMPTY_ROOM_STATS, type RoomStats } from '../data/roomStats';
import { Icon } from '../ui/Icon';
import { Field } from '../ui/kit';
import { stageName } from '../ui/StageGlyph';

/** Breakpoints from the design: 3 columns, 2 under 980, phone list under 760. */
export function gridColumns(width: number): number {
  if (width <= 760) return 1;
  return width <= 980 ? 2 : 3;
}

/** Painted cover for a room's stage, cropped like the design (xMidYMax slice). */
function Cover({ stage }: { stage: RoomStage }) {
  const theme = useStoneTheme();
  return (
    <View style={{ height: 118, backgroundColor: theme.color.bg.alt, borderBottomWidth: 1, borderColor: theme.color.border.hairline, overflow: 'hidden' }}>
      <Svg width="100%" height="100%" viewBox="0 0 360 118" preserveAspectRatio="xMidYMax slice">
        <Rect width={360} height={118} fill="#cfc9bd" />
        <Rect y={96} width={360} height={22} fill="#a9ad8f" />
        {stage === 'brick' ? (
          <>
            <G fill="#8a6a52" stroke="#5c4636" strokeWidth={1}><Rect x={120} y={40} width={120} height={56} /></G>
            <Path stroke="#5c4636" strokeWidth={1} fill="none" d="M120 54h120M120 68h120M120 82h120M150 40v14M180 40v14M210 40v14M135 54v14M165 54v14M195 54v14M225 54v14M150 68v14M180 68v14M210 68v14M135 82v14M165 82v14M195 82v14M225 82v14" />
            <Path d="M110 42 180 12l70 30z" fill="#33302a" />
            <Rect x={168} y={70} width={24} height={26} fill="#33302a" />
          </>
        ) : (
          <G fill="#6a6458">
            <Rect x={128} y={44} width={18} height={52} rx={2} />
            <Rect x={168} y={44} width={18} height={52} rx={2} />
            <Rect x={122} y={32} width={70} height={12} rx={2} />
            <Rect x={212} y={50} width={16} height={46} rx={2} />
            <Rect x={246} y={50} width={16} height={46} rx={2} />
          </G>
        )}
      </Svg>
    </View>
  );
}

export function GridCard({ children, tone, selected }: { children: ReactNode; tone?: 'danger'; selected?: boolean }) {
  const theme = useStoneTheme();
  return (
    <View style={{
      flex: 1, backgroundColor: theme.color.bg.surface, borderRadius: theme.radius.card, overflow: 'hidden',
      borderWidth: 1, borderColor: tone === 'danger' ? theme.color.status.danger.fill : theme.color.border.hairline,
      ...(selected ? { outlineStyle: 'solid', outlineWidth: 2, outlineColor: theme.color.text.primary, outlineOffset: 2 } : null),
    } as object}>{children}</View>
  );
}

export interface RoomCardProps {
  room: Room;
  stats: RoomStats;
  mode: 'view' | 'rename' | 'delete';
  editName: string;
  busy: boolean;
  onOpen: () => void;
  onOptions: () => void;
  onEditName: (name: string) => void;
  onSaveRename: () => void;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onCancel: () => void;
}

export function RoomCard(p: RoomCardProps) {
  const theme = useStoneTheme();
  const { room, stats } = p;
  const meta = `${stats.chunks} chunks · ${stats.annotations} annotations · ${stats.due} due`;

  if (p.mode === 'delete') {
    return <GridCard tone="danger"><View style={{ padding: theme.space.card, gap: theme.space.xl }}>
      <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, paddingVertical: 2, paddingLeft: 8, paddingRight: 10, borderRadius: theme.radius.pill, backgroundColor: theme.color.status.danger.wash }}>
        <Text style={[theme.text('label'), { color: theme.color.status.danger.text }]}>Delete room</Text>
      </View>
      <Text accessibilityRole="header" style={[theme.text('title'), { color: theme.color.text.primary }]}>Delete {room.name}?</Text>
      <Text style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>
        {stats.chunks} chunks, their highlights and pinned answers go with it. This cannot be undone.
      </Text>
      <View style={{ flexDirection: 'row', gap: theme.space.md }}>
        <Button label="Delete room" variant="danger" disabled={p.busy} onPress={p.onConfirmDelete} />
        <Button label="Keep it" variant="outline" onPress={p.onCancel} />
      </View>
    </View></GridCard>;
  }

  return <GridCard selected={p.mode === 'rename'}>
    <Cover stage={room.stage} />
    {p.mode === 'rename' ? <View style={{ padding: theme.space.base, paddingBottom: 18, gap: theme.space.lg }}>
      <Text style={[theme.text('label'), { color: theme.color.text.tertiary, letterSpacing: 0.8 }]}>Rename room</Text>
      <Field accessibilityLabel="Rename room" value={p.editName} onChangeText={p.onEditName} autoFocus />
      <View style={{ flexDirection: 'row', gap: theme.space.md }}>
        <Button label="Save" disabled={!p.editName.trim() || p.busy} onPress={p.onSaveRename} />
        <Button label="Cancel" variant="outline" onPress={p.onCancel} />
      </View>
    </View> : <View style={{ padding: theme.space.base, paddingBottom: 18, gap: theme.space.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable accessibilityRole="link" accessibilityLabel={`Open ${room.name}`} onPress={p.onOpen} style={{ flex: 1 }}>
          <Text numberOfLines={1} style={[theme.text('title'), { color: theme.color.text.primary }]}>{room.name}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Room options for ${room.name}`} onPress={p.onOptions}
          style={{ width: theme.layout.control, height: theme.layout.control, borderRadius: theme.radius.control, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="more" size={18} color={theme.color.text.secondary} />
        </Pressable>
      </View>
      {room.stage === 'brick'
        ? <Badge tone="success" label={stageName(room.stage)} />
        : <View style={{ alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: 10, borderRadius: theme.radius.pill, backgroundColor: theme.color.bg.inset }}>
            <Text style={[theme.text('label'), { color: theme.color.text.secondary }]}>{stageName(room.stage)}</Text>
          </View>}
      <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary, fontSize: 13, lineHeight: 18 }]}>{meta}</Text>
    </View>}
  </GridCard>;
}

/** Dashed "new room" tile; becomes an inline create form once tapped. */
export function NewRoomCard({ open, name, busy, onOpen, onName, onCreate, onCancel }: {
  open: boolean; name: string; busy: boolean;
  onOpen: () => void; onName: (n: string) => void; onCreate: () => void; onCancel: () => void;
}) {
  const theme = useStoneTheme();
  if (open) {
    return <GridCard selected><View style={{ padding: theme.space.card, gap: theme.space.xl, minHeight: 200, justifyContent: 'center' }}>
      <Text style={[theme.text('label'), { color: theme.color.text.tertiary, letterSpacing: 0.8 }]}>New room</Text>
      <Field accessibilityLabel="New room name" placeholder="New room name" value={name} onChangeText={onName} autoFocus returnKeyType="done"
        onSubmitEditing={() => { if (name.trim() && !busy) onCreate(); }} />
      <View style={{ flexDirection: 'row', gap: theme.space.md }}>
        <Button label="Create" disabled={!name.trim() || busy} onPress={onCreate} />
        <Button label="Cancel" variant="outline" onPress={onCancel} />
      </View>
    </View></GridCard>;
  }
  return <Pressable accessibilityRole="button" accessibilityLabel="New room" onPress={onOpen} style={{
    flex: 1, minHeight: 200, alignItems: 'center', justifyContent: 'center', gap: theme.space.lg,
    borderRadius: theme.radius.card, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.color.border.strong,
  }}>
    <TrilithonMark width={40} height={28} />
    <Text style={[theme.text('cardTitle'), { color: theme.color.text.primary }]}>New room</Text>
    <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary, fontSize: 13, lineHeight: 18 }]}>Every room starts as Stonehenge</Text>
  </Pressable>;
}

/** "N notes due for review" strip above the grid. */
export function DueBanner({ due, missed, unclear, onStart }: { due: number; missed: number; unclear: number; onStart: () => void }) {
  const theme = useStoneTheme();
  if (due === 0) return null;
  const parts = [missed ? `${missed} missed` : '', unclear ? `${unclear} unclear` : ''].filter(Boolean).join(', ');
  const tiles = Math.min(due, 4);
  return <Card>
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.space.card }}>
      <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
        {Array.from({ length: tiles }, (_, i) => (
          <View key={i} style={{ width: 22, height: 22, borderRadius: theme.radius.thumb, backgroundColor: i === 0 && missed ? theme.color.status.danger.fill : theme.color.status.warning.fill }} />
        ))}
      </View>
      <View style={{ flex: 1, minWidth: 200, gap: theme.space.xxs }}>
        <Text style={[theme.text('cardTitle'), { color: theme.color.text.primary, fontSize: 17, lineHeight: 24 }]}>
          {due} {due === 1 ? 'note' : 'notes'} due for review
        </Text>
        <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary, fontSize: 13, lineHeight: 18 }]}>
          {parts ? `${parts}. ` : ''}Each review you finish is a credit toward Brick.
        </Text>
      </View>
      <Button label="Start review" onPress={onStart} />
    </View>
  </Card>;
}

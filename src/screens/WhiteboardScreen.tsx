import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View, type GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Ellipse, G, Line, Polygon, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import { Button, Screen, useStoneTheme } from '../../design-theme/src/primitives';
import { createCommit } from '../data/commit';
import { getBoard, getRoom } from '../data/queries';
import type { Room } from '../data/models';
import { expoDriver } from '../db/expo-driver';
import { applyBoardCorrection, boardServiceOrigin, parseBoardReply, type BoardAction, type BoardReply, type BoardRequest } from '../whiteboard/assistant';
import { BOARD_HEIGHT, BOARD_WIDTH, boardToNote, type Board, type BoardItem, type Point } from '../whiteboard/model';

type Tool = 'pencil' | 'rect' | 'ellipse' | 'arrow' | 'text';
type DrawingItem = Exclude<BoardItem, { kind: 'text' }>;

export function WhiteboardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const commit = useMemo(() => createCommit(db, { now: Date.now, newId: randomUUID }), [db]);
  const theme = useStoneTheme();
  const [room, setRoom] = useState<Room | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [tool, setTool] = useState<Tool>('pencil');
  const [width, setWidth] = useState(0);
  const [draft, setDraft] = useState<DrawingItem | null>(null);
  const draftRef = useRef<DrawingItem | null>(null);
  const [textAt, setTextAt] = useState<Point | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [study, setStudy] = useState<{ reply: BoardReply; revision: number; provider: string } | null>(null);
  const [companionUrl, setCompanionUrl] = useState(Platform.OS === 'web' ? 'http://127.0.0.1:8787' : '');
  const [pairingToken, setPairingToken] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    const [nextRoom, nextBoard] = await Promise.all([getRoom(db, id), getBoard(db, id)]);
    setRoom(nextRoom); setBoard(nextBoard);
  }, [db, id]);
  useEffect(() => {
    if (!id) return;
    let active = true;
    Promise.all([getRoom(db, id), getBoard(db, id)]).then(([nextRoom, nextBoard]) => {
      if (active) { setRoom(nextRoom); setBoard(nextBoard); }
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load board'); });
    return () => { active = false; };
  }, [db, id]);

  async function save(items: BoardItem[], source: 'human' | 'ai' = 'human'): Promise<boolean> {
    if (!board || busy) return false;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await commit({ opId: randomUUID(), kind: 'board.save', source, confirmed: source === 'ai',
        expectedRevision: board.revision, payload: { roomId: board.roomId, items } });
      if (!result.ok) throw new Error(result.error.message);
      setBoard({ ...board, items, revision: result.value.revision, updatedAt: Date.now() });
      setStudy(null);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save board');
      await refresh().catch(() => undefined);
      return false;
    } finally { setBusy(false); }
  }

  async function ask(action: BoardAction) {
    if (!board || asking || !pairingToken.trim()) return;
    setAsking(true); setError(null); setStudy(null);
    const input: BoardRequest = { roomId: board.roomId, revision: board.revision, action, items: board.items };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const origin = boardServiceOrigin(companionUrl, Platform.OS === 'web' ? 'web' : 'native');
      const response = await fetch(`${origin}/v1/board`, { method: 'POST', signal: controller.signal, credentials: 'omit',
        headers: { 'content-type': 'application/json', 'x-stome-token': pairingToken.trim() }, body: JSON.stringify(input) });
      const result = await response.json() as { ok?: boolean; provider?: string; output?: unknown; error?: string | { message?: string } };
      if (!response.ok || !result.ok) throw new Error(
        typeof result.error === 'string' ? result.error : result.error?.message ?? `Board assistant failed (${response.status})`,
      );
      const reply = parseBoardReply(result.output, input);
      setStudy({ reply, revision: input.revision, provider: result.provider ?? 'unknown' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Board assistant failed');
    } finally { clearTimeout(timer); setAsking(false); }
  }

  function point(event: GestureResponderEvent): Point {
    const { locationX, locationY } = event.nativeEvent;
    return [Math.max(0, Math.min(BOARD_WIDTH, locationX / width * BOARD_WIDTH)),
      Math.max(0, Math.min(BOARD_HEIGHT, locationY / (width * BOARD_HEIGHT / BOARD_WIDTH) * BOARD_HEIGHT))];
  }
  function start(event: GestureResponderEvent) {
    if (!board || busy || !width) return;
    const [x, y] = point(event);
    if (tool === 'text') { setEditingTextId(null); setTextAt([x, y]); setLabel(''); return; }
    const item: DrawingItem = tool === 'pencil' ? { id: randomUUID(), kind: 'pencil', points: [[x, y]] }
      : { id: randomUUID(), kind: tool, x, y, width: 0, height: 0 };
    draftRef.current = item; setDraft(item);
  }
  function move(event: GestureResponderEvent) {
    const item = draftRef.current;
    if (!item || !width) return;
    const [x, y] = point(event);
    if (item.kind === 'pencil') {
      const last = item.points[item.points.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) < 2) return;
    }
    const next: DrawingItem = item.kind === 'pencil'
      ? { ...item, points: item.points.length < 5000 ? [...item.points, [x, y]] : item.points }
      : { ...item, width: x - item.x, height: y - item.y };
    draftRef.current = next; setDraft(next);
  }
  function finish() {
    const item = draftRef.current;
    draftRef.current = null; setDraft(null);
    if (!item || !board) return;
    if (item.kind !== 'pencil' && Math.abs(item.width) < 3 && Math.abs(item.height) < 3) return;
    void save([...board.items, item]);
  }

  const ink = theme.color.text.primary;
  function renderItem(item: BoardItem) {
    if (item.kind === 'text') return <SvgText key={item.id} x={item.x} y={item.y} fill={ink} fontSize={26}>{item.text}</SvgText>;
    if (item.kind === 'pencil') return <Polyline key={item.id} points={item.points.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />;
    const x = Math.min(item.x, item.x + item.width), y = Math.min(item.y, item.y + item.height);
    if (item.kind === 'rect') return <Rect key={item.id} x={x} y={y} width={Math.abs(item.width)} height={Math.abs(item.height)} fill="none" stroke={ink} strokeWidth={3} />;
    if (item.kind === 'ellipse') return <Ellipse key={item.id} cx={x + Math.abs(item.width) / 2} cy={y + Math.abs(item.height) / 2} rx={Math.abs(item.width) / 2} ry={Math.abs(item.height) / 2} fill="none" stroke={ink} strokeWidth={3} />;
    const ex = item.x + item.width, ey = item.y + item.height;
    const angle = Math.atan2(item.height, item.width), size = 16;
    return <G key={item.id}><Line x1={item.x} y1={item.y} x2={ex} y2={ey} stroke={ink} strokeWidth={3} />
      <Polygon points={`${ex},${ey} ${ex - size * Math.cos(angle - .5)},${ey - size * Math.sin(angle - .5)} ${ex - size * Math.cos(angle + .5)},${ey - size * Math.sin(angle + .5)}`} fill={ink} /></G>;
  }

  if (!board) return <Screen><SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
    {error ? <><Text accessibilityRole="alert">{error}</Text><Button label="Back to rooms" onPress={() => router.replace('/')} /></> : <ActivityIndicator />}
  </SafeAreaView></Screen>;
  if (!room) return <Screen><SafeAreaView><Text>Room not found.</Text></SafeAreaView></Screen>;
  const buttons: Tool[] = ['pencil', 'text', 'rect', 'ellipse', 'arrow'];
  return <Screen><SafeAreaView style={{ flex: 1 }}><ScrollView contentContainerStyle={{ width: '100%', maxWidth: 760, alignSelf: 'center', padding: 16, paddingBottom: 48, gap: 16 }} keyboardShouldPersistTaps="handled">
    <Pressable accessibilityRole="button" onPress={() => router.replace(`/rooms/${room.id}`)}><Text style={{ color: theme.color.text.secondary }}>← {room.name}</Text></Pressable>
    <Text accessibilityRole="header" style={{ color: ink, fontSize: 30, fontWeight: '700' }}>Whiteboard</Text>
    <Text style={{ color: theme.color.text.secondary }}>Choose a tool, then draw or tap on the board. Changes save as you go.</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{buttons.map((name) =>
      <Button key={name} label={name[0].toUpperCase() + name.slice(1)} variant={tool === name ? undefined : 'outline'} onPress={() => setTool(name)} />)}</View>
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ width: '100%', aspectRatio: BOARD_WIDTH / BOARD_HEIGHT, borderWidth: 1, borderColor: theme.color.border.strong, backgroundColor: '#fff', borderRadius: 8, overflow: 'hidden' }}
      onStartShouldSetResponder={() => !busy} onMoveShouldSetResponder={() => !busy}
      onResponderGrant={start} onResponderMove={move} onResponderRelease={finish} onResponderTerminate={() => { draftRef.current = null; setDraft(null); }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`} pointerEvents="none">
        {board.items.map(renderItem)}{draft ? renderItem(draft) : null}
      </Svg>
    </View>
    {textAt ? <View style={{ gap: 8 }}><TextInput accessibilityLabel="Board text" autoFocus value={label} onChangeText={setLabel} maxLength={500} placeholder="Text for the board" style={{ borderWidth: 1, borderColor: theme.color.border.strong, borderRadius: 8, padding: 12, color: ink }} />
      <View style={{ flexDirection: 'row', gap: 8 }}><Button label={editingTextId ? 'Save text' : 'Add text'} disabled={!label.trim() || busy} onPress={() => void (async () => {
        const items: BoardItem[] = editingTextId ? board.items.map((item) => item.kind === 'text' && item.id === editingTextId ? { ...item, text: label.trim() } : item)
          : [...board.items, { id: randomUUID(), kind: 'text', x: textAt[0], y: textAt[1], text: label.trim() }];
        if (await save(items)) { setTextAt(null); setEditingTextId(null); }
      })()} /><Button label="Cancel" variant="ghost" onPress={() => { setTextAt(null); setEditingTextId(null); }} /></View></View> : null}
    <Text style={{ color: ink, fontSize: 20, fontWeight: '600' }}>Board items</Text>
    {board.items.length ? board.items.map((item, index) => <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <Text numberOfLines={1} style={{ color: ink, flex: 1 }}>{index + 1}. {item.kind === 'text' ? item.text : item.kind}</Text>
      {item.kind === 'text' ? <Button label="Edit" variant="outline" disabled={busy} onPress={() => { setEditingTextId(item.id); setTextAt([item.x, item.y]); setLabel(item.text); }} /> : null}
      <Button label="Remove" variant="ghost" disabled={busy} onPress={() => void save(board.items.filter((entry) => entry.id !== item.id))} />
    </View>) : <Text style={{ color: theme.color.text.secondary }}>The board is empty.</Text>}
    <Text style={{ color: ink, fontSize: 20, fontWeight: '600' }}>Study this board</Text>
    <Text style={{ color: theme.color.text.secondary }}>{Platform.OS === 'web' ? 'Pair with the local companion or an HTTPS board service.' : 'Enter your HTTPS board service address and pairing token.'} The token stays in memory.</Text>
    <View style={{ gap: 8 }}>
      <TextInput accessibilityLabel="Board service address" autoCapitalize="none" value={companionUrl} onChangeText={setCompanionUrl} placeholder={Platform.OS === 'web' ? 'http://127.0.0.1:8787' : 'https://board.example.com'} style={{ borderWidth: 1, borderColor: theme.color.border.strong, borderRadius: 8, padding: 12, color: ink }} />
      <TextInput accessibilityLabel="Pairing token" autoCapitalize="none" secureTextEntry value={pairingToken} onChangeText={setPairingToken} placeholder="Pairing token" style={{ borderWidth: 1, borderColor: theme.color.border.strong, borderRadius: 8, padding: 12, color: ink }} />
    </View>
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{(['explain', 'check', 'quiz'] as const).map((action) =>
      <Button key={action} label={action[0].toUpperCase() + action.slice(1)} variant="outline" disabled={!companionUrl.trim() || !pairingToken.trim() || asking || busy} onPress={() => void ask(action)} />)}</View>
    {asking ? <ActivityIndicator accessibilityLabel="Studying board" /> : null}
    {study ? <View style={{ gap: 8, padding: 14, borderRadius: 8, backgroundColor: theme.color.bg.surface }}>
      <Text style={{ color: ink, fontWeight: '600' }}>{study.provider === 'openai' ? 'AI response' : 'Mock response'}</Text><Text style={{ color: ink }}>{study.reply.message}</Text>
      {study.reply.correction.kind !== 'none' ? <><Text style={{ color: ink }}>Suggested board text: {study.reply.correction.text}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}><Button label="Accept suggestion" disabled={busy} onPress={() => void (async () => {
          if (study.revision !== board.revision) { setError('The board changed. Ask again before accepting this suggestion.'); setStudy(null); return; }
          await save(applyBoardCorrection(board.items, study.reply.correction, randomUUID), 'ai');
        })()} />
          <Button label="Dismiss" variant="ghost" onPress={() => setStudy(null)} /></View></> : null}
    </View> : null}
    <Button label="Turn board into notes" disabled={!board.items.length || busy} onPress={() => void (async () => {
      setBusy(true); setError(null);
      try { const result = await commit({ opId: randomUUID(), kind: 'chunk.create', source: 'human', confirmed: true, payload: { roomId: room.id, bodies: [boardToNote(board.items)] } });
        if (!result.ok) throw new Error(result.error.message); setNotice('Saved as a note in this room.'); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create note'); }
      finally { setBusy(false); }
    })()} />
    {notice ? <Text accessibilityRole="alert" style={{ color: ink }}>{notice}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: theme.color.status.danger.text }}>{error}</Text> : null}
  </ScrollView></SafeAreaView></Screen>;
}

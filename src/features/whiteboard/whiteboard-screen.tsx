import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Screen, useStoneTheme } from '../../../design-theme/src/primitives';
import { createCommit } from '../../data/commit';
import { expoDriver } from '../../db/expo-driver';
import { BoardCanvas } from './board-canvas';
import {
  appendPointerSample,
  emptyDraft,
  finishPointerDraft,
  type BoardPoint,
  type PointerDraft,
  type ViewSize,
} from './contract';
import { boardRefresh } from './refresh';
import { clearBoard, loadBoard, saveHumanStroke, undoBoardStroke, type BoardSnapshot } from './session';

type Hold = { kind: 'failed'; message: string } | { kind: 'capped'; message: string } | null;

/**
 * Human pencil board for one room. Strokes commit only on pointer-up.
 * Undo and clear are separate presses and go through the human delete gate.
 */
export function WhiteboardScreen() {
  const params = useLocalSearchParams<{ roomId: string }>();
  const roomId = typeof params.roomId === 'string' ? params.roomId : undefined;
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const commit = useMemo(() => createCommit(db, { now: Date.now, newId: randomUUID }), [db]);
  const theme = useStoneTheme();
  const [board, setBoard] = useState<BoardSnapshot | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(Boolean(roomId));
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<PointerDraft>(emptyDraft());
  const [hold, setHold] = useState<Hold>(null);
  const draftRef = useRef(draft);
  const drawingRef = useRef(false);
  const opIdRef = useRef<string | null>(null);
  const holdRef = useRef<Hold>(null);
  const loadGen = useRef(0);

  const replaceDraft = useCallback((next: PointerDraft) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const replaceHold = useCallback((next: Hold) => {
    holdRef.current = next;
    setHold(next);
  }, []);

  const reload = useCallback(async () => {
    if (!roomId) return null;
    const gen = ++loadGen.current;
    const next = await loadBoard(db, roomId);
    if (gen !== loadGen.current) return next;
    if (!next) setMissing(true);
    else {
      setMissing(false);
      setBoard(next);
    }
    return next;
  }, [db, roomId]);

  useEffect(() => {
    if (!roomId) return undefined;
    let active = true;
    const gen = ++loadGen.current;
    loadBoard(db, roomId)
      .then((next) => {
        if (!active || gen !== loadGen.current) return;
        if (!next) setMissing(true);
        else {
          setMissing(false);
          setBoard(next);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not open the whiteboard');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [db, roomId]);

  useEffect(() => {
    if (!roomId) return undefined;
    return boardRefresh.subscribe((changed) => {
      if (changed === roomId) void reload().catch(() => undefined);
    });
  }, [reload, roomId]);

  const persist = useCallback(async (points: BoardPoint[], opId: string) => {
    if (!roomId) return;
    setBusy(true);
    setError(null);
    const result = await saveHumanStroke(db, commit, { roomId, points, opId });
    setBusy(false);
    if (!result.ok) {
      replaceHold({ kind: 'failed', message: result.message });
      setError(result.message);
      return;
    }
    replaceHold(null);
    opIdRef.current = null;
    replaceDraft(emptyDraft());
    await reload();
  }, [commit, db, reload, replaceDraft, replaceHold, roomId]);

  const onGesture = useCallback((phase: 'down' | 'move' | 'up' | 'cancel', local: { x: number; y: number } | null, view: ViewSize | null) => {
    if (holdRef.current) return;
    if (phase === 'down') {
      if (busy || !local || !view) return;
      drawingRef.current = true;
      opIdRef.current = randomUUID();
      setConfirmClear(false);
      setError(null);
      replaceDraft(appendPointerSample(emptyDraft(), local.x, local.y, view));
      return;
    }
    if (!drawingRef.current) return;
    if (phase === 'move') {
      if (!local || !view) return;
      const next = appendPointerSample(draftRef.current, local.x, local.y, view);
      replaceDraft(next);
      if (next.capped) {
        drawingRef.current = false;
        const message = 'This stroke is longer than 5000 points, so it was not saved.';
        replaceHold({ kind: 'capped', message });
        setError(message);
      }
      return;
    }
    if (phase === 'cancel') {
      drawingRef.current = false;
      replaceDraft(emptyDraft());
      return;
    }
    drawingRef.current = false;
    const points = finishPointerDraft(draftRef.current, 'up');
    if (!points) {
      if (!draftRef.current.capped) replaceDraft(emptyDraft());
      return;
    }
    const opId = opIdRef.current ?? randomUUID();
    opIdRef.current = opId;
    void persist(points, opId);
  }, [busy, persist, replaceDraft, replaceHold]);

  async function retry() {
    const points = finishPointerDraft(draftRef.current, 'up');
    const opId = opIdRef.current;
    if (!points || !opId || holdRef.current?.kind === 'capped') return;
    await persist(points, opId);
  }

  function discard() {
    drawingRef.current = false;
    opIdRef.current = null;
    replaceHold(null);
    setError(null);
    replaceDraft(emptyDraft());
  }

  async function undo() {
    if (!roomId || busy) return;
    setBusy(true);
    setError(null);
    const result = await undoBoardStroke(db, commit, randomUUID(), roomId);
    setBusy(false);
    if (!result.ok) setError(result.message);
    await reload();
  }

  async function confirmAndClear() {
    if (!roomId || busy) return;
    setBusy(true);
    setError(null);
    const result = await clearBoard(db, commit, randomUUID, roomId);
    setBusy(false);
    setConfirmClear(false);
    if (!result.ok) setError(result.message);
    await reload();
  }

  function leave() {
    if (router.canGoBack()) router.back();
    else if (roomId) router.replace(`/rooms/${roomId}`);
  }

  if (loading) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1 }}>
          <ActivityIndicator style={{ marginTop: 40 }} />
        </SafeAreaView>
      </Screen>
    );
  }

  if (!roomId || missing || !board) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{ padding: 24, gap: 16 }}>
            <Text accessibilityRole="alert" style={{ color: theme.color.text.primary }}>{error ?? 'This room was not found.'}</Text>
            <Button label="Back to rooms" onPress={() => router.replace('/')} />
          </View>
        </SafeAreaView>
      </Screen>
    );
  }

  const savedCount = board.strokes.length;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} testID="whiteboard-screen">
        <View style={{ flex: 1, width: '100%', maxWidth: 960, alignSelf: 'center', padding: 20, gap: 12 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to room" onPress={leave} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>← {board.roomName}</Text>
          </Pressable>
          <Text accessibilityRole="header" style={[theme.text('screenTitle'), { color: theme.color.text.primary }]}>Whiteboard</Text>
          <Text style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>
            {savedCount === 0 ? 'No saved strokes' : `${savedCount} saved ${savedCount === 1 ? 'stroke' : 'strokes'}`}
          </Text>
          {confirmClear ? (
            <View style={{ gap: 8 }}>
              <Text style={[theme.text('body'), { color: theme.color.text.primary }]}>Clear every saved stroke in this room?</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Button label="Clear strokes" variant="danger" disabled={busy} onPress={() => void confirmAndClear()} />
                <Button label="Cancel" variant="ghost" onPress={() => setConfirmClear(false)} />
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Button label="Undo" variant="outline" disabled={busy || savedCount === 0 || hold !== null} onPress={() => void undo()} />
              <Button label="Clear" variant="danger" disabled={busy || savedCount === 0 || hold !== null} onPress={() => setConfirmClear(true)} />
            </View>
          )}
          {error ? <Text accessibilityRole="alert" style={[theme.text('bodySmall'), { color: theme.color.status.danger.text }]}>{error}</Text> : null}
          {hold ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {hold.kind === 'failed' ? <Button label="Retry save" disabled={busy} onPress={() => void retry()} /> : null}
              <Button label="Discard stroke" variant="ghost" onPress={discard} />
            </View>
          ) : null}
          <BoardCanvas strokes={board.strokes} draft={draft.points} interactive={!busy && hold === null} onGesture={onGesture} />
        </View>
      </SafeAreaView>
    </Screen>
  );
}

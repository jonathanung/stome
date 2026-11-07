import { randomUUID } from 'expo-crypto';
import { Link, usePathname } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import { createCommit } from '../../data/commit';
import { listRooms } from '../../data/queries';
import { expoDriver } from '../../db/expo-driver';
import {
  CAPTURE_DRAFT_KEY,
  LAST_ROOM_KEY,
  canSubmit,
  captureOperation,
  emptyDraft,
  finishDraft,
  parseDraft,
  type CaptureDraft,
} from './draft';
import { CAPTURE_SHORTCUT_LABEL, isCaptureShortcut } from './shortcut';
import { chooseCaptureRoom, roomIdFromPath } from './target';

function store(kind: 'local' | 'session'): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function QuickCapture() {
  const pathname = usePathname();
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const commit = useMemo(() => createCommit(db, { now: Date.now, newId: randomUUID }), [db]);
  const theme = useStoneTheme();
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CaptureDraft>(() => parseDraft(store('session')?.getItem(CAPTURE_DRAFT_KEY) ?? null) ?? emptyDraft(randomUUID));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsRoom, setNeedsRoom] = useState(false);
  const pathRoom = roomIdFromPath(pathname);
  useEffect(() => {
    if (pathRoom) store('local')?.setItem(LAST_ROOM_KEY, pathRoom);
  }, [pathRoom]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      const match = isCaptureShortcut(
        {
          code: event.code,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          repeat: event.repeat,
        },
        document.hasFocus(),
        document.visibilityState === 'visible',
      );
      if (!match) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function remember(next: CaptureDraft) {
    setDraft(next);
    store('session')?.setItem(CAPTURE_DRAFT_KEY, JSON.stringify(next));
  }

  async function save() {
    if (!canSubmit(draft, busy)) return;
    setBusy(true);
    setError(null);
    try {
      const rooms = await listRooms(db);
      const target = chooseCaptureRoom({
        pathname,
        lastRoomId: pathRoom ?? store('local')?.getItem(LAST_ROOM_KEY) ?? null,
        roomIds: rooms.map((room) => room.id),
      });
      if ('needsRoom' in target) {
        setNeedsRoom(true);
        setError('Create a room before capturing a note.');
        return;
      }
      setNeedsRoom(false);
      const result = await commit(captureOperation(draft, target.roomId));
      if (!result.ok) {
        setFailed(true);
        setError(result.error.message);
        return;
      }
      setFailed(false);
      remember(finishDraft(draft, true, randomUUID));
      setOpen(false);
    } catch (reason) {
      setFailed(true);
      setError(reason instanceof Error ? reason.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const field = {
    borderWidth: 1 as const,
    borderColor: theme.color.border.strong,
    borderRadius: theme.radius.control,
    backgroundColor: theme.color.bg.surface,
    color: theme.color.text.primary,
    fontSize: 16,
    padding: 12,
  };
  const layer = {
    position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as 'absolute',
    right: 16,
    bottom: 16,
    zIndex: 30,
    width: 320,
    gap: 8,
  };

  return (
    <View pointerEvents="box-none" style={layer} testID="quick-capture">
      {open ? (
        <View
          style={{
            backgroundColor: theme.color.bg.surface,
            borderColor: theme.color.border.hairline,
            borderRadius: theme.radius.card,
            borderWidth: 1,
            gap: 8,
            padding: 12,
          }}
          testID="quick-capture-panel"
        >
          <Text style={{ color: theme.color.text.primary, fontSize: 16, fontWeight: '600' }}>Quick capture</Text>
          <TextInput
            accessibilityLabel="Quick capture note"
            autoCapitalize="sentences"
            onChangeText={(text) => {
              setNeedsRoom(false);
              setError(null);
              remember({ text, opId: draft.opId });
            }}
            onSubmitEditing={() => { void save(); }}
            placeholder="One line for this room"
            placeholderTextColor={theme.color.text.tertiary}
            ref={inputRef}
            style={field}
            testID="quick-capture-input"
            value={draft.text}
          />
          {needsRoom ? (
            <Link href="/" style={{ color: theme.color.text.primary, textDecorationLine: 'underline' }} testID="quick-capture-create-room">
              Create a room
            </Link>
          ) : null}
          {error ? <Text accessibilityRole="alert" style={{ color: theme.color.status.danger.text }} testID="quick-capture-error">{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={failed ? 'Retry capture' : 'Save capture'}
            disabled={!canSubmit(draft, busy)}
            onPress={() => { void save(); }}
            style={{
              alignSelf: 'flex-start',
              backgroundColor: canSubmit(draft, busy) ? theme.color.accent.bg : theme.color.bg.inset,
              borderRadius: theme.radius.control,
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
            testID={failed ? 'quick-capture-retry' : 'quick-capture-save'}
          >
            <Text style={{ color: canSubmit(draft, busy) ? theme.color.accent.fg : theme.color.text.disabled, fontSize: 16 }}>
              {failed ? 'Retry' : 'Save'}
            </Text>
          </Pressable>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Quick capture"
        onPress={() => setOpen((value) => !value)}
        style={{
          alignSelf: 'flex-end',
          backgroundColor: theme.color.accent.bg,
          borderRadius: theme.radius.control,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
        testID="quick-capture-button"
      >
        <Text style={{ color: theme.color.accent.fg, fontSize: 16 }}>Capture ({CAPTURE_SHORTCUT_LABEL})</Text>
      </Pressable>
    </View>
  );
}

import { randomUUID } from 'expo-crypto';
import { Link, usePathname } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import { createCommit } from '../../data/commit';
import { listRooms } from '../../data/queries';
import { expoDriver } from '../../db/expo-driver';
import { LAST_ROOM_KEY, canSubmit } from './draft';
import { CAPTURE_SHORTCUT_LABEL, isCaptureShortcut } from './shortcut';
import {
  CLEANUP_FAILED_MESSAGE,
  STORAGE_DEGRADED_MESSAGE,
  createCaptureController,
  loadCaptureState,
  readStorageItem,
  writeStorageItem,
  type CaptureSession,
  type CaptureStorage,
} from './session';
import { chooseCaptureRoom, roomIdFromPath } from './target';

function browserStorage(kind: 'local' | 'session'): CaptureStorage | null {
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
  const pathRoom = roomIdFromPath(pathname);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<CaptureSession>(() => loadCaptureState(browserStorage('session'), randomUUID));
  const [controller] = useState(() => createCaptureController({
    storage: browserStorage('session'),
    newId: randomUUID,
    initial: session,
    onChange: (next) => setSession(next),
    commit: async () => ({ ok: false, message: 'Could not save' }),
    destination: async () => ({ needsRoom: true }),
  }));

  useEffect(() => {
    controller.setLive({
      commit: async (operation) => {
        try {
          const result = await commit(operation);
          if (!result.ok) return { ok: false, message: result.error.message };
          return { ok: true, duplicate: result.duplicate };
        } catch (reason) {
          return { ok: false, message: reason instanceof Error ? reason.message : 'Could not save' };
        }
      },
      destination: async () => {
        const rooms = await listRooms(db);
        const last = readStorageItem(browserStorage('local'), LAST_ROOM_KEY);
        if (!last.ok) controller.markDegraded();
        const target = chooseCaptureRoom({
          pathname,
          lastRoomId: pathRoom ?? (last.ok ? last.value : null),
          roomIds: rooms.map((room) => room.id),
        });
        if ('needsRoom' in target) return { needsRoom: true };
        return { roomId: target.roomId };
      },
    });
  }, [controller, db, commit, pathname, pathRoom]);

  useEffect(() => {
    if (!pathRoom) return;
    const stored = writeStorageItem(browserStorage('local'), LAST_ROOM_KEY, pathRoom);
    controller.observeRoom(pathRoom, stored);
  }, [controller, pathRoom]);

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

  async function save() {
    const result = await controller.save();
    if (result.closePanel) setOpen(false);
  }

  const failed = session.notice?.kind === 'error';
  const needsRoom = session.notice?.kind === 'needs-room';
  const error = session.notice?.kind === 'error'
    ? session.notice.message
    : needsRoom
      ? 'Create a room before capturing a note.'
      : null;
  const warning = session.notice?.kind === 'degraded'
    ? STORAGE_DEGRADED_MESSAGE
    : session.notice?.kind === 'saved' && session.notice.cleanupFailed
      ? CLEANUP_FAILED_MESSAGE
      : null;
  const ready = canSubmit(session.draft, session.busy);
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
            onChangeText={(text) => controller.edit(text)}
            onSubmitEditing={() => { void save(); }}
            placeholder="One line for this room"
            placeholderTextColor={theme.color.text.tertiary}
            ref={inputRef}
            style={field}
            testID="quick-capture-input"
            value={session.draft.text}
          />
          {needsRoom ? (
            <Link href="/" style={{ color: theme.color.text.primary, textDecorationLine: 'underline' }} testID="quick-capture-create-room">
              Create a room
            </Link>
          ) : null}
          {error ? <Text accessibilityRole="alert" style={{ color: theme.color.status.danger.text }} testID="quick-capture-error">{error}</Text> : null}
          {warning ? <Text accessibilityRole="alert" style={{ color: theme.color.status.warning.text }} testID="quick-capture-warning">{warning}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={failed ? 'Retry capture' : 'Save capture'}
            disabled={!ready}
            onPress={() => { void save(); }}
            style={{
              alignSelf: 'flex-start',
              backgroundColor: ready ? theme.color.accent.bg : theme.color.bg.inset,
              borderRadius: theme.radius.control,
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
            testID={failed ? 'quick-capture-retry' : 'quick-capture-save'}
          >
            <Text style={{ color: ready ? theme.color.accent.fg : theme.color.text.disabled, fontSize: 16 }}>
              {failed ? 'Retry' : 'Save'}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {warning && !open ? (
        <Text accessibilityRole="alert" style={{ color: theme.color.status.warning.text }} testID="quick-capture-warning">{warning}</Text>
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

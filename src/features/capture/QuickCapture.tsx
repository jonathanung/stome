import { randomUUID } from 'expo-crypto';
import { Link, usePathname } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Platform, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import { createCommit } from '../../data/commit';
import { Icon } from '../../ui/Icon';
import { Field, Notice } from '../../ui/kit';
import { listRooms } from '../../data/queries';
import { expoDriver } from '../../db/expo-driver';
import { LAST_ROOM_KEY, canSubmit } from './draft';
import { captureLayerGeometry } from './geometry';
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

// React Native defines `window` as the global object without DOM APIs, so gate on web, not on `window`.
function browserStorage(kind: 'local' | 'session'): CaptureStorage | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
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
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
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
    try {
      const result = await controller.save();
      if (result.closePanel) setOpen(false);
    } catch {
      // The controller settles its own busy flag. Nothing here may reject into the press handler.
    }
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
  const viewportWidth = useWindowDimensions().width;
  const geometry = captureLayerGeometry(viewportWidth, { inset: theme.space.base });
  const layer = {
    position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as 'absolute',
    right: geometry.right,
    bottom: theme.space.section,
    zIndex: 30,
    width: geometry.width,
    gap: theme.space.md,
  };

  return (
    <View pointerEvents="box-none" style={layer} testID="quick-capture">
      {open ? (
        <View
          style={{
            backgroundColor: theme.color.bg.surface,
            borderColor: theme.color.border.hairline,
            borderRadius: theme.radius.float,
            borderWidth: 1,
            gap: theme.space.xl,
            padding: theme.space.base,
            ...theme.shadow.float,
          }}
          testID="quick-capture-panel"
        >
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Text style={[theme.text('cardTitle'), { color: theme.color.text.primary }]}>Quick capture</Text>
            {Platform.OS === 'web' ? <Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>{CAPTURE_SHORTCUT_LABEL}</Text> : null}
          </View>
          <Field
            accessibilityLabel="Quick capture note"
            autoCapitalize="sentences"
            onChangeText={(text) => controller.edit(text)}
            onSubmitEditing={() => { void save(); }}
            placeholder="One line for this room"
            ref={inputRef}
            returnKeyType="done"
            testID="quick-capture-input"
            value={session.draft.text}
          />
          {needsRoom ? (
            <Link href="/" style={[theme.text('bodySmall'), { color: theme.color.text.primary, textDecorationLine: 'underline' }]} testID="quick-capture-create-room">
              Create a room
            </Link>
          ) : null}
          {error ? <Notice tone="danger" testID="quick-capture-error">{error}</Notice> : null}
          {warning ? <Notice tone="warning" testID="quick-capture-warning">{warning}</Notice> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: theme.space.md }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setOpen(false)}
              style={({ pressed }) => ({ minHeight: theme.layout.control, paddingHorizontal: theme.space.base, borderRadius: theme.radius.lg, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={[theme.text('buttonCompact'), { color: theme.color.text.secondary }]}>Close</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={failed ? 'Retry capture' : 'Save capture'}
              accessibilityState={{ disabled: !ready }}
              disabled={!ready}
              onPress={() => { void save(); }}
              style={{
                minHeight: theme.layout.control,
                justifyContent: 'center',
                backgroundColor: ready ? theme.color.accent.bg : theme.color.bg.inset,
                borderRadius: theme.radius.lg,
                paddingHorizontal: theme.layout.buttonCompactPadX,
              }}
              testID={failed ? 'quick-capture-retry' : 'quick-capture-save'}
            >
              <Text style={[theme.text('buttonCompact'), { color: ready ? theme.color.accent.fg : theme.color.text.disabled }]}>
                {failed ? 'Retry' : 'Save'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {warning && !open ? <Notice tone="warning" testID="quick-capture-warning">{warning}</Notice> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Quick capture"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => ({
          alignSelf: 'flex-end',
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space.md,
          minHeight: 52,
          paddingLeft: theme.space.base,
          paddingRight: theme.space.card,
          backgroundColor: theme.color.accent.bg,
          borderRadius: theme.radius.pill,
          opacity: pressed ? 0.85 : 1,
          ...theme.shadow.float,
        })}
        testID="quick-capture-button"
      >
        <Icon name={open ? 'cross' : 'plus'} size={20} strokeWidth={2} color={theme.color.accent.fg} />
        <Text style={[theme.text('buttonCompact'), { color: theme.color.accent.fg }]}>Capture</Text>
      </Pressable>
    </View>
  );
}

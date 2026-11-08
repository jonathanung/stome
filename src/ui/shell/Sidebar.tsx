import { Link, usePathname, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import { requestCaptureOpen } from '../../features/capture/openSignal';
import { CAPTURE_SHORTCUT_LABEL } from '../../features/capture/shortcut';
import type { Room } from '../../data/models';
import { listDueChunks, listRooms } from '../../data/queries';
import { expoDriver } from '../../db/expo-driver';
import { Icon, type IconName } from '../Icon';
import { StageGlyph } from '../StageGlyph';

// The sidebar is "bark": a dark brown panel in both schemes, so these are not scheme tokens.
const BARK = { bg: '#3d2f24', fg: '#efe6d6', muted: '#c9b9a3', line: '#1c1a17' };

const NAV: { key: string; label: string; href: Href; icon: IconName; match: (p: string) => boolean }[] = [
  { key: 'today', label: 'Today', href: '/today', icon: 'today', match: (p) => p.startsWith('/today') },
  { key: 'rooms', label: 'Rooms', href: '/', icon: 'note', match: (p) => p === '/' || p.startsWith('/rooms') },
  { key: 'recent', label: 'Recent', href: '/recent', icon: 'clock', match: (p) => p.startsWith('/recent') },
  { key: 'import', label: 'Import', href: '/import', icon: 'upload', match: (p) => p.startsWith('/import') },
  { key: 'stone', label: 'Stone home', href: '/stone', icon: 'spark', match: (p) => p.startsWith('/stone') },
];

/** Rooms and due count for the nav. Refreshes whenever the route changes. */
function useShellData(pathname: string) {
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [due, setDue] = useState(0);
  useEffect(() => {
    let live = true;
    Promise.all([listRooms(db), listDueChunks(db, Date.now())]).then(([r, d]) => {
      if (live) { setRooms(r); setDue(d.length); }
    }).catch(() => undefined);
    return () => { live = false; };
  }, [db, pathname]);
  return { rooms, due };
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const theme = useStoneTheme();
  const pathname = usePathname();
  const { rooms, due } = useShellData(pathname);
  const width = collapsed ? theme.layout.rail : theme.layout.sidebar;
  const activeRoom = /^\/rooms\/([^/]+)/.exec(pathname)?.[1] ?? null;

  return (
    <View testID="app-sidebar" style={{
      width, backgroundColor: BARK.bg, borderRightWidth: 4, borderRightColor: BARK.line,
      paddingVertical: 20, paddingHorizontal: collapsed ? 8 : 16, gap: 4,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', paddingBottom: 10 }}>
        {collapsed ? null : <Link href="/" accessibilityLabel="stome home" style={[theme.text('brand'), { color: BARK.fg, paddingHorizontal: 8 }]}>stome</Link>}
        <Pressable accessibilityRole="button" accessibilityLabel={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onPress={onToggle}
          style={{ width: 36, height: 36, borderRadius: theme.radius.control, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={18} color={BARK.muted} />
        </Pressable>
      </View>

      {NAV.map((item) => {
        const on = item.match(pathname);
        const fg = on ? theme.color.accent.bg : BARK.muted;
        return (
          <Link key={item.key} href={item.href} asChild>
            <Pressable accessibilityRole="link" accessibilityLabel={item.label} accessibilityState={{ selected: on }}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: theme.layout.navItem, paddingHorizontal: 10,
                justifyContent: collapsed ? 'center' : 'flex-start', borderRadius: 12,
                backgroundColor: on ? theme.color.status.success.wash : 'transparent',
              }}>
              <Icon name={item.icon} size={20} color={fg} />
              {collapsed ? null : <Text style={[theme.text('nav'), { color: fg }]}>{item.label}</Text>}
              {item.key === 'today' && due > 0 && !collapsed ? (
                <View style={{ marginLeft: 'auto', minWidth: 22, height: 20, paddingHorizontal: 6, borderRadius: 999, backgroundColor: theme.color.status.warning.fill, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={[theme.text('label'), { color: theme.color.text.onFill }]}>{due}</Text>
                </View>
              ) : null}
            </Pressable>
          </Link>
        );
      })}

      {collapsed ? null : <Text style={[theme.text('label'), { color: BARK.muted, letterSpacing: 0.8, marginTop: 16, marginBottom: 4, paddingHorizontal: 10 }]}>ROOMS</Text>}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 2, paddingTop: collapsed ? 12 : 0 }}>
        {rooms.map((room) => {
          const on = room.id === activeRoom;
          return (
            <Link key={room.id} href={`/rooms/${room.id}`} asChild>
              <Pressable accessibilityRole="link" accessibilityLabel={`Open ${room.name}`} accessibilityState={{ selected: on }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: theme.layout.spaceRow, paddingHorizontal: 10,
                  justifyContent: collapsed ? 'center' : 'flex-start', borderRadius: 10,
                  backgroundColor: on ? theme.color.status.success.wash : 'transparent',
                }}>
                <StageGlyph stage={room.stage} size={22} />
                {collapsed ? null : <Text numberOfLines={1} style={[theme.text('bodySmall'), { color: on ? theme.color.accent.bg : BARK.muted, flex: 1 }]}>{room.name}</Text>}
              </Pressable>
            </Link>
          );
        })}
      </ScrollView>

      <Pressable accessibilityRole="button" accessibilityLabel="Quick capture" onPress={requestCaptureOpen}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: theme.layout.control, paddingHorizontal: 10, justifyContent: collapsed ? 'center' : 'flex-start', borderRadius: 12, borderWidth: 1, borderColor: BARK.muted }}>
        <Icon name="plus" size={18} color={BARK.fg} />
        {collapsed ? null : <>
          <Text style={[theme.text('nav'), { color: BARK.fg }]}>Quick capture</Text>
          <Text style={[theme.text('label'), { color: BARK.muted, marginLeft: 'auto' }]}>{CAPTURE_SHORTCUT_LABEL}</Text>
        </>}
      </Pressable>
      <Link href="/companion" asChild>
        <Pressable accessibilityRole="link" accessibilityLabel="Companion"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: theme.layout.navItem, paddingHorizontal: 10, justifyContent: collapsed ? 'center' : 'flex-start' }}>
          <Icon name="chat" size={18} color={BARK.muted} />
          {collapsed ? null : <Text style={[theme.text('bodySmall'), { color: BARK.muted }]}>Companion</Text>}
        </Pressable>
      </Link>
    </View>
  );
}

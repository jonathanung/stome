import { router, usePathname } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';

import { requestCaptureOpen } from '../../features/capture/openSignal';
import { Sidebar } from './Sidebar';
import { TabBar, type TabKey } from './TabBar';

/** Below this width the phone tab bar replaces the sidebar. */
export const SIDEBAR_MIN_WIDTH = 760;

const TAB_ROUTES: Record<TabKey, string> = { today: '/today', rooms: '/', recent: '/recent', search: '/recent' };

function activeTab(pathname: string): TabKey {
  if (pathname.startsWith('/today')) return 'today';
  if (pathname.startsWith('/recent')) return 'recent';
  return 'rooms';
}

export function AppShell({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  if (width < SIDEBAR_MIN_WIDTH) {
    return (
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
        <TabBar active={activeTab(pathname)} onSelect={(tab) => router.navigate(TAB_ROUTES[tab])} onCapture={requestCaptureOpen} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </View>
  );
}

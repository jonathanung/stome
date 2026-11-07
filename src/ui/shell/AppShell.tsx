import { useState, type ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';

import { Sidebar } from './Sidebar';

/** Below this width the phone tab bar replaces the sidebar (wired separately). */
export const SIDEBAR_MIN_WIDTH = 760;

export function AppShell({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const [collapsed, setCollapsed] = useState(false);
  if (width < SIDEBAR_MIN_WIDTH) return <>{children}</>;
  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </View>
  );
}

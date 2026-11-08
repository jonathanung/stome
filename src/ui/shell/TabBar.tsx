import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Rect } from 'react-native-svg';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import { Icon, type IconName } from '../Icon';

export type TabKey = 'today' | 'rooms' | 'recent' | 'search';

export interface TabBarProps {
  /** The tab for the current route. */
  active: TabKey;
  onSelect: (tab: TabKey) => void;
}

function RoomsGlyph({ color }: { color: string }) {
  return (
    <Svg width={26} height={18} viewBox="0 0 72 48" aria-hidden>
      <Rect x={4} y={2} width={64} height={11} rx={2} fill={color} />
      <Rect x={9} y={16} width={16} height={32} rx={2} fill={color} />
      <Rect x={47} y={16} width={16} height={32} rx={2} fill={color} />
    </Svg>
  );
}

function Tab({ tab, label, icon, active, onSelect }: {
  tab: TabKey; label: string; icon?: IconName; active: boolean; onSelect: (tab: TabKey) => void;
}) {
  const theme = useStoneTheme();
  // Bark bar is the inverse surface, so its text uses the inverse-on color (canvas).
  const color = active ? theme.color.bg.canvas : theme.color.border.hairline;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={() => onSelect(tab)}
      testID={`tab-${tab}`}
      style={({ pressed }) => ({
        minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: theme.space.xxs,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {icon ? <Icon name={icon} size={24} color={color} /> : <RoomsGlyph color={color} />}
      <Text style={[theme.text('label'), { color, fontWeight: active ? '700' : '500' }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Phone version of the sidebar: today, rooms, recent, search.
 * Not wired into the layout here; the shell mounts it on phone widths.
 */
export function TabBar({ active, onSelect }: TabBarProps) {
  const theme = useStoneTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel="tabs"
      style={{
        flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
        paddingTop: theme.space.md, paddingHorizontal: theme.space.lg,
        paddingBottom: Math.max(insets.bottom, theme.space.lg),
        backgroundColor: theme.color.bg.inverse,
        borderTopWidth: 3, borderTopColor: theme.color.text.primary,
      }}
    >
      <Tab tab="today" label="today" icon="today" active={active === 'today'} onSelect={onSelect} />
      <Tab tab="rooms" label="rooms" active={active === 'rooms'} onSelect={onSelect} />
      <Tab tab="recent" label="recent" icon="clock" active={active === 'recent'} onSelect={onSelect} />
      <Tab tab="search" label="search" icon="search" active={active === 'search'} onSelect={onSelect} />
    </View>
  );
}

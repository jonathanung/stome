import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Ellipse, Path } from 'react-native-svg';

import { useStoneTheme } from '../../../design-theme/src/primitives';

export type PencilTool = 'touch' | 'pen' | 'highlighter' | 'lasso' | 'scribble';
export type InkColor = 'rust' | 'stone' | 'moss';

export const INK_HEX: Record<InkColor, string> = { rust: '#a3472a', stone: '#33302a', moss: '#4a6e36' };

const TOOLS: { id: PencilTool; label: string }[] = [
  { id: 'touch', label: 'finger scrolls, pencil writes' },
  { id: 'pen', label: 'pen' },
  { id: 'highlighter', label: 'highlighter' },
  { id: 'lasso', label: 'lasso' },
  { id: 'scribble', label: 'scribble to text' },
];

function ToolGlyph({ tool, color }: { tool: PencilTool; color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      {tool === 'touch' ? <><Path d="M9 11V5a2 2 0 0 1 4 0v6" /><Path d="M13 9a2 2 0 0 1 4 0v4a6 6 0 0 1-12 0v-2a2 2 0 0 1 4 0" /></> : null}
      {tool === 'pen' ? <Path d="M4 20h4L19 9l-4-4L4 16z" /> : null}
      {tool === 'highlighter' ? <><Path d="m9 11-6 6v3h3l6-6" /><Path d="m14 4 6 6-8 8-6-6z" /></> : null}
      {tool === 'lasso' ? <Ellipse cx="12" cy="10" rx="8" ry="6" strokeDasharray="3 3" strokeLinecap="butt" /> : null}
      {tool === 'scribble' ? <Path d="M3 17c3-6 5-6 6-2s3 4 5-1 4-5 7 1" /> : null}
    </Svg>
  );
}

/** Floating pencil tool bar for the iPad room. Selection is local state until ink capture exists. */
export function PencilToolbar({ onChange }: { onChange?: (tool: PencilTool, ink: InkColor) => void }) {
  const theme = useStoneTheme();
  const [tool, setTool] = useState<PencilTool>('pen');
  const [ink, setInk] = useState<InkColor>('stone');
  const size = theme.layout.control;
  return (
    <View accessibilityRole="toolbar" accessibilityLabel="pencil tools" testID="pencil-toolbar" style={{
      position: 'absolute', bottom: 20, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: theme.space.xs,
      padding: theme.space.sm, borderRadius: 18, backgroundColor: theme.color.bg.surface,
      borderWidth: 1, borderColor: theme.color.border.hairline, ...theme.shadow.float,
    }}>
      {TOOLS.map((item) => {
        const on = item.id === tool;
        return (
          <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.label}
            accessibilityState={{ selected: on }}
            onPress={() => { setTool(item.id); onChange?.(item.id, ink); }}
            style={{
              width: size, height: size, alignItems: 'center', justifyContent: 'center',
              borderRadius: theme.radius.control, backgroundColor: on ? theme.color.accent.bg : 'transparent',
            }}>
            <ToolGlyph tool={item.id} color={on ? theme.color.accent.fg : theme.color.text.secondary} />
          </Pressable>
        );
      })}
      <View style={{ width: 1, height: 28, backgroundColor: theme.color.border.hairline, marginHorizontal: theme.space.sm }} />
      {(Object.keys(INK_HEX) as InkColor[]).map((color) => (
        <Pressable key={color} accessibilityRole="button" accessibilityLabel={`${color} ink`}
          accessibilityState={{ selected: ink === color }} hitSlop={8}
          onPress={() => { setInk(color); onChange?.(tool, color); }}
          style={{
            width: 28, height: 28, borderRadius: 14, backgroundColor: INK_HEX[color], marginHorizontal: 2,
            borderWidth: 3, borderColor: ink === color ? theme.color.text.primary : theme.color.bg.surface,
          }} />
      ))}
    </View>
  );
}

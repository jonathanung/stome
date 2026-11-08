import { Pressable, StyleSheet, View } from 'react-native';

import { useStoneTheme } from '../../design-theme/src/primitives';
import { Icon, type IconName } from '../ui/Icon';
import type { Tool } from './types';

type ToolConfig = {
  id: Tool;
  label: string;
  icon: IconName;
};

const TOOLS: ToolConfig[] = [
  { id: 'select', label: 'Select', icon: 'select' },
  { id: 'hand', label: 'Hand', icon: 'hand' },
  { id: 'freedraw', label: 'Draw', icon: 'draw' },
  { id: 'rectangle', label: 'Rectangle', icon: 'rectangle' },
  { id: 'diamond', label: 'Diamond', icon: 'diamond' },
  { id: 'ellipse', label: 'Ellipse', icon: 'ellipse' },
  { id: 'line', label: 'Line', icon: 'lineSegment' },
  { id: 'arrow', label: 'Arrow', icon: 'arrowRight' },
  { id: 'text', label: 'Text', icon: 'textT' },
];

type Props = {
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

export function Toolbar({
  activeTool,
  onToolChange,
  onUndo,
  onRedo,
  onClear,
  canUndo,
  canRedo,
}: Props) {
  const theme = useStoneTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.color.bg.surface, shadowColor: theme.color.text.primary }]}>
      <View style={styles.toolGroup}>
        {TOOLS.map((tool) => {
          const active = activeTool === tool.id;
          return (
            <Pressable
              key={tool.id}
              style={[styles.toolButton, active && { backgroundColor: theme.color.bg.inset }]}
              onPress={() => onToolChange(tool.id)}
              accessibilityRole="button"
              accessibilityLabel={tool.label}
              accessibilityState={{ selected: active }}
            >
              <Icon
                name={tool.icon}
                size={20}
                color={active ? theme.color.text.primary : theme.color.text.secondary}
                strokeWidth={active ? 2.25 : 1.75}
              />
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.divider, { backgroundColor: theme.color.border.hairline }]} />

      <View style={styles.actionGroup}>
        <Pressable
          style={[styles.actionButton, !canUndo && styles.actionButtonDisabled]}
          onPress={onUndo}
          disabled={!canUndo}
          accessibilityLabel="Undo"
        >
          <Icon name="undo" size={20} color={canUndo ? theme.color.text.secondary : theme.color.text.disabled} />
        </Pressable>
        <Pressable
          style={[styles.actionButton, !canRedo && styles.actionButtonDisabled]}
          onPress={onRedo}
          disabled={!canRedo}
          accessibilityLabel="Redo"
        >
          <Icon name="redo" size={20} color={canRedo ? theme.color.text.secondary : theme.color.text.disabled} />
        </Pressable>
        <Pressable
          style={styles.actionButton}
          onPress={onClear}
          accessibilityLabel="Clear canvas"
        >
          <Icon name="trash" size={20} color={theme.color.text.secondary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    borderRadius: 12,
    elevation: 8,
    flexDirection: 'row',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 6,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  toolGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  toolButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  divider: {
    height: 24,
    marginHorizontal: 4,
    width: 1,
  },
  actionGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  actionButtonDisabled: {
    opacity: 0.3,
  },
});

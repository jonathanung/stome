import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Tool } from './types';

type ToolConfig = {
  id: Tool;
  label: string;
  icon: string;
};

const TOOLS: ToolConfig[] = [
  { id: 'select', label: 'Select', icon: '↖' },
  { id: 'hand', label: 'Hand', icon: '✋' },
  { id: 'freedraw', label: 'Draw', icon: '✏️' },
  { id: 'rectangle', label: 'Rectangle', icon: '▭' },
  { id: 'diamond', label: 'Diamond', icon: '◇' },
  { id: 'ellipse', label: 'Ellipse', icon: '○' },
  { id: 'line', label: 'Line', icon: '╱' },
  { id: 'arrow', label: 'Arrow', icon: '→' },
  { id: 'text', label: 'Text', icon: 'T' },
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
  return (
    <View style={styles.container}>
      <View style={styles.toolGroup}>
        {TOOLS.map((tool) => (
          <Pressable
            key={tool.id}
            style={[styles.toolButton, activeTool === tool.id && styles.toolButtonActive]}
            onPress={() => onToolChange(tool.id)}
            accessibilityRole="button"
            accessibilityLabel={tool.label}
            accessibilityState={{ selected: activeTool === tool.id }}
          >
            <Text style={[styles.toolIcon, activeTool === tool.id && styles.toolIconActive]}>
              {tool.icon}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.divider} />

      <View style={styles.actionGroup}>
        <Pressable
          style={[styles.actionButton, !canUndo && styles.actionButtonDisabled]}
          onPress={onUndo}
          disabled={!canUndo}
          accessibilityLabel="Undo"
        >
          <Text style={[styles.actionIcon, !canUndo && styles.actionIconDisabled]}>↩</Text>
        </Pressable>
        <Pressable
          style={[styles.actionButton, !canRedo && styles.actionButtonDisabled]}
          onPress={onRedo}
          disabled={!canRedo}
          accessibilityLabel="Redo"
        >
          <Text style={[styles.actionIcon, !canRedo && styles.actionIconDisabled]}>↪</Text>
        </Pressable>
        <Pressable
          style={styles.actionButton}
          onPress={onClear}
          accessibilityLabel="Clear canvas"
        >
          <Text style={styles.actionIcon}>🗑</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    elevation: 8,
    flexDirection: 'row',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 6,
    shadowColor: '#000',
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
  toolButtonActive: {
    backgroundColor: '#e7f5ff',
  },
  toolIcon: {
    color: '#495057',
    fontSize: 18,
  },
  toolIconActive: {
    color: '#1971c2',
  },
  divider: {
    backgroundColor: '#dee2e6',
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
  actionIcon: {
    color: '#495057',
    fontSize: 18,
  },
  actionIconDisabled: {
    color: '#adb5bd',
  },
});

import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { useStoneTheme } from '../../design-theme/src/primitives';
import type { BackgroundPattern, BackgroundSize } from './types';

type Props = {
  pattern: BackgroundPattern;
  size: BackgroundSize;
  onPatternChange: (p: BackgroundPattern) => void;
  onSizeChange: (s: BackgroundSize) => void;
};

function PatternPreview({ pattern, active }: { pattern: BackgroundPattern; active: boolean }) {
  const lineColor = active ? '#1e1e2e' : '#adb5bd';
  const bg = active ? '#e9ecef' : '#f8f9fa';
  return (
    <Svg width={36} height={36} viewBox="0 0 36 36">
      <Rect x={0} y={0} width={36} height={36} rx={6} fill={bg} />
      {pattern === 'dots' && (
        <>
          {[9, 18, 27].flatMap((x) =>
            [9, 18, 27].map((y) => (
              <Circle key={`${x}-${y}`} cx={x} cy={y} r={1.5} fill={lineColor} />
            )),
          )}
        </>
      )}
      {pattern === 'lines' && (
        <>
          <Line x1={4} y1={9} x2={32} y2={9} stroke={lineColor} strokeWidth={1} />
          <Line x1={4} y1={18} x2={32} y2={18} stroke={lineColor} strokeWidth={1} />
          <Line x1={4} y1={27} x2={32} y2={27} stroke={lineColor} strokeWidth={1} />
        </>
      )}
      {pattern === 'grid' && (
        <>
          <Line x1={4} y1={9} x2={32} y2={9} stroke={lineColor} strokeWidth={0.75} />
          <Line x1={4} y1={18} x2={32} y2={18} stroke={lineColor} strokeWidth={0.75} />
          <Line x1={4} y1={27} x2={32} y2={27} stroke={lineColor} strokeWidth={0.75} />
          <Line x1={9} y1={4} x2={9} y2={32} stroke={lineColor} strokeWidth={0.75} />
          <Line x1={18} y1={4} x2={18} y2={32} stroke={lineColor} strokeWidth={0.75} />
          <Line x1={27} y1={4} x2={27} y2={32} stroke={lineColor} strokeWidth={0.75} />
        </>
      )}
      {pattern === 'blank' && (
        <Path d="M8 18h20M18 8v20" stroke={lineColor} strokeWidth={1} strokeOpacity={0.4} />
      )}
    </Svg>
  );
}

const PATTERNS: { id: BackgroundPattern; label: string }[] = [
  { id: 'blank', label: 'Blank' },
  { id: 'dots', label: 'Dots' },
  { id: 'lines', label: 'Lines' },
  { id: 'grid', label: 'Grid' },
];

const SIZES: { id: BackgroundSize; label: string }[] = [
  { id: 'small', label: 'S' },
  { id: 'medium', label: 'M' },
  { id: 'large', label: 'L' },
];

export function BackgroundPicker({ pattern, size, onPatternChange, onSizeChange }: Props) {
  const theme = useStoneTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.color.bg.surface, shadowColor: theme.color.text.primary }]}>
      <Text style={[styles.label, { color: theme.color.text.tertiary }]}>BACKGROUND</Text>
      <View style={styles.row}>
        {PATTERNS.map((p) => {
          const active = pattern === p.id;
          return (
            <Pressable
              key={p.id}
              onPress={() => onPatternChange(p.id)}
              accessibilityLabel={p.label}
              accessibilityState={{ selected: active }}
              style={[styles.patternButton, active && { borderColor: theme.color.text.primary, borderWidth: 2 }]}
            >
              <PatternPreview pattern={p.id} active={active} />
              <Text style={[styles.patternLabel, { color: active ? theme.color.text.primary : theme.color.text.secondary }]}>
                {p.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {pattern !== 'blank' && (
        <>
          <Text style={[styles.label, { color: theme.color.text.tertiary, marginTop: 8 }]}>SIZE</Text>
          <View style={styles.sizeRow}>
            {SIZES.map((s) => {
              const active = size === s.id;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => onSizeChange(s.id)}
                  accessibilityLabel={s.label}
                  accessibilityState={{ selected: active }}
                  style={[styles.sizeButton, { backgroundColor: active ? theme.color.bg.inset : 'transparent', borderColor: theme.color.border.hairline }]}
                >
                  <Text style={[styles.sizeLabel, { color: active ? theme.color.text.primary : theme.color.text.secondary, fontWeight: active ? '600' : '400' }]}>
                    {s.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    elevation: 8,
    padding: 12,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    width: 220,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  patternButton: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 2,
    gap: 4,
    padding: 2,
  },
  patternLabel: {
    fontSize: 10,
  },
  sizeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  sizeButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 6,
  },
  sizeLabel: {
    fontSize: 13,
  },
});

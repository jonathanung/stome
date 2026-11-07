import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { StrokeStyle } from './types';
import { EXCALIDRAW_COLORS } from './types';

export type ElementStyle = {
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
};

type Props = {
  style: ElementStyle;
  onChange: (patch: Partial<ElementStyle>) => void;
};

const STROKE_WIDTHS = [1, 2, 4];
const STROKE_STYLES: { id: StrokeStyle; label: string }[] = [
  { id: 'solid', label: '—' },
  { id: 'dashed', label: '- -' },
  { id: 'dotted', label: '···' },
];

export function StylePanel({ style, onChange }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Stroke</Text>
      <View style={styles.row}>
        {EXCALIDRAW_COLORS.stroke.map((color) => (
          <Pressable
            key={color}
            style={[
              styles.swatch,
              { backgroundColor: color },
              style.strokeColor === color && styles.swatchSelected,
            ]}
            onPress={() => onChange({ strokeColor: color })}
            accessibilityLabel={`Stroke color ${color}`}
          />
        ))}
      </View>

      <Text style={styles.label}>Fill</Text>
      <View style={styles.row}>
        {EXCALIDRAW_COLORS.fill.map((color) => (
          <Pressable
            key={color}
            style={[
              styles.swatch,
              {
                backgroundColor: color === 'transparent' ? '#fff' : color,
                borderStyle: color === 'transparent' ? 'dashed' : 'solid',
              },
              style.backgroundColor === color && styles.swatchSelected,
            ]}
            onPress={() => onChange({ backgroundColor: color })}
            accessibilityLabel={`Fill color ${color}`}
          />
        ))}
      </View>

      <Text style={styles.label}>Width</Text>
      <View style={styles.row}>
        {STROKE_WIDTHS.map((w) => (
          <Pressable
            key={w}
            style={[styles.widthButton, style.strokeWidth === w && styles.widthButtonActive]}
            onPress={() => onChange({ strokeWidth: w })}
          >
            <View style={[styles.widthLine, { height: w + 1 }]} />
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Style</Text>
      <View style={styles.row}>
        {STROKE_STYLES.map((s) => (
          <Pressable
            key={s.id}
            style={[
              styles.styleButton,
              style.strokeStyle === s.id && styles.styleButtonActive,
            ]}
            onPress={() => onChange({ strokeStyle: s.id })}
          >
            <Text
              style={[
                styles.styleButtonText,
                style.strokeStyle === s.id && styles.styleButtonTextActive,
              ]}
            >
              {s.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    elevation: 8,
    gap: 6,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    width: 200,
  },
  label: {
    color: '#868e96',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  swatch: {
    borderColor: '#dee2e6',
    borderRadius: 4,
    borderWidth: 1.5,
    height: 24,
    width: 24,
  },
  swatchSelected: {
    borderColor: '#1971c2',
    borderWidth: 2.5,
  },
  widthButton: {
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 6,
    height: 28,
    justifyContent: 'center',
    width: 36,
  },
  widthButtonActive: {
    backgroundColor: '#e7f5ff',
  },
  widthLine: {
    backgroundColor: '#1e1e2e',
    borderRadius: 2,
    width: 20,
  },
  styleButton: {
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 6,
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  styleButtonActive: {
    backgroundColor: '#e7f5ff',
  },
  styleButtonText: {
    color: '#495057',
    fontSize: 13,
  },
  styleButtonTextActive: {
    color: '#1971c2',
  },
});

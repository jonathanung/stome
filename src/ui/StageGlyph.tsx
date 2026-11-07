import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { useStoneTheme } from '../../design-theme/src/primitives';
import type { RoomStage } from '../data/models';

const STAGE_NAME: Record<RoomStage, string> = {
  stonehenge: 'Stonehenge',
  brick: 'Brick',
};

export function stageName(stage: RoomStage): string {
  return STAGE_NAME[stage];
}

/**
 * The room's stone stage, drawn instead of written. A room starts as standing
 * stones and becomes a brick house once its notes are reviewed.
 */
export function StageGlyph({ stage, size = 52, onCanvas = false }: { stage: RoomStage; size?: number; onCanvas?: boolean }) {
  const theme = useStoneTheme();
  const ink = theme.color.accent.bg;
  const stone = theme.color.border.strong;
  const mortar = theme.color.bg.canvas;
  const art = Math.round(size * 0.78);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Stone stage: ${stage}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.27),
        backgroundColor: onCanvas ? theme.color.bg.surface : theme.color.bg.canvas,
        borderWidth: onCanvas ? 1 : 0,
        borderColor: theme.color.border.hairline,
        alignItems: 'center',
        justifyContent: 'flex-end',
        overflow: 'hidden',
      }}
    >
      {stage === 'brick' ? (
        <Svg width={art} height={art * 0.8} viewBox="0 0 44 36">
          <Rect x="7" y="15" width="30" height="21" fill={ink} />
          <Path d="M7 21h30M7 27h30M7 33h30M15 15v6M29 15v6M22 21v6M12 27v6M32 27v6" stroke={mortar} strokeWidth="1" />
          <Path d="M3 17 22 4l19 13z" fill={ink} />
          <Rect x="19" y="27" width="7" height="9" fill={mortar} />
        </Svg>
      ) : (
        <Svg width={art} height={art * 0.77} viewBox="0 0 44 34">
          <Rect x="8" y="12" width="8" height="22" rx="1.5" fill={stone} />
          <Rect x="28" y="12" width="8" height="22" rx="1.5" fill={stone} />
          <Rect x="5" y="5" width="34" height="6" rx="1.5" fill={stone} />
        </Svg>
      )}
    </View>
  );
}

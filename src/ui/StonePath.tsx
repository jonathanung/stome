import { View } from 'react-native';
import Svg, { G, Path, Rect } from 'react-native-svg';

import { useStoneTheme } from '../../design-theme/src/primitives';

export type PathStage = 'stonehenge' | 'drystone' | 'brick';

/** Large stage illustration for stone home. Drystone is the proposed, dashed middle stage. */
export function StagePicture({ stage, width = 150, label }: { stage: PathStage; width?: number; label: string }) {
  const theme = useStoneTheme();
  const ink = theme.color.accent.bg;
  const line = theme.color.border.strong;
  const ground = theme.color.bg.inset;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <Svg width={width} height={width * (2 / 3)} viewBox="0 0 150 100">
        <Rect y="82" width="150" height="18" rx="4" fill={ground} />
        {stage === 'stonehenge' ? (
          <G fill={ink}>
            <Rect x="30" y="30" width="18" height="52" rx="2" />
            <Rect x="74" y="30" width="18" height="52" rx="2" />
            <Rect x="24" y="18" width="74" height="12" rx="2" />
            <Rect x="108" y="40" width="16" height="42" rx="2" />
          </G>
        ) : null}
        {stage === 'drystone' ? (
          <G fill="none" stroke={line} strokeWidth="2" strokeDasharray="5 4">
            <Path d="M25 82V52h100v30" />
            <Path d="M25 66h100M50 52v14M75 52v14M100 52v14M38 66v16M62 66v16M88 66v16M112 66v16" />
          </G>
        ) : null}
        {stage === 'brick' ? (
          <>
            <Rect x="35" y="44" width="80" height="38" fill="#8a6a52" />
            <Path d="M35 54h80M35 64h80M35 74h80M55 44v10M75 44v10M95 44v10M45 54v10M65 54v10M85 54v10M105 54v10M55 64v10M95 64v10M45 74v8M105 74v8" stroke="#5c4636" strokeWidth="1" fill="none" />
            <Path d="M28 46 75 18l47 28z" fill={ink} />
            <Rect x="67" y="62" width="16" height="20" fill={ink} />
          </>
        ) : null}
      </Svg>
    </View>
  );
}

export function PathArrow() {
  const theme = useStoneTheme();
  return (
    <Svg width={40} height={20} viewBox="0 0 40 20" aria-hidden>
      <Path d="M2 10h32M28 4l6 6-6 6" fill="none" stroke={theme.color.border.strong} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

import { useStoneTheme } from '../../design-theme/src/primitives';

export type IconName =
  | 'plus'
  | 'chevronRight'
  | 'chevronLeft'
  | 'search'
  | 'clock'
  | 'today'
  | 'check'
  | 'unclear'
  | 'cross'
  | 'upload'
  | 'refresh'
  | 'review'
  | 'link'
  | 'note'
  | 'spark'
  | 'more'
  | 'hand'
  | 'pen'
  | 'highlighter'
  | 'lasso'
  | 'eraser'
  | 'sticky'
  | 'undo'
  | 'redo'
  | 'chat'
  | 'arrowUp'
  | 'fullscreen'
  | 'highlightArea'
  | 'questionPin'
  | 'addPage'
  | 'pin';

/** 24px stroke glyphs, drawn the way the Stone boards draw them (1.75 stroke, round caps). */
function Glyph({ name }: { name: IconName }) {
  switch (name) {
    case 'plus':
      return <><Path d="M12 5v14" /><Path d="M5 12h14" /></>;
    case 'chevronRight':
      return <Path d="m9 18 6-6-6-6" />;
    case 'chevronLeft':
      return <Path d="m15 18-6-6 6-6" />;
    case 'search':
      return <><Circle cx="11" cy="11" r="7" /><Path d="m20 20-3.5-3.5" /></>;
    case 'clock':
      return <><Circle cx="12" cy="12" r="8" /><Path d="M12 8v4l3 2" /></>;
    case 'today':
      return <><Rect x="4" y="4" width="16" height="16" rx="4" /><Path d="m9 12 2 2 4-4" /></>;
    case 'check':
      return <Path d="M20 6 9 17l-5-5" />;
    case 'unclear':
      return <><Path d="M12 5v9" /><Path d="M12 19h.01" /></>;
    case 'cross':
      return <><Path d="M18 6 6 18" /><Path d="m6 6 12 12" /></>;
    case 'upload':
      return <><Path d="M12 15V3" /><Path d="m7 8 5-5 5 5" /><Path d="M4 15v5h16v-5" /></>;
    case 'refresh':
      return <><Path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" /><Path d="M4 3v5h5" /><Path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" /><Path d="M20 21v-5h-5" /></>;
    case 'review':
      return <><Rect x="3" y="6" width="14" height="14" rx="3" /><Path d="M7 3h11a3 3 0 0 1 3 3v11" /></>;
    case 'link':
      return <><Path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><Path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>;
    case 'note':
      return <><Path d="M6 3h9l4 4v14H6z" /><Path d="M9 12h7" /><Path d="M9 16h5" /></>;
    case 'more':
      return <><Path d="M5 12h.01" /><Path d="M12 12h.01" /><Path d="M19 12h.01" /></>;
    case 'hand':
      return <><Path d="M9 11V5a2 2 0 0 1 4 0v6" /><Path d="M13 9a2 2 0 0 1 4 0v4a6 6 0 0 1-12 0v-2a2 2 0 0 1 4 0" /></>;
    case 'pen':
      return <Path d="M4 20h4L19 9l-4-4L4 16z" />;
    case 'highlighter':
      return <><Path d="m9 11-6 6v3h3l6-6" /><Path d="m14 4 6 6-8 8-6-6z" /></>;
    case 'lasso':
      return <Ellipse cx="12" cy="10" rx="8" ry="6" strokeDasharray="3 3" />;
    case 'eraser':
      return <Path d="m7 21-4-4 11-11 7 7-7 8z" />;
    case 'sticky':
      return <Path d="M4 4h16v10l-6 6H4z" />;
    case 'undo':
      return <><Path d="M9 14 4 9l5-5" /><Path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>;
    case 'redo':
      return <><Path d="m15 14 5-5-5-5" /><Path d="M20 9H9a5 5 0 0 0 0 10h3" /></>;
    case 'chat':
      return <Path d="M4 5h16v11H9l-5 4z" />;
    case 'arrowUp':
      return <><Path d="M12 19V5" /><Path d="m5 12 7-7 7 7" /></>;
    case 'fullscreen':
      return <Path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />;
    case 'highlightArea':
      return <Rect x="4" y="5" width="16" height="14" rx="2" strokeDasharray="3 3" />;
    case 'questionPin':
      return <Path d="M4 5h16v11H9l-5 4z" />;
    case 'addPage':
      return <><Path d="M6 3h9l4 4v14H6z" /><Path d="M12 10v6M9 13h6" /></>;
    case 'pin':
      return <><Path d="M12 17v5" /><Path d="M9 3h6l-1 6 3 3H7l3-3z" /></>;
    case 'spark':
      return <><Path d="M12 3v3" /><Path d="M12 18v3" /><Path d="M3 12h3" /><Path d="M18 12h3" /><Path d="m6 6 2 2" /><Path d="m16 16 2 2" /><Path d="m6 18 2-2" /><Path d="m16 8 2-2" /></>;
  }
}

export function Icon({
  name,
  size = 20,
  color,
  strokeWidth = 1.75,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const theme = useStoneTheme();
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? theme.color.text.secondary}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <Glyph name={name} />
    </Svg>
  );
}

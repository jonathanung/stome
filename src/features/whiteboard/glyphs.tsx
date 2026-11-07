import Svg, { Circle, Path, Rect } from 'react-native-svg';

import type { Tool } from './model';

/** Toolbar glyphs for the whiteboard (24px, round caps), kept local to this feature. */
export function ToolGlyph({ tool, size = 20, color }: { tool: Tool; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {tool === 'select' ? <Path d="m5 3 14 8-6 2-2 6z" /> : null}
      {tool === 'pen' ? <Path d="M4 20h4L19 9l-4-4L4 16z" /> : null}
      {tool === 'text' ? <><Path d="M5 6h14" /><Path d="M12 6v13" /></> : null}
      {tool === 'rect' ? <Rect x="4" y="5" width="16" height="14" rx="2" /> : null}
      {tool === 'arrow' ? <><Path d="M5 19 19 5" /><Path d="M10 5h9v9" /></> : null}
      {tool === 'sticky' ? <Path d="M4 4h16v10l-6 6H4z" /> : null}
      {tool === 'image' ? <ImageGlyph /> : null}
      {tool === 'eraser' ? <><Path d="m7 21-4-4 11-11 7 7-7 8z" /><Path d="M21 21H7" /></> : null}
    </Svg>
  );
}

function ImageGlyph() {
  return (
    <>
      <Rect x="3" y="4" width="18" height="16" rx="2" />
      <Circle cx="9" cy="10" r="2" />
      <Path d="m21 16-5-5-9 9" />
    </>
  );
}

export function ImageProposalGlyph({ size = 40, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <ImageGlyph />
    </Svg>
  );
}

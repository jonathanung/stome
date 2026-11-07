import {
  Circle,
  Ellipse,
  G,
  Line,
  Path,
  Polygon,
  Rect,
  Text as SvgText,
} from 'react-native-svg';

import {
  arrowHeadPoints,
  curvedArrowPath,
  diamondPoints,
  elementBounds,
  smoothPath,
} from './geometry';
import type {
  ArrowElement,
  DiamondElement,
  EllipseElement,
  FreedrawElement,
  LineElement,
  RectangleElement,
  TextElement,
  WhiteboardElement,
} from './types';

function strokeDasharray(style: string, width: number): string | undefined {
  if (style === 'dashed') return `${width * 4},${width * 3}`;
  if (style === 'dotted') return `${width},${width * 2}`;
  return undefined;
}

function RenderFreedraw({ el }: { el: FreedrawElement }) {
  if (el.points.length === 0) return null;
  const absolute: [number, number][] = el.points.map(([px, py]) => [el.x + px, el.y + py]);
  return (
    <Path
      d={smoothPath(absolute)}
      fill="none"
      stroke={el.strokeColor}
      strokeWidth={el.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={strokeDasharray(el.strokeStyle, el.strokeWidth)}
      opacity={el.opacity}
    />
  );
}

function RenderRectangle({ el }: { el: RectangleElement }) {
  const x = el.width < 0 ? el.x + el.width : el.x;
  const y = el.height < 0 ? el.y + el.height : el.y;
  const w = Math.abs(el.width);
  const h = Math.abs(el.height);
  return (
    <Rect
      x={x}
      y={y}
      width={w}
      height={h}
      fill={el.backgroundColor === 'transparent' ? 'none' : el.backgroundColor}
      stroke={el.strokeColor}
      strokeWidth={el.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={strokeDasharray(el.strokeStyle, el.strokeWidth)}
      opacity={el.opacity}
      rx={2}
    />
  );
}

function RenderDiamond({ el }: { el: DiamondElement }) {
  return (
    <Polygon
      points={diamondPoints(el.x, el.y, el.width, el.height)}
      fill={el.backgroundColor === 'transparent' ? 'none' : el.backgroundColor}
      stroke={el.strokeColor}
      strokeWidth={el.strokeWidth}
      strokeLinejoin="round"
      strokeDasharray={strokeDasharray(el.strokeStyle, el.strokeWidth)}
      opacity={el.opacity}
    />
  );
}

function RenderEllipse({ el }: { el: EllipseElement }) {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const rx = Math.abs(el.width / 2);
  const ry = Math.abs(el.height / 2);
  return (
    <Ellipse
      cx={cx}
      cy={cy}
      rx={rx}
      ry={ry}
      fill={el.backgroundColor === 'transparent' ? 'none' : el.backgroundColor}
      stroke={el.strokeColor}
      strokeWidth={el.strokeWidth}
      strokeDasharray={strokeDasharray(el.strokeStyle, el.strokeWidth)}
      opacity={el.opacity}
    />
  );
}

function RenderLine({ el }: { el: LineElement }) {
  if (el.points.length < 2) return null;
  const from: [number, number] = [el.x + el.points[0][0], el.y + el.points[0][1]];
  const to: [number, number] = [
    el.x + el.points[el.points.length - 1][0],
    el.y + el.points[el.points.length - 1][1],
  ];
  return (
    <Line
      x1={from[0]}
      y1={from[1]}
      x2={to[0]}
      y2={to[1]}
      stroke={el.strokeColor}
      strokeWidth={el.strokeWidth}
      strokeLinecap="round"
      strokeDasharray={strokeDasharray(el.strokeStyle, el.strokeWidth)}
      opacity={el.opacity}
    />
  );
}

function RenderArrow({ el }: { el: ArrowElement }) {
  if (el.points.length < 2) return null;
  const from: [number, number] = [el.x + el.points[0][0], el.y + el.points[0][1]];
  const to: [number, number] = [
    el.x + el.points[el.points.length - 1][0],
    el.y + el.points[el.points.length - 1][1],
  ];
  const headSize = el.strokeWidth * 5 + 4;
  // Shorten the tip slightly so the arrowhead sits on top cleanly
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  const tip: [number, number] = len > headSize
    ? [to[0] - (dx / len) * (headSize * 0.4), to[1] - (dy / len) * (headSize * 0.4)]
    : to;

  return (
    <G opacity={el.opacity}>
      <Path
        d={curvedArrowPath(from, tip)}
        fill="none"
        stroke={el.strokeColor}
        strokeWidth={el.strokeWidth}
        strokeLinecap="round"
        strokeDasharray={strokeDasharray(el.strokeStyle, el.strokeWidth)}
      />
      <Polygon
        points={arrowHeadPoints(from, to, headSize)}
        fill={el.strokeColor}
        stroke={el.strokeColor}
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </G>
  );
}

function RenderText({ el }: { el: TextElement }) {
  return (
    <SvgText
      x={el.x}
      y={el.y + el.fontSize}
      fill={el.strokeColor}
      fontSize={el.fontSize}
      fontFamily="System"
      opacity={el.opacity}
    >
      {el.text}
    </SvgText>
  );
}

function SelectionBox({ el }: { el: WhiteboardElement }) {
  const pad = 6;
  const b = elementBounds(el);
  const sx = b.x - pad;
  const sy = b.y - pad;
  const sw = b.w + pad * 2;
  const sh = b.h + pad * 2;
  return (
    <G>
      <Rect
        x={sx}
        y={sy}
        width={sw}
        height={sh}
        fill="none"
        stroke="#4dabf7"
        strokeWidth={1.5}
        strokeDasharray="4,3"
        rx={3}
      />
      <Circle cx={sx} cy={sy} r={4} fill="#4dabf7" />
      <Circle cx={sx + sw} cy={sy} r={4} fill="#4dabf7" />
      <Circle cx={sx} cy={sy + sh} r={4} fill="#4dabf7" />
      <Circle cx={sx + sw} cy={sy + sh} r={4} fill="#4dabf7" />
    </G>
  );
}

type Props = {
  element: WhiteboardElement;
  selected: boolean;
};

export function ElementRenderer({ element, selected }: Props) {
  let rendered: React.ReactElement | null = null;

  switch (element.type) {
    case 'freedraw': rendered = <RenderFreedraw el={element} />; break;
    case 'rectangle': rendered = <RenderRectangle el={element} />; break;
    case 'diamond': rendered = <RenderDiamond el={element} />; break;
    case 'ellipse': rendered = <RenderEllipse el={element} />; break;
    case 'line': rendered = <RenderLine el={element} />; break;
    case 'arrow': rendered = <RenderArrow el={element} />; break;
    case 'text': rendered = <RenderText el={element} />; break;
  }

  if (!rendered) return null;
  if (!selected) return rendered;

  return (
    <G>
      {rendered}
      <SelectionBox el={element} />
    </G>
  );
}

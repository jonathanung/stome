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

import { arrowHeadPoints, smoothPath } from './geometry';
import type {
  ArrowElement,
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
  const d = smoothPath(absolute);
  return (
    <Path
      d={d}
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
  const headPoints = arrowHeadPoints(from, to, el.strokeWidth * 5 + 4);
  return (
    <G opacity={el.opacity}>
      <Line
        x1={from[0]}
        y1={from[1]}
        x2={to[0]}
        y2={to[1]}
        stroke={el.strokeColor}
        strokeWidth={el.strokeWidth}
        strokeLinecap="round"
        strokeDasharray={strokeDasharray(el.strokeStyle, el.strokeWidth)}
      />
      <Polygon
        points={headPoints}
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

type Props = {
  element: WhiteboardElement;
  selected: boolean;
};

export function ElementRenderer({ element, selected }: Props) {
  let rendered: React.ReactElement | null = null;

  switch (element.type) {
    case 'freedraw':
      rendered = <RenderFreedraw el={element} />;
      break;
    case 'rectangle':
      rendered = <RenderRectangle el={element} />;
      break;
    case 'ellipse':
      rendered = <RenderEllipse el={element} />;
      break;
    case 'line':
      rendered = <RenderLine el={element} />;
      break;
    case 'arrow':
      rendered = <RenderArrow el={element} />;
      break;
    case 'text':
      rendered = <RenderText el={element} />;
      break;
  }

  if (!rendered) return null;

  if (selected) {
    // Draw selection outline based on element bounds
    const pad = 6;
    let sx: number, sy: number, sw: number, sh: number;
    if (
      element.type === 'freedraw' ||
      element.type === 'line' ||
      element.type === 'arrow'
    ) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [px, py] of element.points) {
        minX = Math.min(minX, element.x + px);
        minY = Math.min(minY, element.y + py);
        maxX = Math.max(maxX, element.x + px);
        maxY = Math.max(maxY, element.y + py);
      }
      sx = minX - pad;
      sy = minY - pad;
      sw = maxX - minX + pad * 2;
      sh = maxY - minY + pad * 2;
    } else {
      const el = element as RectangleElement | EllipseElement | TextElement;
      sx = el.x - pad;
      sy = el.y - pad;
      sw = el.width + pad * 2;
      sh = el.height + pad * 2;
    }
    return (
      <G>
        {rendered}
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

  return rendered;
}

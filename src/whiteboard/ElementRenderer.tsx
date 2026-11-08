import { RoughGenerator } from 'roughjs/bin/generator';
import type { Op } from 'roughjs/bin/core';
import { getStroke } from 'perfect-freehand';
import {
  Circle,
  G,
  Path,
  Polygon,
  Rect,
  Text as SvgText,
} from 'react-native-svg';

import {
  arrowHeadPoints,
  elementBounds,
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

// Singleton generator — stateless and pure, no DOM needed
const gen = new RoughGenerator();

type RoughPathProps = {
  d: string;
  setType: 'path' | 'fillPath' | 'fillSketch';
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
};
function roughPathProps(p: RoughPathProps) {
  if (p.setType === 'fillSketch') {
    return { fill: 'none', stroke: p.fillColor, strokeWidth: p.strokeWidth * 0.5 };
  }
  if (p.setType === 'fillPath') {
    return { fill: p.fillColor, stroke: 'none', strokeWidth: 0 };
  }
  return { fill: 'none', stroke: p.strokeColor, strokeWidth: p.strokeWidth };
}

/** Convert a rough OpSet's ops array to an SVG path string. */
function opsToPath(ops: Op[]): string {
  return ops
    .map((op) => {
      if (op.op === 'move') return `M ${op.data[0]} ${op.data[1]}`;
      if (op.op === 'lineTo') return `L ${op.data[0]} ${op.data[1]}`;
      if (op.op === 'bcurveTo')
        return `C ${op.data[0]} ${op.data[1]} ${op.data[2]} ${op.data[3]} ${op.data[4]} ${op.data[5]}`;
      return '';
    })
    .join(' ');
}

/** Convert a perfect-freehand stroke point array to an SVG path string. */
function getSvgPathFromStroke(stroke: number[][]): string {
  if (!stroke.length) return '';
  const d = stroke.reduce(
    (acc: (string | number)[], [x0, y0]: number[], i: number, arr: number[][]) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', ...stroke[0], 'Q'],
  );
  d.push('Z');
  return d.join(' ');
}

function strokeDasharray(style: string, width: number): string | undefined {
  if (style === 'dashed') return `${width * 4},${width * 3}`;
  if (style === 'dotted') return `${width},${width * 2}`;
  return undefined;
}

function RenderFreedraw({ el }: { el: FreedrawElement }) {
  if (el.points.length === 0) return null;
  const absolute: [number, number][] = el.points.map(([px, py]) => [el.x + px, el.y + py]);
  const stroke = getStroke(absolute, {
    size: el.strokeWidth * 3 + 2,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
  });
  const pathData = getSvgPathFromStroke(stroke);
  return (
    <Path
      d={pathData}
      fill={el.strokeColor}
      opacity={el.opacity}
    />
  );
}

function RenderRectangle({ el }: { el: RectangleElement }) {
  const x = el.width < 0 ? el.x + el.width : el.x;
  const y = el.height < 0 ? el.y + el.height : el.y;
  const w = Math.abs(el.width);
  const h = Math.abs(el.height);
  if (w < 1 || h < 1) return null;

  const hasFill = el.backgroundColor !== 'transparent';
  const drawable = gen.rectangle(x, y, w, h, {
    roughness: el.roughness,
    stroke: el.strokeColor,
    strokeWidth: el.strokeWidth,
    fill: hasFill ? el.backgroundColor : undefined,
    fillStyle: hasFill ? el.fillStyle : undefined,
    strokeLineDash: strokeDasharray(el.strokeStyle, el.strokeWidth)
      ? [el.strokeWidth * 4, el.strokeWidth * 3]
      : undefined,
  });

  return (
    <G opacity={el.opacity}>
      {drawable.sets.map((set, i) => (
        <Path key={i} d={opsToPath(set.ops)} {...roughPathProps({ d: '', setType: set.type, strokeColor: el.strokeColor, fillColor: el.backgroundColor, strokeWidth: el.strokeWidth })} />
      ))}
    </G>
  );
}

function RenderDiamond({ el }: { el: DiamondElement }) {
  const ax = Math.abs(el.width);
  const ay = Math.abs(el.height);
  const ox = el.width < 0 ? el.x + el.width : el.x;
  const oy = el.height < 0 ? el.y + el.height : el.y;
  const cx = ox + ax / 2;
  const cy = oy + ay / 2;
  if (ax < 1 || ay < 1) return null;

  // Build diamond as a closed polygon path for rough
  const points: [number, number][] = [
    [cx, oy],
    [ox + ax, cy],
    [cx, oy + ay],
    [ox, cy],
  ];
  const hasFill = el.backgroundColor !== 'transparent';
  const drawable = gen.polygon(points, {
    roughness: el.roughness,
    stroke: el.strokeColor,
    strokeWidth: el.strokeWidth,
    fill: hasFill ? el.backgroundColor : undefined,
    fillStyle: hasFill ? el.fillStyle : undefined,
    strokeLineDash: strokeDasharray(el.strokeStyle, el.strokeWidth)
      ? [el.strokeWidth * 4, el.strokeWidth * 3]
      : undefined,
  });

  return (
    <G opacity={el.opacity}>
      {drawable.sets.map((set, i) => (
        <Path key={i} d={opsToPath(set.ops)} {...roughPathProps({ d: '', setType: set.type, strokeColor: el.strokeColor, fillColor: el.backgroundColor, strokeWidth: el.strokeWidth })} />
      ))}
    </G>
  );
}

function RenderEllipse({ el }: { el: EllipseElement }) {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const rx = Math.abs(el.width / 2);
  const ry = Math.abs(el.height / 2);
  if (rx < 1 || ry < 1) return null;

  const hasFill = el.backgroundColor !== 'transparent';
  const drawable = gen.ellipse(cx, cy, rx * 2, ry * 2, {
    roughness: el.roughness,
    stroke: el.strokeColor,
    strokeWidth: el.strokeWidth,
    fill: hasFill ? el.backgroundColor : undefined,
    fillStyle: hasFill ? el.fillStyle : undefined,
    strokeLineDash: strokeDasharray(el.strokeStyle, el.strokeWidth)
      ? [el.strokeWidth * 4, el.strokeWidth * 3]
      : undefined,
  });

  return (
    <G opacity={el.opacity}>
      {drawable.sets.map((set, i) => (
        <Path key={i} d={opsToPath(set.ops)} {...roughPathProps({ d: '', setType: set.type, strokeColor: el.strokeColor, fillColor: el.backgroundColor, strokeWidth: el.strokeWidth })} />
      ))}
    </G>
  );
}

function RenderLine({ el }: { el: LineElement }) {
  if (el.points.length < 2) return null;
  const from: [number, number] = [el.x + el.points[0][0], el.y + el.points[0][1]];
  const to: [number, number] = [
    el.x + el.points[el.points.length - 1][0],
    el.y + el.points[el.points.length - 1][1],
  ];
  const drawable = gen.line(from[0], from[1], to[0], to[1], {
    roughness: el.roughness,
    stroke: el.strokeColor,
    strokeWidth: el.strokeWidth,
    strokeLineDash: strokeDasharray(el.strokeStyle, el.strokeWidth)
      ? [el.strokeWidth * 4, el.strokeWidth * 3]
      : undefined,
  });

  return (
    <G opacity={el.opacity}>
      {drawable.sets.map((set, i) => (
        <Path key={i} d={opsToPath(set.ops)} fill="none" stroke={el.strokeColor} strokeWidth={el.strokeWidth} />
      ))}
    </G>
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
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  const tip: [number, number] = len > headSize
    ? [to[0] - (dx / len) * (headSize * 0.4), to[1] - (dy / len) * (headSize * 0.4)]
    : to;

  const drawable = gen.line(from[0], from[1], tip[0], tip[1], {
    roughness: el.roughness,
    stroke: el.strokeColor,
    strokeWidth: el.strokeWidth,
    strokeLineDash: strokeDasharray(el.strokeStyle, el.strokeWidth)
      ? [el.strokeWidth * 4, el.strokeWidth * 3]
      : undefined,
  });

  return (
    <G opacity={el.opacity}>
      {drawable.sets.map((set, i) => (
        <Path key={i} d={opsToPath(set.ops)} fill="none" stroke={el.strokeColor} strokeWidth={el.strokeWidth} />
      ))}
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

import getStroke from 'perfect-freehand';
import { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { RoughGenerator } from 'roughjs/bin/generator';
import type { Op } from 'roughjs/bin/core';

import { elementBounds } from './geometry';
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

const gen = new RoughGenerator();

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

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

function roughOpts(el: {
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  roughness: number;
  fillStyle: string;
  id: string;
}) {
  return {
    roughness: el.roughness,
    stroke: el.strokeColor,
    strokeWidth: el.strokeWidth,
    fill: el.backgroundColor === 'transparent' ? undefined : el.backgroundColor,
    fillStyle: el.fillStyle,
    seed: hashId(el.id),
  };
}

function strokeDasharray(style: string, width: number): string | undefined {
  if (style === 'dashed') return `${width * 4},${width * 3}`;
  if (style === 'dotted') return `${width},${width * 2}`;
  return undefined;
}

function getSvgPathFromStroke(pts: number[][]): string {
  if (!pts.length) return '';
  const d: (string | number)[] = ['M', pts[0][0], pts[0][1], 'Q'];
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    d.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  d.push('Z');
  return d.join(' ');
}

function RenderFreedraw({ el }: { el: FreedrawElement }) {
  if (el.points.length === 0) return null;
  const absolute = el.points.map(([px, py]) => [el.x + px, el.y + py]);
  const stroke = getStroke(absolute, {
    size: el.strokeWidth * 3 + 2,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
  });
  return <Path d={getSvgPathFromStroke(stroke)} fill={el.strokeColor} opacity={el.opacity} />;
}

function RoughShape({ sets, el }: { sets: ReturnType<typeof gen.rectangle>['sets']; el: { strokeColor: string; strokeWidth: number; strokeStyle: string; opacity: number } }) {
  return (
    <G opacity={el.opacity}>
      {sets.map((set, i) => (
        <Path
          key={i}
          d={opsToPath(set.ops)}
          fill={set.type === 'fillSketch' ? el.strokeColor : 'none'}
          fillOpacity={set.type === 'fillSketch' ? 0.45 : 1}
          stroke={set.type === 'path' ? el.strokeColor : 'none'}
          strokeWidth={el.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={set.type === 'path' ? strokeDasharray(el.strokeStyle, el.strokeWidth) : undefined}
        />
      ))}
    </G>
  );
}

function RenderRectangle({ el }: { el: RectangleElement }) {
  const x = el.width < 0 ? el.x + el.width : el.x;
  const y = el.height < 0 ? el.y + el.height : el.y;
  const w = Math.abs(el.width);
  const h = Math.abs(el.height);
  if (w < 2 || h < 2) return null;
  const d = gen.rectangle(x, y, w, h, roughOpts(el));
  return <RoughShape sets={d.sets} el={el} />;
}

function RenderDiamond({ el }: { el: DiamondElement }) {
  const ax = Math.abs(el.width);
  const ay = Math.abs(el.height);
  const ox = el.width < 0 ? el.x + el.width : el.x;
  const oy = el.height < 0 ? el.y + el.height : el.y;
  if (ax < 2 || ay < 2) return null;
  const pts: [number, number][] = [
    [ox + ax / 2, oy],
    [ox + ax, oy + ay / 2],
    [ox + ax / 2, oy + ay],
    [ox, oy + ay / 2],
  ];
  const d = gen.polygon(pts, roughOpts(el));
  return <RoughShape sets={d.sets} el={el} />;
}

function RenderEllipse({ el }: { el: EllipseElement }) {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const w = Math.abs(el.width);
  const h = Math.abs(el.height);
  if (w < 2 || h < 2) return null;
  const d = gen.ellipse(cx, cy, w, h, roughOpts(el));
  return <RoughShape sets={d.sets} el={el} />;
}

function RenderLine({ el }: { el: LineElement }) {
  if (el.points.length < 2) return null;
  const from: [number, number] = [el.x + el.points[0][0], el.y + el.points[0][1]];
  const to: [number, number] = [
    el.x + el.points[el.points.length - 1][0],
    el.y + el.points[el.points.length - 1][1],
  ];
  const d = gen.line(from[0], from[1], to[0], to[1], roughOpts(el));
  return (
    <G opacity={el.opacity}>
      {d.sets.map((set, i) => (
        <Path
          key={i}
          d={opsToPath(set.ops)}
          fill="none"
          stroke={el.strokeColor}
          strokeWidth={el.strokeWidth}
          strokeLinecap="round"
          strokeDasharray={strokeDasharray(el.strokeStyle, el.strokeWidth)}
        />
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

  const lineDrawable = gen.line(from[0], from[1], tip[0], tip[1], roughOpts(el));
  const angle = Math.atan2(dy, dx);
  const spread = Math.PI / 7;
  const ax = to[0] - headSize * Math.cos(angle - spread);
  const ay = to[1] - headSize * Math.sin(angle - spread);
  const bx = to[0] - headSize * Math.cos(angle + spread);
  const by = to[1] - headSize * Math.sin(angle + spread);
  const headPath = `M ${ax} ${ay} L ${to[0]} ${to[1]} L ${bx} ${by}`;

  return (
    <G opacity={el.opacity}>
      {lineDrawable.sets.map((set, i) => (
        <Path
          key={i}
          d={opsToPath(set.ops)}
          fill="none"
          stroke={el.strokeColor}
          strokeWidth={el.strokeWidth}
          strokeLinecap="round"
          strokeDasharray={strokeDasharray(el.strokeStyle, el.strokeWidth)}
        />
      ))}
      <Path
        d={headPath}
        fill="none"
        stroke={el.strokeColor}
        strokeWidth={el.strokeWidth}
        strokeLinecap="round"
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

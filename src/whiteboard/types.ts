export type Tool =
  | 'select'
  | 'hand'
  | 'freedraw'
  | 'rectangle'
  | 'diamond'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'text';

export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type FillStyle = 'hachure' | 'cross-hatch' | 'solid';
export type RoughnessLevel = 0 | 1 | 2;

export type ElementBase = {
  id: string;
  x: number;
  y: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  opacity: number;
  roughness: RoughnessLevel;
  fillStyle: FillStyle;
};

export type FreedrawElement = ElementBase & {
  type: 'freedraw';
  points: [number, number][];
  width: number;
  height: number;
};

export type RectangleElement = ElementBase & {
  type: 'rectangle';
  width: number;
  height: number;
};

export type DiamondElement = ElementBase & {
  type: 'diamond';
  width: number;
  height: number;
};

export type EllipseElement = ElementBase & {
  type: 'ellipse';
  width: number;
  height: number;
};

export type LineElement = ElementBase & {
  type: 'line';
  points: [number, number][];
};

export type ArrowElement = ElementBase & {
  type: 'arrow';
  points: [number, number][];
};

export type TextElement = ElementBase & {
  type: 'text';
  text: string;
  fontSize: number;
  width: number;
  height: number;
};

export type WhiteboardElement =
  | FreedrawElement
  | RectangleElement
  | DiamondElement
  | EllipseElement
  | LineElement
  | ArrowElement
  | TextElement;

export type CanvasTransform = {
  offsetX: number;
  offsetY: number;
  scale: number;
};

export const EXCALIDRAW_COLORS = {
  canvasBg: '#f5f0e8',
  stroke: [
    '#1e1e2e',
    '#e03131',
    '#2f9e44',
    '#1971c2',
    '#f08c00',
    '#ae3ec9',
    '#0c8599',
    '#868e96',
  ],
  fill: [
    'transparent',
    '#ffc9c9',
    '#b2f2bb',
    '#a5d8ff',
    '#ffec99',
    '#e599f7',
    '#99e9f2',
    '#dee2e6',
  ],
} as const;

export const DEFAULT_STYLE = {
  strokeColor: '#1e1e2e',
  backgroundColor: 'transparent',
  strokeWidth: 2,
  strokeStyle: 'solid' as StrokeStyle,
  opacity: 1,
  roughness: 1 as RoughnessLevel,
  fillStyle: 'hachure' as FillStyle,
};

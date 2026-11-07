export type WhiteboardTool = 'hand' | 'pen' | 'highlighter' | 'lasso' | 'eraser' | 'sticky';
export type InkColor = 'stone' | 'rust' | 'moss' | 'lichen';

/** In-memory stroke, canvas units. Not yet persisted as a `stroke` annotation. */
export interface BoardStroke {
  id: string;
  tool: 'pen' | 'highlighter';
  ink: InkColor;
  points: [number, number][];
}

/** An AI review note pinned to the board. No backing service yet; supplied by the caller. */
export interface BoardCheck {
  message: string;
  fix?: { label: string; onPress: () => void };
}

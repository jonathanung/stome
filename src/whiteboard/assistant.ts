import { BOARD_HEIGHT, BOARD_WIDTH, validBoardItems, type BoardItem } from './model.ts';

export type BoardAction = 'explain' | 'check' | 'quiz';
export type BoardCorrection =
  | { kind: 'none'; targetId: ''; text: ''; x: 0; y: 0 }
  | { kind: 'add_text' | 'replace_text'; targetId: string; text: string; x: number; y: number };

export interface BoardRequest {
  roomId: string;
  revision: number;
  action: BoardAction;
  items: BoardItem[];
}

export interface BoardReply {
  message: string;
  correction: BoardCorrection;
}

export const BOARD_REQUEST_LIMIT = 30_000;
export const NO_CORRECTION: BoardCorrection = { kind: 'none', targetId: '', text: '', x: 0, y: 0 };

export function parseBoardRequest(raw: unknown): BoardRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Board request must be an object');
  const value = raw as Record<string, unknown>;
  if (typeof value.roomId !== 'string' || !value.roomId || value.roomId.length > 64) throw new Error('Board room is invalid');
  if (!Number.isInteger(value.revision) || (value.revision as number) < 0) throw new Error('Board revision is invalid');
  if (value.action !== 'explain' && value.action !== 'check' && value.action !== 'quiz') throw new Error('Board action is invalid');
  if (!validBoardItems(value.items) || JSON.stringify(value.items).length > BOARD_REQUEST_LIMIT) throw new Error('Board is too large for study help');
  return value as unknown as BoardRequest;
}

export function parseBoardReply(raw: unknown, request: BoardRequest): BoardReply {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Board reply must be an object');
  const value = raw as Record<string, unknown>;
  if (typeof value.message !== 'string' || !value.message.trim() || value.message.length > 2_000) throw new Error('Board reply message is invalid');
  const correction = value.correction;
  if (!correction || typeof correction !== 'object' || Array.isArray(correction)) throw new Error('Board correction is invalid');
  const c = correction as Record<string, unknown>;
  if (c.kind === 'none') return { message: value.message, correction: NO_CORRECTION };
  if (c.kind !== 'add_text' && c.kind !== 'replace_text') throw new Error('Board correction kind is invalid');
  if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 500) throw new Error('Board correction text is invalid');
  if (c.kind === 'replace_text' && !request.items.some((item) => item.kind === 'text' && item.id === c.targetId)) throw new Error('Board correction target is invalid');
  if (c.kind === 'add_text' && c.targetId !== '') throw new Error('New board text cannot target an item');
  if (typeof c.x !== 'number' || !Number.isFinite(c.x) || c.x < 0 || c.x > BOARD_WIDTH ||
    typeof c.y !== 'number' || !Number.isFinite(c.y) || c.y < 0 || c.y > BOARD_HEIGHT) throw new Error('Board correction position is invalid');
  return { message: value.message, correction: { kind: c.kind, targetId: c.targetId as string, text: c.text.trim(), x: c.x, y: c.y } };
}

export function applyBoardCorrection(items: BoardItem[], correction: BoardCorrection, newId: () => string): BoardItem[] {
  if (correction.kind === 'none') return items;
  if (correction.kind === 'add_text') return [...items, { id: newId(), kind: 'text', x: correction.x, y: correction.y, text: correction.text }];
  return items.map((item) => item.kind === 'text' && item.id === correction.targetId ? { ...item, text: correction.text } : item);
}

export function mockBoardReply(request: BoardRequest): BoardReply {
  const labels = request.items.filter((item): item is Extract<BoardItem, { kind: 'text' }> => item.kind === 'text');
  const topic = labels[0]?.text ?? 'the drawing';
  if (request.action === 'explain') return { message: `Mock explanation: The board labels “${topic}” and contains ${request.items.length} items. Explain how its drawings relate to the topic.`, correction: NO_CORRECTION };
  if (request.action === 'quiz') return { message: `Mock quiz: Without looking at the board, explain ${topic}. What does each arrow or shape represent?`, correction: NO_CORRECTION };
  return { message: labels.length ? `Mock check: Review whether the labels and arrows accurately describe ${topic}.` : 'Mock check: This board needs a title to be understandable later.',
    correction: labels.length ? NO_CORRECTION : { kind: 'add_text', targetId: '', text: 'Untitled concept', x: 40, y: 50 } };
}

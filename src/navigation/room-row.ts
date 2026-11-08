/**
 * Phone rooms reveal rename and delete by sliding a row. A tap on that open
 * row closes it. A tap on any other row, including while a different row is
 * open, opens that room.
 */
export function roomRowPress(openSwipeId: string | null, roomId: string): 'close' | 'open' {
  return openSwipeId === roomId ? 'close' : 'open';
}

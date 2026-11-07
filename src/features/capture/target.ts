/** Room id from `/rooms/:id` or a later nested path such as `/rooms/:id/review`. */
export function roomIdFromPath(pathname: string): string | null {
  const match = /^\/rooms\/([^/]+)/.exec(pathname);
  if (!match?.[1]) return null;
  try {
    const id = decodeURIComponent(match[1]);
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

export type CaptureTarget =
  | { roomId: string; source: 'current' | 'last' }
  | { needsRoom: true };

/**
 * Current room wins. Otherwise the last room that still exists.
 * A missing room asks the user to create one. There is no inbox.
 */
export function chooseCaptureRoom(input: {
  pathname: string;
  lastRoomId: string | null;
  roomIds: readonly string[];
}): CaptureTarget {
  const current = roomIdFromPath(input.pathname);
  if (current && input.roomIds.includes(current)) return { roomId: current, source: 'current' };
  if (input.lastRoomId && input.roomIds.includes(input.lastRoomId)) return { roomId: input.lastRoomId, source: 'last' };
  return { needsRoom: true };
}

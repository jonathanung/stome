/**
 * Where the room screen offers the shipped whiteboard.
 *
 * The phone chrome (under 600) has the boards tab and the room options menu.
 * Every wider width, including iPad portrait (768–1024) and iPad landscape
 * (1024–1194), uses the room header. A wide window also keeps the side-panel row.
 */
export const PHONE_ROOM_WIDTH = 600;
export const WIDE_ROOM_WIDTH = 1300;

export type WhiteboardEntry = 'header' | 'phone';

export function whiteboardEntry(width: number): WhiteboardEntry {
  return width < PHONE_ROOM_WIDTH ? 'phone' : 'header';
}

export function showsWhiteboardSidePanel(width: number): boolean {
  return width >= WIDE_ROOM_WIDTH;
}

/** Where Notes goes when the whiteboard was opened directly and has no history. */
export function whiteboardNotesTarget(roomId: string | undefined): `/rooms/${string}` | '/' {
  return roomId ? `/rooms/${roomId}` : '/';
}

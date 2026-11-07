import { LIMITS } from '../data/operations.ts';

export interface ExistingRoom {
  id: string;
  name: string;
}

/** A reviewed choice. Nothing here creates a room. */
export type RoomMapping =
  | { status: 'unset' }
  | { status: 'existing'; roomId: string }
  | { status: 'new'; name: string };

export function unsetRoomMapping(): RoomMapping {
  return { status: 'unset' };
}

/** Cancel abandons the choice. The caller must not write. */
export function cancelRoomMapping(): RoomMapping {
  return unsetRoomMapping();
}

export function chooseExistingRoom(roomId: string): RoomMapping {
  return { status: 'existing', roomId };
}

export function chooseNewRoom(name: string): RoomMapping {
  return { status: 'new', name };
}

/** The first reviewed subject, used only as a suggested name after the user asks for a new room. */
export function roomNameFromSubject(subjects: string): string {
  const first = subjects.split(',')[0]?.trim().replace(/\s+/g, ' ') ?? '';
  return first.slice(0, LIMITS.roomName);
}

/**
 * Existing rooms whose names match the reviewed subject.
 * A match is a suggestion. It is not a selected destination.
 */
export function matchingRooms(rooms: readonly ExistingRoom[], subjects: string): ExistingRoom[] {
  const name = roomNameFromSubject(subjects).toLowerCase();
  if (!name) return [];
  return rooms.filter((room) => room.name.trim().replace(/\s+/g, ' ').toLowerCase() === name);
}

/** Null until the user has chosen an existing room or a usable new name. */
export function destinationForMapping(mapping: RoomMapping): { roomId: string } | { name: string } | null {
  if (mapping.status === 'existing') {
    const roomId = mapping.roomId.trim();
    return roomId ? { roomId } : null;
  }
  if (mapping.status === 'new') {
    const name = mapping.name.trim().replace(/\s+/g, ' ');
    if (!name || name.length > LIMITS.roomName) return null;
    return { name };
  }
  return null;
}

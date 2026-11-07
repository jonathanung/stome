import type { RoomStage } from '../../db/schema.ts';

/** Finished reviews a room needs before it grows from stonehenge to brick. */
export const BRICK_CREDITS = 3;

export interface StoneProgress {
  /** Credits shown, capped at the brick threshold. */
  earned: number;
  needed: number;
  remaining: number;
}

export function stoneProgress(credits: number, stage: RoomStage): StoneProgress {
  const earned = stage === 'brick' ? BRICK_CREDITS : Math.max(0, Math.min(credits, BRICK_CREDITS));
  return { earned, needed: BRICK_CREDITS, remaining: BRICK_CREDITS - earned };
}

export function stoneHeadline(roomName: string, stage: RoomStage): string {
  return `${roomName.toLowerCase()} is ${stage === 'brick' ? 'a brick house' : 'stonehenge'}`;
}

export function stoneSubline(progress: StoneProgress, stage: RoomStage): string {
  if (stage === 'brick') return `${progress.earned} of ${progress.needed} review credits earned. this room is brick.`;
  const more = progress.remaining === 1 ? 'one more finished review' : `${progress.remaining} more finished reviews`;
  return `${progress.earned} of ${progress.needed} review credits. ${more} and it becomes brick.`;
}

/** Word shown next to BackButton's one chevron. An arrow here paints a second glyph. */
export const ROOM_BACK_LABEL = 'rooms';

/** Characters that duplicate the chevron BackButton already draws. */
const EXTRA_ARROW = /[\u2190\u2039\u2329\u21A9]/u;

export function backLabelHasArrow(label: string): boolean {
  return EXTRA_ARROW.test(label);
}

export type RoomBackStep = 'back' | 'rooms';

/**
 * Ordinary navigation pops the stack back to wherever the room was opened from.
 * A direct open has no history, so the rooms list is the fallback.
 */
export function roomBackStep(canGoBack: boolean): RoomBackStep {
  return canGoBack ? 'back' : 'rooms';
}

export function followRoomBack(
  step: RoomBackStep,
  nav: { back(): void; replace(href: '/'): void },
): void {
  switch (step) {
    case 'back':
      nav.back();
      return;
    case 'rooms':
      nav.replace('/');
      return;
    default: {
      const _exhaustive: never = step;
      return _exhaustive;
    }
  }
}

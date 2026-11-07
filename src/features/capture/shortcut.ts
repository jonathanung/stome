/** In-app shortcut. It is not an OS-wide hotkey. */
export const CAPTURE_SHORTCUT_LABEL = 'Alt+N';

export type ShortcutEvent = {
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
};

/** True only while this tab is focused and visible. */
export function isCaptureShortcut(event: ShortcutEvent, focused: boolean, visible: boolean): boolean {
  if (!focused || !visible || event.repeat) return false;
  return event.code === 'KeyN' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

import { useEffect, useState } from 'react';

import { AutosaveController, type AutosaveState, type SaveOutcome } from './autosave';

/**
 * React binding for AutosaveController. `save` may change every render; the
 * latest one is handed to the controller. Pending edits are flushed when the
 * component unmounts (leaving the screen).
 */
export function useAutosave(save: (text: string) => Promise<SaveOutcome>) {
  const [state, setState] = useState<AutosaveState>({ status: 'saved', text: null, error: null });
  const [controller] = useState(() => new AutosaveController({ save, onChange: setState }));

  useEffect(() => {
    controller.setSave(save);
  }, [controller, save]);

  useEffect(
    () => () => {
      void controller.flush();
      controller.dispose();
    },
    [controller],
  );

  return { state, controller };
}

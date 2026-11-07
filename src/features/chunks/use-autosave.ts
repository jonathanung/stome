import { useEffect, useState } from 'react';

import { AutosaveController, settleOnUnmount, type AutosaveState, type SaveOutcome } from './autosave';

/**
 * React binding for AutosaveController. `save` may change every render; the
 * latest one is handed to the controller. Pending edits are flushed when the
 * component unmounts. A failed flush stays in the controller so the screen
 * can store it; nothing starts a new save on its own.
 */
export function useAutosave(
  save: (text: string) => Promise<SaveOutcome>,
  options?: { initial?: AutosaveState; onPersist?: (state: AutosaveState) => void },
) {
  const initial = options?.initial;
  const onPersist = options?.onPersist;
  const [state, setState] = useState<AutosaveState>(initial ?? { status: 'saved', text: null, error: null });
  const [controller] = useState(() => new AutosaveController({ save, onChange: setState, initial }));

  useEffect(() => {
    controller.setSave(save);
  }, [controller, save]);

  useEffect(() => {
    controller.setOnChange((next) => {
      setState(next);
      onPersist?.(next);
    });
  }, [controller, onPersist]);

  useEffect(() => () => {
    void settleOnUnmount(controller);
  }, [controller]);

  return { state, controller };
}

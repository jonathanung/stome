/**
 * Coordinates the room screen's reads. Focus, saves and quick-capture refreshes
 * all read the same room, so only the newest started read may apply.
 *
 * A capture can land while a focus load is still running. That refresh has to
 * wait: running it would invalidate the focus load, and a failed refresh would
 * then throw away a successful read. This matters both on first open and on
 * every refocus. Instead the coordinator defers it until that load has settled.
 */
export type LoadToken = { readonly id: number };
export type LoadOutcome = 'applied' | 'ignored' | 'failed';

export type RefreshPlan = { run: false } | { run: true; token: LoadToken };

export type RoomLoadCoordinator = {
  startFocus: () => LoadToken;
  startRefresh: () => RefreshPlan;
  isLatest: (token: LoadToken) => boolean;
  /** Marks the focus load as settled; true when a deferred refresh must run now. */
  focusSucceeded: () => boolean;
  focusFailed: () => void;
  /** Drops in-flight reads, e.g. when the screen loses focus. */
  invalidate: () => void;
};

export function createRoomLoadCoordinator(): RoomLoadCoordinator {
  let latest = 0;
  let focusPending = false;
  let deferred = false;
  const start = (): LoadToken => {
    latest += 1;
    return { id: latest };
  };
  return {
    startFocus() {
      focusPending = true;
      return start();
    },
    startRefresh() {
      if (focusPending) {
        deferred = true;
        return { run: false };
      }
      return { run: true, token: start() };
    },
    isLatest: (token) => token.id === latest,
    focusSucceeded() {
      focusPending = false;
      const rerun = deferred;
      deferred = false;
      return rerun;
    },
    focusFailed() {
      focusPending = false;
      deferred = false;
    },
    invalidate() {
      latest += 1;
      focusPending = false;
      deferred = false;
    },
  };
}

/**
 * Read the room, then apply only when `token` is still the newest read.
 * Failures from a stale read are dropped instead of showing an obsolete error.
 */
export async function settleLatest<T>(
  loads: RoomLoadCoordinator,
  token: LoadToken,
  read: () => Promise<T>,
  apply: (value: T) => void,
  onError: (message: string) => void,
): Promise<LoadOutcome> {
  try {
    const value = await read();
    if (!loads.isLatest(token)) return 'ignored';
    apply(value);
    return 'applied';
  } catch (reason) {
    if (!loads.isLatest(token)) return 'ignored';
    onError(reason instanceof Error ? reason.message : 'Could not load room');
    return 'failed';
  }
}

export type RoomReader<T> = {
  /** Load once for the current focus, then run any capture refresh that waited. */
  focus: () => Promise<LoadOutcome>;
  /** Queue a reload. Refreshes run one at a time so an older success is applied before a newer failure. */
  refresh: () => Promise<void>;
  /** Drop in-flight reads and queued refreshes when the screen loses focus. */
  blur: () => void;
};

/**
 * The room screen's load lifecycle in one place: focus loads and capture
 * refreshes share the coordinator, and refreshes are serialised. A later
 * refresh that fails therefore cannot discard an earlier successful read.
 */
export function createRoomReader<T>(deps: {
  read: () => Promise<T>;
  apply: (value: T) => void;
  onError: (message: string) => void;
}): RoomReader<T> {
  const loads = createRoomLoadCoordinator();
  let chain: Promise<void> = Promise.resolve();
  const runRefresh = async (): Promise<void> => {
    const plan = loads.startRefresh();
    if (!plan.run) return;
    await settleLatest(loads, plan.token, deps.read, deps.apply, deps.onError);
  };
  const refresh = (): Promise<void> => {
    chain = chain.then(runRefresh, runRefresh);
    return chain;
  };
  return {
    async focus() {
      const token = loads.startFocus();
      const outcome = await settleLatest(loads, token, deps.read, deps.apply, (message) => {
        loads.focusFailed();
        deps.onError(message);
      });
      if (outcome === 'applied' && loads.focusSucceeded()) await refresh();
      return outcome;
    },
    refresh,
    blur() {
      loads.invalidate();
    },
  };
}

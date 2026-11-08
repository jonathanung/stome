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
  focusFailed: () => boolean;
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
      const rerun = deferred;
      deferred = false;
      return rerun;
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
  // Queued work belongs to the focus generation that requested it. Blur (or a
  // replaced reader) moves the generation on, so a queued refresh can neither
  // start nor apply against an unfocused screen or a room that is gone.
  let generation = 0;
  let live = false;
  const isLive = (gen: number) => live && gen === generation;
  const runRefresh = async (gen: number): Promise<void> => {
    if (!isLive(gen)) return;
    const plan = loads.startRefresh();
    if (!plan.run) return;
    await settleLatest(
      loads,
      plan.token,
      deps.read,
      (value) => { if (isLive(gen)) deps.apply(value); },
      (message) => { if (isLive(gen)) deps.onError(message); },
    );
  };
  const refresh = (): Promise<void> => {
    const gen = generation;
    chain = chain.then(() => runRefresh(gen), () => runRefresh(gen));
    return chain;
  };
  return {
    async focus() {
      generation += 1;
      live = true;
      const gen = generation;
      const token = loads.startFocus();
      let deferredOnFailure = false;
      const outcome = await settleLatest(
        loads,
        token,
        deps.read,
        (value) => { if (isLive(gen)) deps.apply(value); },
        (message) => {
          deferredOnFailure = loads.focusFailed();
          if (isLive(gen)) deps.onError(message);
        },
      );
      if (!isLive(gen)) return outcome;
      if (outcome === 'applied') {
        if (loads.focusSucceeded()) void refresh();
      } else if (deferredOnFailure) {
        // The focus read failed after a capture landed; still reload so the
        // captured chunk is not lost to a transient read error.
        void refresh();
      }
      return outcome;
    },
    refresh,
    blur() {
      live = false;
      generation += 1;
      loads.invalidate();
    },
  };
}

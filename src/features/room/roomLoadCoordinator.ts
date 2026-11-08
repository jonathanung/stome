/**
 * Coordinates the room screen's reads. Focus, saves and quick-capture refreshes
 * all read the same room, so only the newest started read may apply.
 *
 * A capture can land while the first focus load is still running. That refresh
 * has to wait: running it would invalidate the initial load, and a failed
 * refresh would then leave the screen with no room and a misleading "not found".
 * Instead the coordinator defers it until the initial load has succeeded.
 */
export type LoadToken = { readonly id: number };

export type RefreshPlan = { run: false } | { run: true; token: LoadToken };

export type RoomLoadCoordinator = {
  startInitial: () => LoadToken;
  startRefresh: () => RefreshPlan;
  isLatest: (token: LoadToken) => boolean;
  /** Marks the first successful load; true when a deferred refresh must run now. */
  initialSucceeded: () => boolean;
  initialFailed: () => void;
  /** Drops in-flight reads, e.g. when the screen loses focus. */
  invalidate: () => void;
};

export function createRoomLoadCoordinator(): RoomLoadCoordinator {
  let latest = 0;
  let loaded = false;
  let deferred = false;
  const start = (): LoadToken => {
    latest += 1;
    return { id: latest };
  };
  return {
    startInitial: start,
    startRefresh() {
      if (!loaded) {
        deferred = true;
        return { run: false };
      }
      return { run: true, token: start() };
    },
    isLatest: (token) => token.id === latest,
    initialSucceeded() {
      loaded = true;
      const rerun = deferred;
      deferred = false;
      return rerun;
    },
    initialFailed() {
      deferred = false;
    },
    invalidate() {
      latest += 1;
    },
  };
}

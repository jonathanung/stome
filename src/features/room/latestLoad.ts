/**
 * Applies the result of only the newest load started. Room state is reloaded
 * from several places (focus, a save, a quick capture), so a slow earlier read
 * must not land after a later one and restore stale chunks.
 */
export type LoadToken = { readonly id: number };

export function createLatestLoad(): {
  start: () => LoadToken;
  isLatest: (token: LoadToken) => boolean;
} {
  let latest = 0;
  return {
    start() {
      latest += 1;
      return { id: latest };
    },
    isLatest(token) {
      return token.id === latest;
    },
  };
}

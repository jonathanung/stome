/**
 * The minimal database surface the data layer needs.
 *
 * The app implements it with expo-sqlite (`expo-driver.ts`); tests implement
 * it with Node's built-in `node:sqlite`. Keeping schema, migrations and the
 * write boundary on this interface lets one set of tests cover them.
 */

export type SqlValue = string | number | null;

export interface Db {
  /** Runs one or more statements with no parameters (schema, pragmas). */
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<{ changes: number }>;
  get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  /** Runs `task` in one transaction: commits if it resolves, rolls back if it throws. */
  transaction<T>(task: () => Promise<T>): Promise<T>;
}

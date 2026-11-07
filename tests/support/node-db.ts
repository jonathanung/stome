import { DatabaseSync } from 'node:sqlite';

import type { Db, SqlValue } from '../../src/db/driver.ts';

/**
 * node:sqlite implementation of `Db`, for tests. This exercises the same SQL
 * as the app but not the Expo native or web driver.
 */
export function nodeDb(path = ':memory:'): Db & { raw: DatabaseSync; close(): void } {
  const raw = new DatabaseSync(path);
  let depth = 0;
  return {
    raw,
    close: () => raw.close(),
    async exec(sql) {
      raw.exec(sql);
    },
    async run(sql, params: readonly SqlValue[] = []) {
      const result = raw.prepare(sql).run(...params);
      return { changes: Number(result.changes) };
    },
    async get<T>(sql: string, params: readonly SqlValue[] = []) {
      return (raw.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async all<T>(sql: string, params: readonly SqlValue[] = []) {
      return raw.prepare(sql).all(...params) as T[];
    },
    async transaction<T>(task: () => Promise<T>): Promise<T> {
      if (depth > 0) throw new Error('nested transaction');
      depth += 1;
      raw.exec('BEGIN');
      try {
        const value = await task();
        raw.exec('COMMIT');
        return value;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      } finally {
        depth -= 1;
      }
    },
  };
}

/** Wraps a Db so that the Nth write (run) throws, to simulate a crash partway through. */
export function failOnWrite(db: Db, n: number): Db {
  let writes = 0;
  return {
    ...db,
    async run(sql, params) {
      writes += 1;
      if (writes === n) throw new Error(`simulated failure on write ${n}`);
      return db.run(sql, params);
    },
  };
}

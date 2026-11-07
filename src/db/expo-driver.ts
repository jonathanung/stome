import type { SQLiteDatabase } from 'expo-sqlite';

import type { Db, SqlValue } from './driver';

/**
 * expo-sqlite implementation of `Db`.
 *
 * Uses withTransactionAsync rather than the exclusive variant: the exclusive
 * one opens a second connection where `PRAGMA foreign_keys` is off, which
 * would silently skip cascades. The write boundary serializes commits, so
 * transactions never overlap.
 */
export function expoDriver(db: SQLiteDatabase): Db {
  return {
    exec: (sql) => db.execAsync(sql),
    async run(sql, params: readonly SqlValue[] = []) {
      const result = await db.runAsync(sql, [...params]);
      return { changes: result.changes };
    },
    get: <T>(sql: string, params: readonly SqlValue[] = []) => db.getFirstAsync<T>(sql, [...params]),
    all: <T>(sql: string, params: readonly SqlValue[] = []) => db.getAllAsync<T>(sql, [...params]),
    async transaction<T>(task: () => Promise<T>): Promise<T> {
      let value!: T;
      await db.withTransactionAsync(async () => {
        value = await task();
      });
      return value;
    },
  };
}

import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { HARNESS_DATABASE_NAME } from './contract';
import { failInterruptedSessions, migrateHarness, type SqlExecutor, type SqlParams } from './store';

export function expoExecutor(db: SQLiteDatabase): SqlExecutor {
  let tail: Promise<void> = Promise.resolve();
  let depth = 0;

  // Expo web's execAsync('BEGIN') finalizes statements without waiting, which
  // races the following COMMIT. Serialize access and use awaited statements.
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (depth > 0) {
      return fn();
    }
    const run = tail.then(async () => {
      depth += 1;
      try {
        return await fn();
      } finally {
        depth -= 1;
      }
    });
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    exec(sql) {
      return exclusive(() => db.execAsync(sql));
    },
    get<T>(sql: string, params: SqlParams = []) {
      return exclusive(() => db.getFirstAsync<T>(sql, ...params));
    },
    all<T>(sql: string, params: SqlParams = []) {
      return exclusive(() => db.getAllAsync<T>(sql, ...params));
    },
    async run(sql, params = []) {
      await exclusive(() => db.runAsync(sql, ...params));
    },
    transaction(fn) {
      return exclusive(async () => {
        await db.runAsync('BEGIN IMMEDIATE');
        try {
          const value = await fn();
          await db.runAsync('COMMIT');
          return value;
        } catch (error) {
          try {
            await db.runAsync('ROLLBACK');
          } catch {
            // The transaction may already have been rolled back.
          }
          throw error;
        }
      });
    },
  };
}

let opening: Promise<SQLiteDatabase> | null = null;

export function openHarnessDatabase(): Promise<SQLiteDatabase> {
  if (!opening) {
    opening = openDatabaseAsync(HARNESS_DATABASE_NAME)
      .then(async (db) => {
        const executor = expoExecutor(db);
        await migrateHarness(executor);
        await failInterruptedSessions(executor, Date.now());
        return db;
      })
      .catch((error: unknown) => {
        opening = null;
        throw error;
      });
  }
  return opening;
}

export function harnessExecutor(db: SQLiteDatabase): SqlExecutor {
  return expoExecutor(db);
}

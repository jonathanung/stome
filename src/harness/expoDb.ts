import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { HARNESS_DATABASE_NAME } from './contract';
import { serializedExecutor, type RawSql } from './serialized';
import { failInterruptedSessions, migrateHarness, type SqlExecutor, type SqlParams } from './store';

const rawByDatabase = new WeakMap<SQLiteDatabase, RawSql>();

function rawFromExpo(db: SQLiteDatabase): RawSql {
  const existing = rawByDatabase.get(db);
  if (existing) {
    return existing;
  }
  const raw: RawSql = {
    exec(sql) {
      return db.execAsync(sql);
    },
    get<T>(sql: string, params: SqlParams = []) {
      return db.getFirstAsync<T>(sql, ...params);
    },
    all<T>(sql: string, params: SqlParams = []) {
      return db.getAllAsync<T>(sql, ...params);
    },
    async run(sql, params = []) {
      await db.runAsync(sql, ...params);
    },
  };
  rawByDatabase.set(db, raw);
  return raw;
}

// One owner per Expo connection. BEGIN/COMMIT go through awaited runAsync
// because Expo web's execAsync('BEGIN') finalizes the statement too early.
export function expoExecutor(db: SQLiteDatabase): SqlExecutor {
  return serializedExecutor(rawFromExpo(db));
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

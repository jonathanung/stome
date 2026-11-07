import type { SQLiteDatabase } from 'expo-sqlite';

import { CONNECTION_PRAGMAS, migrationsFor, SUPPORTED_VERSION } from './schema';

export async function migrateDb(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(CONNECTION_PRAGMAS);

  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (version === null) {
    throw new Error('Could not read the database schema version');
  }

  const pending = migrationsFor(version.user_version);
  if (pending.length === 0) {
    return;
  }

  await db.withTransactionAsync(async () => {
    for (const migration of pending) {
      await db.execAsync(migration.sql);
    }
    await db.execAsync(`PRAGMA user_version = ${SUPPORTED_VERSION}`);
  });
}

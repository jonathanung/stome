import type { Db } from './driver.ts';
import { CONNECTION_PRAGMAS, MIGRATIONS, migrationsFor } from './schema.ts';

function assertContiguous(): void {
  MIGRATIONS.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(`Migration "${migration.name}" is version ${migration.version}, expected ${index + 1}`);
    }
  });
}

/**
 * Brings the database to the latest schema. Pending migrations and the
 * version bump run in one transaction, so a failure leaves the previous
 * version intact. Running it again on a current database does nothing.
 */
export async function migrateDb(db: Db): Promise<void> {
  assertContiguous();
  await db.exec(CONNECTION_PRAGMAS);

  const version = await db.get<{ user_version: number }>('PRAGMA user_version');
  if (version === null) {
    throw new Error('Could not read the database schema version');
  }

  const pending = migrationsFor(version.user_version);
  if (pending.length === 0) {
    return;
  }

  await db.transaction(async () => {
    for (const migration of pending) {
      await db.exec(migration.sql);
      await db.exec(`PRAGMA user_version = ${migration.version}`);
    }
  });
}

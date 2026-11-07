import type { SqlExecutor, SqlParams } from './store';

export type RawSql = {
  exec(sql: string): Promise<void>;
  get<T>(sql: string, params?: SqlParams): Promise<T | null>;
  all<T>(sql: string, params?: SqlParams): Promise<T[]>;
  run(sql: string, params?: SqlParams): Promise<void>;
};

const owners = new WeakMap<RawSql, SqlExecutor>();

function directExecutor(raw: RawSql): SqlExecutor {
  return {
    exec(sql) {
      return raw.exec(sql);
    },
    get(sql, params) {
      return raw.get(sql, params);
    },
    all(sql, params) {
      return raw.all(sql, params);
    },
    run(sql, params) {
      return raw.run(sql, params);
    },
    transaction() {
      return Promise.reject(new Error('A harness transaction cannot start another transaction'));
    },
  };
}

/**
 * One queue for a raw connection. Work from any caller waits its turn.
 * The transaction callback receives a direct executor, so its statements
 * stay on this connection without taking the queue again. Callers outside
 * that callback keep waiting until COMMIT or ROLLBACK.
 */
export function serializedExecutor(raw: RawSql): SqlExecutor {
  const existing = owners.get(raw);
  if (existing) {
    return existing;
  }
  let tail: Promise<void> = Promise.resolve();
  const direct = directExecutor(raw);
  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  const executor: SqlExecutor = {
    exec(sql) {
      return enqueue(() => direct.exec(sql));
    },
    get(sql, params) {
      return enqueue(() => direct.get(sql, params));
    },
    all(sql, params) {
      return enqueue(() => direct.all(sql, params));
    },
    run(sql, params) {
      return enqueue(() => direct.run(sql, params));
    },
    transaction(fn) {
      return enqueue(async () => {
        await direct.run('BEGIN IMMEDIATE');
        try {
          const value = await fn(direct);
          await direct.run('COMMIT');
          return value;
        } catch (error) {
          try {
            await direct.run('ROLLBACK');
          } catch {
            // The transaction may already have been rolled back.
          }
          throw error;
        }
      });
    },
  };
  owners.set(raw, executor);
  return executor;
}

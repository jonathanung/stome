/**
 * FND.2 (#36): every write goes through src/data/commit.ts. This fails if SQL
 * writes or raw driver write calls appear anywhere else under src/.
 * Migrations (schema.ts, migrate.ts) and the driver plumbing are allowed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const ALLOWED = new Set(
  ['src/data/commit.ts', 'src/db/schema.ts', 'src/db/migrate.ts', 'src/db/expo-driver.ts', 'src/db/driver.ts'].map((p) =>
    path.join(root, p),
  ),
);

const RULES: [RegExp, string][] = [
  [/\b(INSERT|REPLACE)\s+(OR\s+\w+\s+)?INTO\b/i, 'SQL INSERT/REPLACE'],
  [/\bUPDATE\s+\w+\s+SET\b/i, 'SQL UPDATE'],
  [/\bDELETE\s+FROM\b/i, 'SQL DELETE'],
  [/\b(CREATE|DROP|ALTER)\s+(TABLE|INDEX|TRIGGER)\b/i, 'SQL schema change'],
  [/\.(runAsync|execAsync|runSync|execSync|withTransactionAsync|withExclusiveTransactionAsync)\s*\(/, 'raw expo-sqlite write'],
  [/\bdb\.(run|exec|transaction)\s*\(/, 'Db write outside the boundary'],
];

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) yield full;
  }
}

const problems: string[] = [];
for (const file of files(path.join(root, 'src'))) {
  if (ALLOWED.has(file)) continue;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const [pattern, label] of RULES) {
        if (pattern.test(line)) problems.push(`${path.relative(root, file)}:${i + 1}  ${label}: ${line.trim()}`);
      }
    });
}

if (problems.length > 0) {
  console.error('Writes must go through src/data/commit.ts (FND.2, #36):\n' + problems.join('\n'));
  process.exit(1);
}
console.log('check:writes passed: no table writes outside src/data/commit.ts');

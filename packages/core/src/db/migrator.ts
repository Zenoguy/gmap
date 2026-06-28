import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function runMigrations(db: Database.Database): void {
  // Create migrations table if this is a brand new database
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      filename   TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  // Read all migration files, sorted numerically
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();  // "001_..." sorts before "002_..." lexicographically

  // Get already-applied versions
  const applied = new Set<number>(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[])
      .map(r => r.version)
  );

  // Run any migrations not yet applied — in a single transaction
  const runMigration = db.transaction((filename: string, version: number) => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf-8');
    db.exec(sql);
    db.prepare(
      'INSERT INTO schema_migrations (version, filename, applied_at) VALUES (?, ?, ?)'
    ).run(version, filename, Date.now());
  });

  for (const filename of files) {
    const version = parseInt(filename.slice(0, 3), 10);
    if (!applied.has(version)) {
      runMigration(filename, version);
      console.log(`[gmap] Applied migration: ${filename}`);
    }
  }
}

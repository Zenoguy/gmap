import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { runMigrations } from './migrator.js';

const DEFAULT_DB_PATH = path.join(os.homedir(), '.gmap', 'db.sqlite');

export function openDatabase(dbPath = DEFAULT_DB_PATH): Database.Database {
  // Ensure ~/.gmap/ exists
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  // Performance pragmas — set before any queries
  db.pragma('journal_mode = WAL');   // concurrent reads during writes
  db.pragma('foreign_keys = ON');    // enforce referential integrity
  db.pragma('synchronous = NORMAL'); // safe with WAL, faster than FULL
  db.pragma('cache_size = -32000');  // 32MB page cache
  db.pragma('temp_store = MEMORY');  // temp tables in RAM

  // Set file permissions to owner-only (0600) on first create
  fs.chmodSync(dbPath, 0o600);

  // Run any pending migrations
  runMigrations(db);

  return db;
}

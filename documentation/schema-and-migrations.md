# gmap — SQLite Schema & Migration Strategy

> This document is the source of truth for the gmap database layer.
> The schema defined here is implemented in `packages/core/src/db/`.
> Every schema change must go through the migration system — no exceptions.

---

## Core Principles

**Forward-only migrations.**
Migrations run in sequence and never roll back. If a migration breaks production,
the fix is a new migration forward — not a rollback. This matches how SQLite
behaves in practice (no transactional DDL rollback on schema changes).

**Migrations are append-only.**
Once a migration file is committed and shipped, it is never edited.
Fixing a mistake means writing a new migration.

**The database owns its version.**
A `schema_migrations` table tracks which migrations have run.
On startup, gmap compares the table against the migrations directory
and runs anything missing — in order.

**Schema changes are cheap before public launch, expensive after.**
The schema defined here is the last moment where breaking changes are free.
After M4 ships publicly, every change requires a migration that handles
existing user databases.

**Additive changes are always safe.**
Adding a column with a default, adding a table, adding an index —
these never break existing queries. Dropping or renaming columns
requires a multi-step migration (add new → backfill → remove old).

---

## Migration System

### File structure

```
packages/core/src/db/
  index.ts                  # connection, startup migration runner
  migrator.ts               # migration runner logic
  schema.ts                 # TypeScript types mirroring each table
  migrations/
    001_initial.sql         # files, symbols, imports, exports
    002_calls.sql           # calls table + indexes
    003_incremental.sql     # content_hash, scan sessions
    004_runtime.sql         # executions, runtime_events
    005_routes.sql          # routes table (extracted from symbols)
```

### schema_migrations table

Created before any other migration runs. Never modified by migrations.

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,   -- migration number (001, 002, ...)
  filename    TEXT NOT NULL,          -- "001_initial.sql"
  applied_at  INTEGER NOT NULL        -- unix timestamp ms
);
```

### Migration runner (migrator.ts)

```typescript
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

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
```

### DB connection (index.ts)

```typescript
import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { runMigrations } from './migrator';

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
```

---

## Migration 001 — Initial Schema

**File:** `migrations/001_initial.sql`

Covers: files, symbols, imports, exports.
This is the M1 deliverable — everything the repository scanner needs.

```sql
-- ============================================================
-- 001_initial.sql
-- Files, symbols, imports, exports.
-- ============================================================

-- --------------------------------------------------------
-- files
-- One row per source file in the scanned project.
-- --------------------------------------------------------
CREATE TABLE files (
  id             INTEGER PRIMARY KEY,
  path           TEXT    NOT NULL UNIQUE,   -- absolute path
  relative_path  TEXT    NOT NULL,          -- relative to scan root (for display)
  language       TEXT    NOT NULL,          -- 'typescript' | 'python' | etc.
  content_hash   TEXT    NOT NULL DEFAULT '', -- SHA-256 hex; '' until first scan
  last_scanned   INTEGER NOT NULL DEFAULT 0,  -- unix ms of last successful parse
  has_errors     INTEGER NOT NULL DEFAULT 0   -- 1 if last parse had errors
);

CREATE INDEX idx_files_path          ON files(path);
CREATE INDEX idx_files_content_hash  ON files(content_hash);

-- --------------------------------------------------------
-- symbols
-- One row per named construct (function, class, etc.)
-- --------------------------------------------------------
CREATE TABLE symbols (
  id               INTEGER PRIMARY KEY,
  name             TEXT    NOT NULL,    -- unqualified: "approveEstimate"
  qualified_name   TEXT    NOT NULL,    -- with class/ns: "ApprovalService.approveEstimate"
  kind             TEXT    NOT NULL
    CHECK(kind IN (
      'function','method','class','interface',
      'type','variable','enum','namespace','route','model'
    )),
  file_id          INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  line_start       INTEGER NOT NULL,
  line_end         INTEGER NOT NULL,
  col_start        INTEGER NOT NULL DEFAULT 0,
  col_end          INTEGER NOT NULL DEFAULT 0,
  is_exported      INTEGER NOT NULL DEFAULT 0,
  is_default_export INTEGER NOT NULL DEFAULT 0,
  parent_name      TEXT,               -- class/ns name for methods
  parameters       TEXT    NOT NULL DEFAULT '[]', -- JSON array of param names
  meta             TEXT    NOT NULL DEFAULT '{}'  -- JSON, adapter-specific
);

CREATE INDEX idx_symbols_name           ON symbols(name);
CREATE INDEX idx_symbols_qualified      ON symbols(qualified_name);
CREATE INDEX idx_symbols_file           ON symbols(file_id);
CREATE INDEX idx_symbols_kind           ON symbols(kind);
CREATE INDEX idx_symbols_name_file      ON symbols(name, file_id);

-- --------------------------------------------------------
-- imports
-- One row per import statement.
-- --------------------------------------------------------
CREATE TABLE imports (
  id              INTEGER PRIMARY KEY,
  from_file_id    INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  to_file_id      INTEGER REFERENCES files(id) ON DELETE SET NULL, -- null = external
  specifier       TEXT    NOT NULL,   -- raw: "@/utils", "./services/foo", "express"
  resolved_path   TEXT,               -- absolute path, null if external/unresolved
  is_external     INTEGER NOT NULL DEFAULT 0,
  kind            TEXT    NOT NULL
    CHECK(kind IN ('named','default','namespace','side-effect','dynamic','require')),
  imported_names  TEXT    NOT NULL DEFAULT '[]', -- JSON array
  local_alias     TEXT                           -- if renamed
);

CREATE INDEX idx_imports_from_file  ON imports(from_file_id);
CREATE INDEX idx_imports_to_file    ON imports(to_file_id);
CREATE INDEX idx_imports_specifier  ON imports(specifier);

-- --------------------------------------------------------
-- exports
-- One row per export statement.
-- --------------------------------------------------------
CREATE TABLE exports (
  id                  INTEGER PRIMARY KEY,
  file_id             INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  symbol_id           INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
  exported_name       TEXT    NOT NULL,
  local_name          TEXT,               -- internal name if different
  is_default          INTEGER NOT NULL DEFAULT 0,
  is_re_export        INTEGER NOT NULL DEFAULT 0,
  re_export_specifier TEXT                -- source specifier for re-exports
);

CREATE INDEX idx_exports_file         ON exports(file_id);
CREATE INDEX idx_exports_symbol       ON exports(symbol_id);
CREATE INDEX idx_exports_name         ON exports(exported_name);
```

---

## Migration 002 — Call Graph

**File:** `migrations/002_calls.sql`

Covers: the calls table. M2 deliverable.

```sql
-- ============================================================
-- 002_calls.sql
-- Call graph edges between symbols.
-- ============================================================

CREATE TABLE calls (
  id                  INTEGER PRIMARY KEY,
  caller_symbol_id    INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  callee_symbol_id    INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
                      -- null when resolution_status != 'resolved'
  callee_raw_name     TEXT    NOT NULL,   -- raw expression: "this.updateStatus"
  resolution_status   TEXT    NOT NULL
    CHECK(resolution_status IN ('resolved', 'unresolved', 'external', 'dynamic')),
  file_id             INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  line_number         INTEGER NOT NULL,
  col_number          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_calls_caller     ON calls(caller_symbol_id);
CREATE INDEX idx_calls_callee     ON calls(callee_symbol_id);
CREATE INDEX idx_calls_status     ON calls(resolution_status);
CREATE INDEX idx_calls_file       ON calls(file_id);

-- Composite index for the most common query:
-- "give me all callers of symbol X that are resolved"
CREATE INDEX idx_calls_callee_resolved
  ON calls(callee_symbol_id, resolution_status)
  WHERE resolution_status = 'resolved';
```

---

## Migration 003 — Incremental Indexing

**File:** `migrations/003_incremental.sql`

Covers: scan sessions, file scan state.
Enables `gmap scan` to skip files whose content hash hasn't changed.

```sql
-- ============================================================
-- 003_incremental.sql
-- Scan sessions and incremental indexing support.
-- ============================================================

-- --------------------------------------------------------
-- scan_sessions
-- One row per invocation of `gmap scan`.
-- Lets the dashboard show scan history and lets the indexer
-- know which files were seen in the most recent scan.
-- --------------------------------------------------------
CREATE TABLE scan_sessions (
  id           INTEGER PRIMARY KEY,
  project_root TEXT    NOT NULL,
  started_at   INTEGER NOT NULL,
  completed_at INTEGER,              -- null if scan is in progress or failed
  status       TEXT    NOT NULL DEFAULT 'running'
    CHECK(status IN ('running', 'complete', 'failed')),
  files_scanned   INTEGER NOT NULL DEFAULT 0,
  files_skipped   INTEGER NOT NULL DEFAULT 0,  -- skipped (hash unchanged)
  symbols_found   INTEGER NOT NULL DEFAULT 0,
  edges_found     INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT                          -- if status = 'failed'
);

-- --------------------------------------------------------
-- file_scan_state
-- Tracks per-file scan state across sessions.
-- The incremental indexer checks content_hash here before
-- deciding whether to re-parse a file.
-- --------------------------------------------------------
CREATE TABLE file_scan_state (
  file_id         INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  last_session_id INTEGER REFERENCES scan_sessions(id),
  content_hash    TEXT    NOT NULL,   -- hash at last successful parse
  symbol_count    INTEGER NOT NULL DEFAULT 0,
  import_count    INTEGER NOT NULL DEFAULT 0,
  call_count      INTEGER NOT NULL DEFAULT 0,
  parse_duration_ms INTEGER NOT NULL DEFAULT 0
);

-- --------------------------------------------------------
-- Incremental indexer decision logic (in TypeScript):
--
--   const state = db.prepare(
--     'SELECT content_hash FROM file_scan_state WHERE file_id = ?'
--   ).get(fileId);
--
--   const currentHash = sha256(fileContents);
--
--   if (state?.content_hash === currentHash) {
--     // File unchanged — skip parsing, reuse existing symbols/calls
--     session.filesSkipped++;
--     continue;
--   }
--
--   // File changed — delete old symbols and re-parse
--   // ON DELETE CASCADE handles symbols, imports, exports, calls
--   db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
--   const parsed = await adapter.parse(filePath, config);
--   await db.insertParsedFile(parsed);
-- --------------------------------------------------------
```

---

## Migration 004 — Runtime Tracing

**File:** `migrations/004_runtime.sql`

Covers: execution recording. M7 deliverable.
Added here so the schema is designed correctly from the start,
even though the tables are empty until M7 is implemented.

```sql
-- ============================================================
-- 004_runtime.sql
-- Runtime execution data from gmap record sessions.
-- ============================================================

CREATE TABLE record_sessions (
  id          INTEGER PRIMARY KEY,
  session_id  TEXT    NOT NULL UNIQUE,  -- UUID, passed to instrumentation layer
  command     TEXT    NOT NULL,          -- "node dist/server.js"
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  event_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE executions (
  id                INTEGER PRIMARY KEY,
  symbol_id         INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  record_session_id INTEGER NOT NULL REFERENCES record_sessions(id) ON DELETE CASCADE,
  call_count        INTEGER NOT NULL DEFAULT 0,
  total_duration_ms REAL    NOT NULL DEFAULT 0,
  min_duration_ms   REAL,
  max_duration_ms   REAL,
  first_seen        INTEGER NOT NULL,
  last_seen         INTEGER NOT NULL
);

CREATE INDEX idx_executions_symbol  ON executions(symbol_id);
CREATE INDEX idx_executions_session ON executions(record_session_id);

-- Composite for dashboard "hot paths" query:
-- "top N symbols by call_count across all sessions"
CREATE INDEX idx_executions_hot
  ON executions(call_count DESC, symbol_id);

CREATE TABLE runtime_events (
  id                INTEGER PRIMARY KEY,
  symbol_id         INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  record_session_id INTEGER NOT NULL REFERENCES record_sessions(id) ON DELETE CASCADE,
  caller_symbol_id  INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
  timestamp         INTEGER NOT NULL,  -- unix ms
  duration_ms       REAL               -- null for async calls not yet resolved
);

CREATE INDEX idx_runtime_events_symbol  ON runtime_events(symbol_id);
CREATE INDEX idx_runtime_events_session ON runtime_events(record_session_id);
CREATE INDEX idx_runtime_events_ts      ON runtime_events(timestamp);
```

---

## Migration 005 — Routes

**File:** `migrations/005_routes.sql`

Covers: HTTP routes as first-class entities, separate from symbols.
Extracted from symbols of kind='route' for richer querying.

```sql
-- ============================================================
-- 005_routes.sql
-- HTTP routes as first-class graph nodes.
-- ============================================================

CREATE TABLE routes (
  id           INTEGER PRIMARY KEY,
  symbol_id    INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  method       TEXT    NOT NULL
    CHECK(method IN ('GET','POST','PUT','PATCH','DELETE','ALL')),
  path_pattern TEXT    NOT NULL,   -- "/estimates/:id/approve"
  file_id      INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  line_number  INTEGER NOT NULL
);

CREATE INDEX idx_routes_symbol  ON routes(symbol_id);
CREATE INDEX idx_routes_method  ON routes(method);
CREATE INDEX idx_routes_file    ON routes(file_id);
```

---

## Schema Evolution Rules

These rules apply permanently — from M1 onward.

### Safe changes (no migration risk)
- Adding a new table
- Adding a column with a `DEFAULT` value to an existing table
- Adding an index
- Adding a new `CHECK` constraint value

### Requires care
- Adding a `NOT NULL` column without a default — must provide a backfill
- Changing a `CHECK` constraint — requires recreating the table (SQLite limitation)

### Never do without a multi-step migration
- Renaming a column
- Dropping a column
- Changing a column's type

### Multi-step rename pattern (example: renaming `last_scanned` → `last_parsed_at`)

```sql
-- Step 1 (migration N): add new column
ALTER TABLE files ADD COLUMN last_parsed_at INTEGER NOT NULL DEFAULT 0;

-- Step 2 (same migration): backfill from old column
UPDATE files SET last_parsed_at = last_scanned;

-- Step 3 (migration N+1, after confirming no queries use old name):
-- SQLite does not support DROP COLUMN before 3.35.0.
-- For older SQLite: recreate the table without the old column.
-- For SQLite >= 3.35.0:
ALTER TABLE files DROP COLUMN last_scanned;
```

---

## TypeScript Schema Types

Mirror of every table as a TypeScript interface.
These are what `better-sqlite3` query results are typed as.
`schema.ts` in the db package.

```typescript
// packages/core/src/db/schema.ts

export interface FileRow {
  id: number;
  path: string;
  relative_path: string;
  language: string;
  content_hash: string;
  last_scanned: number;
  has_errors: 0 | 1;
}

export interface SymbolRow {
  id: number;
  name: string;
  qualified_name: string;
  kind: string;
  file_id: number;
  line_start: number;
  line_end: number;
  col_start: number;
  col_end: number;
  is_exported: 0 | 1;
  is_default_export: 0 | 1;
  parent_name: string | null;
  parameters: string;       // JSON string — parse with JSON.parse()
  meta: string;             // JSON string — parse with JSON.parse()
}

export interface ImportRow {
  id: number;
  from_file_id: number;
  to_file_id: number | null;
  specifier: string;
  resolved_path: string | null;
  is_external: 0 | 1;
  kind: string;
  imported_names: string;   // JSON string
  local_alias: string | null;
}

export interface ExportRow {
  id: number;
  file_id: number;
  symbol_id: number | null;
  exported_name: string;
  local_name: string | null;
  is_default: 0 | 1;
  is_re_export: 0 | 1;
  re_export_specifier: string | null;
}

export interface CallRow {
  id: number;
  caller_symbol_id: number;
  callee_symbol_id: number | null;
  callee_raw_name: string;
  resolution_status: 'resolved' | 'unresolved' | 'external' | 'dynamic';
  file_id: number;
  line_number: number;
  col_number: number;
}

export interface ScanSessionRow {
  id: number;
  project_root: string;
  started_at: number;
  completed_at: number | null;
  status: 'running' | 'complete' | 'failed';
  files_scanned: number;
  files_skipped: number;
  symbols_found: number;
  edges_found: number;
  error_message: string | null;
}

export interface ExecutionRow {
  id: number;
  symbol_id: number;
  record_session_id: number;
  call_count: number;
  total_duration_ms: number;
  min_duration_ms: number | null;
  max_duration_ms: number | null;
  first_seen: number;
  last_seen: number;
}

export interface RouteRow {
  id: number;
  symbol_id: number;
  method: string;
  path_pattern: string;
  file_id: number;
  line_number: number;
}
```

---

## Common Queries

The queries that will be run most frequently.
Indexes are designed around these.

```sql
-- All callers of a symbol (impact analysis, gmap why)
SELECT s.name, s.qualified_name, f.relative_path, c.line_number
FROM calls c
JOIN symbols s ON s.id = c.caller_symbol_id
JOIN files f   ON f.id = s.file_id
WHERE c.callee_symbol_id = ?
  AND c.resolution_status = 'resolved';

-- All callees of a symbol (gmap calls)
SELECT s.name, s.qualified_name, f.relative_path, c.line_number
FROM calls c
LEFT JOIN symbols s ON s.id = c.callee_symbol_id
JOIN files f        ON f.id = c.file_id
WHERE c.caller_symbol_id = ?;

-- Resolve a symbol by name (may return multiple — same name, different files)
SELECT s.*, f.relative_path
FROM symbols s
JOIN files f ON f.id = s.file_id
WHERE s.name = ?
ORDER BY s.is_exported DESC;

-- Incremental scan: files whose hash has changed since last scan
SELECT f.id, f.path, fss.content_hash as cached_hash
FROM files f
LEFT JOIN file_scan_state fss ON fss.file_id = f.id
WHERE fss.content_hash IS NULL        -- never scanned
   OR fss.content_hash != f.content_hash; -- changed

-- Hot paths: top 20 most-executed symbols across all sessions
SELECT s.name, s.qualified_name, f.relative_path,
       SUM(e.call_count) as total_calls
FROM executions e
JOIN symbols s ON s.id = e.symbol_id
JOIN files f   ON f.id = s.file_id
GROUP BY e.symbol_id
ORDER BY total_calls DESC
LIMIT 20;

-- Dead code candidates: symbols never executed across any session
SELECT s.name, s.qualified_name, f.relative_path
FROM symbols s
JOIN files f ON f.id = s.file_id
WHERE s.kind IN ('function', 'method')
  AND s.id NOT IN (
    SELECT DISTINCT symbol_id FROM executions
  );
```

---

## Testing Strategy

Every migration must be tested with a dedicated test file.

```typescript
// tests/db/migrations.test.ts

describe('migration runner', () => {
  it('creates schema_migrations table on first run')
  it('applies all migrations on a fresh database in order')
  it('skips already-applied migrations on second run')
  it('is idempotent — running twice produces the same schema')
  it('runs each migration in a transaction — partial failure leaves db unchanged')
  it('records correct version and filename in schema_migrations')
})

describe('migration 001 — initial schema', () => {
  it('creates files table with all required columns')
  it('creates symbols table with kind CHECK constraint')
  it('creates imports table with kind CHECK constraint')
  it('creates exports table')
  it('enforces foreign key: symbols.file_id references files.id')
  it('ON DELETE CASCADE: deleting a file deletes its symbols')
  it('ON DELETE CASCADE: deleting a file deletes its imports')
})

describe('migration 002 — calls', () => {
  it('creates calls table with resolution_status CHECK constraint')
  it('ON DELETE CASCADE: deleting a symbol deletes its outgoing calls')
  it('callee_symbol_id is nullable for unresolved calls')
})

describe('migration 003 — incremental', () => {
  it('creates scan_sessions table')
  it('creates file_scan_state table')
  it('file_scan_state.file_id references files.id with CASCADE')
})

describe('incremental indexer', () => {
  it('skips a file whose content_hash matches file_scan_state')
  it('re-parses a file whose content_hash has changed')
  it('re-parses a file with no file_scan_state entry')
  it('deletes old symbols before inserting new ones on re-parse')
  it('cascade delete removes calls when symbols are deleted on re-parse')
})
```

---

## Summary

| Migration | Tables added | M milestone |
|-----------|-------------|-------------|
| 001 | `files`, `symbols`, `imports`, `exports` | M1 |
| 002 | `calls` | M2 |
| 003 | `scan_sessions`, `file_scan_state` | M1 (design), M3 (impl) |
| 004 | `record_sessions`, `executions`, `runtime_events` | M7 |
| 005 | `routes` | M2 |

The migration runner, `schema_migrations` table, and `content_hash`
column on `files` are all implemented in M1 — before any other
milestone creates tables. This is non-negotiable: retrofitting
migrations onto an existing schema is harder than starting with them.

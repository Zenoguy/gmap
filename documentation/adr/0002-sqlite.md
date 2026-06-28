# ADR 0002 — SQLite as the single source of truth

**Status**: Accepted  
**Date**: June 2026  
**Deciders**: Core team

---

## Problem

The symbol graph, call edges, import/export relationships, and runtime execution data need to be persisted across CLI invocations and shared between the CLI, API server, and VS Code extension — all running on the same machine. The storage layer must support fast reads for hover cards and impact queries while also allowing bulk writes during a scan of hundreds of files.

---

## Alternatives

| Option | Description |
|---|---|
| **SQLite** ✅ | Embedded relational DB. Single file, zero server process, ACID-compliant. |
| **JSON files** | Per-file or per-project JSON blobs on disk. Simple writes, slow cross-file queries. |
| **LevelDB / RocksDB** | Embedded key-value store. Fast writes, awkward for relational graph traversal. |
| **PostgreSQL / MySQL** | Full server-mode RDBMS. Requires a running server process, installation, auth. Overkill for local use. |
| **In-memory only** | No persistence. Every invocation re-scans from scratch. |

---

## Tradeoffs

### SQLite advantages
- Zero install: ships as a native Node module (`better-sqlite3`), no separate server.
- Single `.sqlite` file = easy backup, easy deletion, easy relocation.
- Relational model is a natural fit for the symbol graph (symbols, calls, imports are naturally relational).
- WAL mode enables concurrent reads from VS Code extension + API server while the scanner writes.
- SQL query planner handles complex traversal queries (callers of callers, blast radius) without bespoke graph algorithms.
- Battle-tested at much larger scales than gmap needs.

### SQLite disadvantages
- Not horizontally scalable — but gmap is intentionally single-machine.
- Concurrent write bottleneck — mitigated by WAL mode and the fact that only one scanner runs at a time.
- `better-sqlite3` requires native compilation (C++ bindings). Adds installation complexity, especially on newer Node versions.
- Full-text search is limited (though `FTS5` extension covers symbol name search adequately).

---

## Decision

**SQLite via `better-sqlite3` is the sole persistence layer for V1.**

- Default path: `~/.gmap/db.sqlite`. Configurable via `--db` flag or `gmap.config.json`.
- The in-memory graph at runtime is a **read-through cache** built from SQLite on server startup. No secondary in-memory store is introduced.
- All schema changes go through the migration system (`migrator.ts`). No ad-hoc `ALTER TABLE` outside migrations.
- No other persistence layer (Redis, Postgres, flat files) is introduced in V1. Any future distributed features are post-V1.

### SQLite pragmas (set on every connection)

```sql
PRAGMA journal_mode = WAL;    -- concurrent reads during writes
PRAGMA foreign_keys = ON;     -- enforce referential integrity
PRAGMA synchronous = NORMAL;  -- safe with WAL, faster than FULL
PRAGMA cache_size = -32000;   -- 32MB page cache
PRAGMA temp_store = MEMORY;   -- temp tables in RAM
```

---

## Consequences

- **Migration system**: forward-only, append-only SQL migration files. See `schema-and-migrations.md` for the full strategy.
- **`better-sqlite3` version**: must be kept in sync with the active Node.js version. Node 25 requires `better-sqlite3 >=12.x`.
- **File permissions**: `~/.gmap/db.sqlite` is created with `0600` (owner read/write only).
- **Concurrency**: the scanner holds a write lock during scan. The API server runs concurrent reads via WAL. This is safe and is the designed mode of operation.
- **Portability**: the `.sqlite` file is fully portable between machines with the same schema version. Useful for debugging — copy the file, inspect with any SQLite GUI.

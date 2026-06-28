# Error Philosophy and Handling Standards

Consistency in error handling keeps the codebase predictable and prevents unexpected runtime failures in consumer processes (CLI, API Server, VS Code Extension).

---

## 1. The Core Principle: Boundaries Do Not Throw

We divide the codebase into **Internal Code** (within a single module) and **Boundary APIs** (functions exported from `@gmap/core` to CLI/Server, or language adapters called by the scanner).

1. **Internal Code**: May throw exceptions for programmer mistakes (e.g. invalid arguments, internal assertion failures).
2. **Boundary APIs**: **Must never throw.** They must return a structured result type carrying both success details and clean failure states.

---

## 2. Language Adapters Contract

Any class implementing the `LanguageAdapter` interface (e.g. `TypeScriptAdapter`) must trap all exceptions during parsing:

```typescript
export interface ParsedFile {
  filePath: string;
  symbols: ParsedSymbol[];
  calls: ParsedCall[];
  imports: ParsedImport[];
  hasErrors: boolean;
  errors: Array<{
    message: string;
    line?: number;
    column?: number;
    severity: 'warning' | 'error';
  }>;
}
```

**Rule**: An adapter must parse whatever is valid and collect syntactic/semantic errors into `errors`, rather than throwing. The parser must never abort the entire scan of a repository.

---

## 3. Database and Graph Engine

The core graph engine wraps SQLite queries in safe execution containers:

- Raw database constraint violations or driver errors must be caught in `@gmap/core/src/db/`.
- Queries returning data should follow the Result wrapper or return empty collection representations (e.g. empty array, `null`) with a clear error payload if the query execution itself failed.

---

## 4. User-Facing CLI Commands

CLI commands wrap all engine invocations in visual error catchers:
- **Clean output**: Stack traces must never be shown to the user unless the `--verbose` or `DEBUG` environment flags are explicitly present.
- **Actionable tips**: An error should tell the user how to fix it.
  - *Bad*: `Error: SQLite database is locked.`
  - *Good*: `Database is currently locked by another scan. Please wait for the current scan to finish, or verify that no other gmap processes are running.`

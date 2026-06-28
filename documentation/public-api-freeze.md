# Public API Freeze and Exports Guide

As `@gmap/core` is consumed by the CLI, Server, VS Code Extension, and Tracer, maintaining a strict boundary between public, internal, and experimental code is critical to avoiding unintended API breaks.

---

## 1. Export Design Rules

We categorize all exports into three namespaces:

```
                  ┌────────────────────────────────────────┐
                  │              @gmap/core                │
                  └────────────────────────────────────────┘
                       │             │              │
                       ▼             ▼              ▼
                 /public/*       /internal/*    /experimental/*
                 Stable &         Core-only      Unstable,
                 Supported        Helpers        Subject to Change
```

### 🟥 Public APIs (`public`)
- **Location**: Exported from main entry points like `packages/core/src/index.ts`.
- **Guarantee**: Semantic Versioning (SemVer) strictly applies. Breaking changes to these APIs require a major version bump.
- **Examples**: `LanguageAdapter`, `AdapterRegistry`, `openDatabase`, `ParsedFile`.

### 🟨 Internal APIs (`internal`)
- **Location**: Files under `packages/core/src/internal/` or modules not exported in `index.ts`.
- **Guarantee**: No API guarantee. Sibling packages (CLI, Server) **must not** import from internal namespaces.
- **Policy**: Internal details may be refactored or deleted at any time without notice.

### 🟦 Experimental APIs (`experimental`)
- **Location**: Exported under a designated `experimental` namespace or marked clearly with `@experimental` JSDoc annotations.
- **Guarantee**: Unstable API. Subject to change or removal in any patch release.

---

## 2. Enforcement via JSDoc and Types

All public members must be decorated with appropriate JSDoc tags to guide IDE tooling for external contributors:

```typescript
/**
 * Resolves callers for a given symbol up to a specified depth.
 * 
 * @public
 * @param symbol - Name of the symbol to trace.
 * @param options.depth - Maximum traversal recursion depth.
 * @returns Array of matching call nodes.
 */
export function getCallers(symbol: string, options: { depth: number }): CallNode[] {
  // ...
}

/**
 * Internal SQL traversal logic.
 * 
 * @internal
 */
export function _rawSqlTraverse(...) {
  // ...
}
```

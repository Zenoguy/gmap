# ADR 0003 — Language-agnostic adapter architecture

**Status**: Accepted  
**Date**: June 2026  
**Deciders**: Core team

---

## Problem

gmap starts as a TypeScript/JavaScript tool, but the long-term goal is to support Python, Go, Rust, and other languages. If TypeScript-specific code leaks into the graph engine, API server, or dashboard, adding new languages requires touching the core rather than extending it. This is exactly the kind of structural mistake that becomes expensive to fix after V1 ships.

---

## Alternatives

| Option | Description |
|---|---|
| **Monolithic parser** | TypeScript parser baked directly into the graph engine. Fast to build initially, impossible to extend cleanly. |
| **Per-language forks** | Separate gmap-ts, gmap-py, gmap-go products. High duplication, fragmented ecosystem. |
| **Plugin system with dynamic loading** | Adapters discovered at runtime from a registry, loaded via `require()` or dynamic `import()`. Flexible but complex. |
| **Canonical adapter interface** ✅ | A typed contract (`LanguageAdapter`) that every parser implements. The scanner depends only on the interface, never on a specific adapter. |

---

## Tradeoffs

### Adapter interface advantages
- Adding Python support = implement `LanguageAdapter`, register it. Zero changes to scanner, graph engine, API, or dashboard.
- The `ParsedFile` output type is the only cross-boundary type. Fully typed, validated at compile time.
- Adapters are stateless between files (per-scan state initialised in `initialize()`, torn down in `dispose()`). Safe for concurrent parsing.
- The TypeScript adapter ships in V1. Future adapters ship as separate packages without touching `@gmap/core`.

### Adapter interface disadvantages
- Upfront design cost: the `ParsedFile` contract must be designed to accommodate languages not yet implemented.
- Some language constructs don't map cleanly to the canonical types (e.g., Python's duck typing, Go's implicit interfaces). The `meta` field on `ParsedSymbol` absorbs adapter-specific data.
- Adapter authors must understand the full contract, including the error handling rules.

---

## Decision

**The parser layer is language-specific. Everything above it is language-agnostic.**

The boundary is defined by three types in `packages/core/src/adapters/language-adapter.ts`:

- `ParsedFile` — the complete output of one adapter call for one source file.
- `LanguageAdapter` — the interface every adapter must implement.
- `AdapterRegistry` — the single point through which the scanner selects an adapter.

### Contract rules (non-negotiable)

1. `parse()` **must never throw**. All errors go into `ParsedFile.errors`. A broken file returns a `ParsedFile` with `hasErrors: true` and whatever partial data was extractable.
2. `parse()` must be safe to call concurrently for different file paths.
3. No language-specific type may be imported above the adapter layer. The scanner, graph engine, API, and dashboard see only `ParsedFile`, `ParsedSymbol`, `ParsedCall`, etc.
4. `AdapterRegistry.resolve()` returns `null` for unrecognised files. The scanner skips them silently.

### V1 adapters

| Language | Adapter | Dependency |
|---|---|---|
| TypeScript / JavaScript | `TypeScriptAdapter` | `ts-morph` |
| Python | _future_ | TBD (tree-sitter or ast module via subprocess) |
| Go | _future_ | TBD |

---

## Consequences

- **`ts-morph` is scoped to `@gmap/core`**. It is a dev dependency of the TypeScript adapter only — never imported anywhere else.
- **`AdapterConfig`** contains all project-level context (tsconfig path, path aliases, exclude patterns) that adapters need. It grows additively — new fields are always optional.
- **The `meta` field** on `ParsedSymbol` is the escape hatch for adapter-specific data that doesn't fit canonical fields. The graph engine ignores it; adapter-specific features can read it.
- **Future adapters** can be shipped as separate npm packages (`@gmap/adapter-python`) without requiring a core version bump.
- **Testing**: each adapter has its own fixture projects (`simple-project/`, `aliased-project/`, etc.) and test suite. The core scanner tests use mock adapters, never real parsers.

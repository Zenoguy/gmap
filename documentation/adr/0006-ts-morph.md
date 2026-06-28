# ADR 0006 — ts-morph over raw TypeScript Compiler API

**Status**: Accepted  
**Date**: June 2026  
**Deciders**: Core team

---

## Problem

The TypeScript language adapter needs to parse source files, extract symbols (functions, classes, variables, types), resolve call relationships, and follow import edges. The TypeScript Compiler API provides all of this — but it is notoriously low-level. The question is whether to use it directly or through an abstraction.

---

## Alternatives

| Option | Description |
|---|---|
| **Raw TypeScript Compiler API** | Maximum control, no abstraction overhead. Extremely verbose; requires deep familiarity with AST node types. |
| **ts-morph** ✅ | High-level wrapper around the Compiler API. Object-oriented API with named methods instead of raw AST traversal. |
| **@typescript-eslint/typescript-estree** | ESLint's parser. Produces ESTree AST. Well-documented but not designed for symbol resolution or cross-file analysis. |
| **Babel parser** | Fast JavaScript/TypeScript parser. No type information — cannot resolve references across files. |
| **tree-sitter** | Universal, fast, incremental parser. No TypeScript type system awareness. Useful for other language adapters; wrong tool for TypeScript. |

---

## Tradeoffs

### ts-morph advantages
- Dramatically less boilerplate: `sourceFile.getFunctions()` vs. iterating AST node types manually.
- `Project` class handles tsconfig loading, path alias resolution, and cross-file reference following automatically.
- `Symbol.getDeclarations()` and `Node.findReferences()` work correctly across the entire project, not just a single file.
- `TypeChecker` is exposed for cases requiring type-level analysis.
- Well-maintained; tracks upstream TypeScript releases closely.

### ts-morph disadvantages
- Abstraction layer means less control in edge cases (e.g., synthetic nodes, incremental compilation).
- Adds a dependency; ts-morph version must align with the TypeScript version in the project under analysis.
- Slightly higher startup cost than raw API for large projects (ts-morph builds its own project model).

---

## Decision

**Use ts-morph as the default interface for the TypeScript adapter.**

Drop down to the raw TypeScript Compiler API (`sourceFile.compilerNode`, `project.getTypeChecker().compilerObject`) only for specific edge cases that ts-morph cannot express.

The rule: if ts-morph has a method for it, use it. If not, access `compilerNode` — but document the reason in a code comment.

---

## Consequences

- **`ts-morph`** is a production dependency of `@gmap/core` (it is required at scan time, not just build time).
- **Version pinning**: ts-morph's version of the TypeScript compiler may differ from the analysed project's TypeScript version. The adapter must use `addSourceFilesFromTsConfig()` which picks up the project's own TypeScript installation, not gmap's.
- **`Project` caching**: creating a `ts-morph` `Project` is expensive. The `TypeScriptAdapter` creates one per scan and reuses it across all files in that scan (the `initialize()` / `dispose()` lifecycle in the adapter interface handles this).
- **Other language adapters** must NOT use ts-morph. It is scoped exclusively to `TypeScriptAdapter`. Python, Go, and Rust adapters will use language-appropriate parsers (tree-sitter is the likely common choice).

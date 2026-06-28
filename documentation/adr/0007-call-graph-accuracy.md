# ADR 0007 — Call graph accuracy over completeness

**Status**: Accepted  
**Date**: June 2026  
**Deciders**: Core team

---

## Problem

Static analysis of TypeScript has fundamental limits. Dynamic `require()`, dependency injection containers, higher-order functions, and conditional imports create call relationships that cannot be resolved at parse time. The question is: what should gmap do when it cannot confidently trace an edge?

---

## Alternatives

| Option | Description |
|---|---|
| **Drop unresolvable edges** | Only emit edges that can be fully resolved. The graph is complete but misleadingly clean — users think nothing is missing. |
| **Best-effort guessing** | Heuristics to infer likely targets (e.g., "this DI token usually resolves to X"). Fast, but introduces false confidence. |
| **Mark as `unresolved`** ✅ | Record the edge with `resolved: false` and surface it to the user. The graph is honest about what it doesn't know. |
| **Runtime tracing only** | Don't do static analysis at all; instrument the runtime to capture real call edges. Accurate but requires running the code. |

---

## Tradeoffs

### Mark as `unresolved` advantages
- The graph is honest. A developer can see "there are 3 unresolved call edges from this function" and investigate manually.
- No false positives — gmap never claims a function is safe to delete when an unresolved edge might reference it.
- Unresolved edges can be enriched later (M7 runtime tracer) without changing the storage schema.
- Users learn what gmap can and cannot do. Trust is built by honesty, not by hiding limitations.

### Mark as `unresolved` disadvantages
- More complex graph rendering (the dashboard must visually distinguish resolved from unresolved edges).
- Impact analysis must conservatively include all unresolved edges in the blast radius calculation.
- Users may be confused by edges that "go nowhere".

---

## Decision

**gmap marks edges it cannot resolve as `unresolved` and surfaces them explicitly. It never silently drops edges and never guesses.**

### Resolution rules

| Pattern | Resolution |
|---|---|
| Direct function call (`foo()`) | ✅ Fully resolved |
| Method call on known type (`obj.method()`) | ✅ Fully resolved |
| Dynamic `require(variable)` | ⚠️ `unresolved` — dynamic path logged |
| DI token lookup (`container.get(TOKEN)`) | ⚠️ `unresolved` — DI framework noted in `meta` |
| Higher-order function (`fn()` where `fn` is a parameter) | ⚠️ `unresolved` — parameter name recorded |
| Conditional import (`if (x) require('a'); else require('b')`) | ⚠️ `unresolved` — both branches recorded as candidates |

### Schema representation

The `calls` table includes `resolved BOOLEAN NOT NULL DEFAULT 1`. The `ParsedCall` type carries `resolved: boolean` and `unresolvedReason?: string`.

---

## Consequences

- **Impact analysis** (`gmap impact <symbol>`): conservatively assumes all unresolved edges are real. A function with unresolved call edges is never reported as "safe to delete".
- **Dashboard**: unresolved edges are rendered with a dashed line and a distinct colour. A legend explains the distinction.
- **Runtime tracer** (M7): when tracer data arrives, it upgrades `unresolved` edges to `resolved` or removes them if the call was never observed. This is the designed upgrade path.
- **Reporting**: `gmap scan` outputs a summary line: `47 symbols · 213 edges (12 unresolved)`. Users always know the graph's completeness state.

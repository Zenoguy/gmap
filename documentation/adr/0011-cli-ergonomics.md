# ADR 0011 — CLI commands read like plain English

**Status**: Accepted  
**Date**: June 2026  
**Deciders**: Core team

---

## Problem

Developer tools frequently use terse, abbreviated, or opaque command names. `gmap` is a codebase understanding tool — it should itself be easily understood. The CLI is the first interface most users encounter. If its commands require reading documentation, the tool has failed its own premise.

---

## Alternatives

| Style | Example | Problem |
|---|---|---|
| **Abbreviated flags** | `gmap -c -r -d=5 updateStatus` | Requires memorisation; not self-documenting |
| **Noun-verb (git-style)** | `gmap symbol get updateStatus` | Awkward; "symbol get" is not how engineers think |
| **Verb-noun** ✅ | `gmap why updateStatus` | Reads like a question; self-documenting |
| **URL-style paths** | `gmap symbols/updateStatus/callers` | Looks like a REST API, not a CLI |

---

## Decision

**Every `gmap` command reads like a question or instruction a developer would say out loud.**

### V1 command vocabulary

| Command | Meaning | Internal operation |
|---|---|---|
| `gmap scan .` | Index this project | File walk + adapter parse + SQLite write |
| `gmap why <symbol>` | Who calls this? | Callers query, depth configurable |
| `gmap impact <symbol>` | What breaks if I change this? | Blast radius traversal |
| `gmap trace <symbol>` | Show the full call chain | DFS from root to symbol |
| `gmap explain <symbol>` | Describe what this does (AI) | Graph snapshot → AI provider |

### Rules

1. **No abbreviations in command names**. `scan` not `scn`. `impact` not `imp`. `explain` not `exp`.
2. **Symbols are always named, never addressed by ID**. `gmap why updateStatus`, not `gmap why 1042`.
3. **Flags use full words**. `--depth` not `-d`. `--format` not `-f`. Single-character shortcuts are allowed as aliases but not as the primary interface.
4. **Error messages follow the same plain-English standard**. `Cannot find symbol "updateStatus". Did you mean "updateEstimateStatus"?`

---

## Consequences

- **Commander.js** is used as the CLI framework (already installed). Command definitions live in `packages/cli/src/commands/`.
- **No positional argument ambiguity**: every command takes exactly one symbol name as its subject. Multi-symbol queries use `--and <symbol>` flags.
- **Help text** is written in plain English, not technical jargon. Each command's `--help` output answers "what does this do and when would I use it?"
- **Tab completion** is a post-V1 nice-to-have. The command vocabulary is simple enough that completion is rarely needed.

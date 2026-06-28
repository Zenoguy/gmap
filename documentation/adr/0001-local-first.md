# ADR 0001 — Local-first, server-optional

**Status**: Accepted  
**Date**: June 2026  
**Deciders**: Core team

---

## Problem

Developer tools that require cloud accounts, API keys, or network connectivity have high friction at first run. They also raise legitimate privacy concerns when the tool analyses proprietary source code — code that should never leave the developer's machine.

---

## Alternatives

| Option | Description |
|---|---|
| **Cloud-first** | Scan results stored and served from a remote backend. Enables cross-machine sharing and team features. |
| **Hybrid** | Local scan, optional cloud sync for sharing. |
| **Local-first** ✅ | Everything runs on the developer's machine. No cloud by default. Remote access only via explicit opt-in. |

---

## Tradeoffs

### Local-first advantages
- Zero setup friction: `gmap scan .` works immediately, no account required.
- Source code never leaves the machine by default — safe for proprietary codebases.
- Works offline, no dependency on external uptime.
- Simpler security model: attack surface is `localhost` only.

### Local-first disadvantages
- No built-in team sharing (e.g., "here's the impact report for this PR").
- Each developer's machine must run its own scan.
- Cross-machine features (CI integration, shared indexes) require explicit `--host` flag — documented separately.

---

## Decision

**gmap runs entirely on the developer's machine.**

- The API server binds to `127.0.0.1` only. Binding to `0.0.0.0` requires an explicit `--host` flag with a documented security warning.
- No telemetry is collected. No background network requests are made.
- No account or API key is required for any core feature (scan, call graph, impact analysis, dashboard, VS Code extension).
- The SQLite database is stored at `~/.gmap/db.sqlite` by default, owned by the user, with `0600` permissions.

---

## Consequences

- **API server**: CORS policy must allow only `localhost` and `127.0.0.1` origins. WebSocket `Origin` header is validated on handshake.
- **VS Code extension**: connects only to `127.0.0.1:7842` — no external hosts.
- **AI layer** (M8): external AI providers (Anthropic, OpenAI) are an explicit opt-in. Ollama (local) is the zero-config path.
- **Future**: team sharing, CI integration, and cloud sync are post-V1 features — the architecture must not bake in assumptions that prevent them, but they are not in scope for V1.

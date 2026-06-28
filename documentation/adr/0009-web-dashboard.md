# ADR 0009 — Web dashboard over terminal UI

**Status**: Accepted  
**Date**: June 2026  
**Deciders**: Core team

---

## Problem

A graph-based codebase tool needs to render graphs. The question is whether to render them in the terminal (TUI) or in a browser (web dashboard).

---

## Alternatives

| Option | Description |
|---|---|
| **Terminal UI (Ink / Blessed)** | Rich terminal rendering. Works in SSH sessions; no browser required. Cannot render interactive node-link graphs. |
| **Web dashboard (localhost)** ✅ | Browser-based. Full graph visualisation via Cytoscape.js. Shareable screenshots. Progressive enhancement. |
| **Electron desktop app** | Native app wrapping a browser. Heavy bundle size (~200MB); complex distribution; overkill for V1. |
| **No UI** | CLI output only. Maximum simplicity; no graph visualisation possible. |

---

## Tradeoffs

### Web dashboard advantages
- Cytoscape.js provides production-grade, interactive node-link graph rendering in a browser — something no TUI can replicate.
- Screenshots of the graph can be shared in PRs and Slack.
- The dashboard is static HTML/JS served by the gmap API server — no separate process.
- React + TypeScript = same language as the rest of the stack. No Python runtime, no Rust compile step.
- Progressive: the dashboard is a `localhost` URL. Users can bookmark it, open it in multiple tabs, zoom/filter interactively.

### Web dashboard disadvantages
- Requires a browser to use (most developers have one open anyway).
- Cannot be used over SSH without port forwarding.
- Adds a React/Vite build step to the monorepo.

---

## Decision

**The dashboard is browser-based, served at `localhost:7842` by the gmap API server.**

- Technology stack: React + TypeScript + Cytoscape.js for graph rendering.
- The dashboard is built to `packages/server/dist/public/` by the `@gmap/dashboard` Vite build. The server serves it as static files.
- The dashboard connects to the same API server for REST queries and WebSocket events.
- A TUI (`gmap scan .` output) remains the primary feedback channel for non-graph output (scan progress, symbol counts, error lists).

---

## Consequences

- **Two-runtime problem is avoided**: the dashboard is served by the same Node.js process as the API server. No Python or separate runtime required.
- **Production build**: `packages/dashboard/vite.config.ts` outputs to `../server/dist/public/` — the server's static file directory. One `pnpm build` produces both.
- **Dev experience**: in development, the Vite dev server runs on port 7843 and proxies `/api` and `/ws` to `localhost:7842`. Hot module replacement works normally.
- **Graph rendering**: Cytoscape.js is the only graph library evaluated for V1. Alternatives (D3 force-directed, vis.js) are not in scope. If Cytoscape.js proves inadequate post-V1, it can be swapped without changing the data layer.

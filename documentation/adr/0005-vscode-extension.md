# ADR 0005 — VS Code extension as primary distribution surface

**Status**: Accepted  
**Date**: June 2026  
**Deciders**: Core team

---

## Problem

gmap needs to be where developers spend their time. A standalone CLI or a browser dashboard requires context-switching out of the editor. The question is: what is the highest-leverage distribution surface for reaching developers who need codebase understanding?

---

## Alternatives

| Option | Description |
|---|---|
| **CLI only** | Power-user path. Requires terminal switching; rich output not possible in a terminal. |
| **Web dashboard only** | Browser-based, rich visualisation. Requires opening a browser tab; no hover-on-symbol UX. |
| **VS Code extension** ✅ | Lives inside the tool developers already have open. Hover cards, CodeLens, sidebar panel — native editor UX. |
| **JetBrains plugin** | Large market share in Java/Kotlin/Python. Separate implementation effort; not in scope for V1. |
| **Language Server Protocol (LSP)** | Universal protocol for editor features. More complex than a VS Code extension for V1; future-proofing path. |

---

## Tradeoffs

### VS Code extension advantages
- Puts gmap inside the editor with zero context-switching: hover a symbol, see who calls it.
- VS Code Marketplace gives one-click install to 30M+ users.
- CodeLens annotations appear inline with code — no alt-tab required.
- Shares the same SQLite index and API server as the CLI. No separate data path.

### VS Code extension disadvantages
- Extension runs in its own process, cannot directly import `@gmap/core`. Must talk to the API server via HTTP/WebSocket.
- Must be bundled as CommonJS (VS Code runtime requirement), separate from the ESM-based monorepo packages.
- VS Code extension API has its own release cadence and deprecation cycles.
- JetBrains, Neovim, Emacs users are not served by V1.

---

## Decision

**The VS Code extension is the primary distribution surface for V1.**

- npm (`npm install -g gmap-cli`) remains the power-user path for CI and terminal workflows.
- The CLI and extension share the same SQLite index and API server at `localhost:7842`.
- V1 extension features: hover card (callers/callees), CodeLens (impact count), sidebar panel (graph view), command palette (`gmap: Scan workspace`).
- The extension is bundled with `esbuild` as a single `extension.js` (CommonJS). All imports from `@gmap/core` are API calls, never direct module imports.

---

## Consequences

- **Separate bundle**: `packages/vscode/` has its own `esbuild` pipeline independent of the monorepo's `tsup` builds.
- **No shared module imports**: extension → API server is the only communication path. This is enforced by the CJS/ESM boundary.
- **API server lifecycle**: the extension starts the gmap server if it's not already running and monitors its health. Crash recovery is the extension's responsibility.
- **Extension marketplace**: `packages/vscode/package.json` includes the full VS Code extension manifest (`contributes`, `activationEvents`, `engines.vscode`). Publish target is the VS Code Marketplace.
- **Future**: JetBrains support via the LSP path is post-V1. The API server is already the LSP-compatible interface layer.

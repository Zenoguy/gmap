# gmap — Execution Plan

> **gmap** — codebase graph mapper  
> *"Understand codebases at the speed AI generates them."*  
> Last updated: June 2026  
> Stack: TypeScript (core engine + API) · Vitest (testing) · WebSocket + REST (API) · React + Cytoscape.js (dashboard) · VS Code Extension API

---

## Known Design Decisions

These decisions are locked in before a single line of code is written. Revisiting them mid-build is expensive.

### 1. TypeScript-first, language-agnostic architecture
The parser layer is language-specific but outputs a canonical record format. All layers above Layer 1 are language-agnostic. Python, Go, Rust adapters plug in without touching the graph engine or API.

### 2. Local-first, server-optional
gmap runs entirely on the developer's machine. No cloud, no telemetry, no auth by default. The API server binds to `localhost` only. This is a hard constraint — never bind to `0.0.0.0` without an explicit `--host` flag.

### 3. WebSocket for streaming, REST for queries
Scan progress, symbol discovery, and graph updates stream over WebSocket. Point-in-time queries (callers, callees, impact) are REST endpoints. This separation is intentional and must not be collapsed.

### 4. SQLite as the single source of truth
The symbol graph lives in SQLite (`~/.gmap/db.sqlite` by default). The in-memory graph at runtime is a read-through cache built from SQLite on startup. No other persistence layer is introduced in V1.

### 5. AI is strictly optional
No AI call is made unless the user explicitly runs `gmap explain`. No telemetry, no background inference. AI receives graph data and source snippets — never full file contents — to minimise token usage and avoid accidental secret exposure.

### 6. Web dashboard over TUI
The dashboard is browser-based (localhost), not a terminal UI. This enables rich graph visualisation (Cytoscape.js), shareable screenshots, and avoids the two-runtime problem that a Python TUI would create.

### 7. VS Code extension as primary distribution surface
The VS Code extension is the highest-leverage distribution channel — it puts gmap inside the tool developers already have open. npm (`npm install -g gmap-cli`) remains the power-user path. The extension and CLI share the same SQLite index and API server.

### 8. ts-morph over raw Compiler API
ts-morph wraps the TypeScript Compiler API with a significantly cleaner interface. Drop down to raw API only for edge cases not covered by ts-morph.

### 9. Call graph accuracy over completeness
When static analysis cannot resolve a call (dynamic require, dependency injection, higher-order functions), gmap marks the edge as `unresolved` and surfaces it to the user rather than silently dropping it or making a wrong guess.

### 10. Port 7842 is the default API port
Chosen to avoid conflicts with common dev ports (3000, 4000, 5000, 8080). Configurable via `--port` flag or `gmap.config.json`.

### 11. CLI commands read like plain English
`gmap why updateStatus` — who calls this?  
`gmap impact updateStatus` — what breaks if I change this?  
`gmap trace updateStatus` — full call chain  
`gmap scan .` — index this project  
Command naming is never abbreviated or cryptic.

---

## Milestone Overview

| # | Name | Deliverable | Estimated effort (solo, ~12hr/wk) |
|---|------|-------------|-----------------------------------|
| 1 | Repository scanner | Import/export graph, definition resolution | 3–4 weeks |
| 2 | Call graph engine | Caller/callee trees, recursive tracing | 4–6 weeks |
| 3 | Impact analysis | Blast radius reports, dependency traversal | 2–3 weeks |
| 4 | API server | WebSocket + REST, local server, npm package | 2–3 weeks |
| 5 | VS Code extension | Hover cards, inline callers, impact badge | 3–4 weeks |
| 6 | Web dashboard | Graph UI, impact panel, symbol explorer | 4–6 weeks |
| 7 | Runtime tracing | Instrumentation, execution recording, hot paths | 4–5 weeks |
| 8 | AI explanations | Natural language summaries via pluggable LLM | 1–2 weeks |

**Total V1 estimate: 6–7 months**  
**Shareable MVP (M1 + M2 + M3 + M4 + M5): ~12–14 weeks**  
**The MVP is the VS Code extension — that's the launch vehicle.**

---

## Milestone 1 — Repository Scanner

### Objective
Parse a TypeScript/JavaScript project and produce a complete import graph, export graph, and definition resolution index stored in SQLite.

### Scope
- Walk project file tree, respect `.gitignore` and `tsconfig.json` paths
- Parse each `.ts` / `.tsx` / `.js` / `.jsx` file using ts-morph
- Extract: functions, classes, interfaces, type aliases, imports, exports
- Resolve path aliases from `tsconfig.json` (`@/utils` → `src/utils`)
- Store all symbols and import relationships in SQLite
- CLI command: `gmap scan <path>`

### Out of scope for M1
- Call graph construction (M2)
- Route or database model detection (M2)
- Monorepo workspace linking (post-V1)

### Files to create

```
packages/
  core/
    src/
      scanner/
        index.ts            # entry point, orchestrates scan
        walker.ts           # file tree walker, gitignore aware
        parser.ts           # ts-morph setup, per-file parsing
        extractors/
          functions.ts      # FunctionDeclaration, ArrowFunction, MethodDeclaration
          classes.ts        # ClassDeclaration, InterfaceDeclaration
          imports.ts        # ImportDeclaration resolution
          exports.ts        # ExportDeclaration, re-exports
        alias-resolver.ts   # tsconfig path alias resolution
      db/
        index.ts            # SQLite connection (better-sqlite3)
        schema.ts           # CREATE TABLE statements
        migrations/
          001_initial.sql
      types/
        symbol.ts           # Symbol, Import, Export, File interfaces
    tests/
      scanner/
        walker.test.ts
        parser.test.ts
        extractors/
          functions.test.ts
          classes.test.ts
          imports.test.ts
          exports.test.ts
        alias-resolver.test.ts
      fixtures/
        simple-project/     # minimal TS project for tests
        aliased-project/    # project with tsconfig path aliases
        barrel-project/     # index.ts barrel file patterns
  cli/
    src/
      commands/
        scan.ts             # gmap scan <path> command handler
      index.ts              # CLI entry point (commander)
    package.json
```

### Database schema (M1 tables)

The schema in M1 is managed by the migrations runner using `001_initial.sql`. The structure matches:

```sql
CREATE TABLE files (
  id             INTEGER PRIMARY KEY,
  path           TEXT    NOT NULL UNIQUE,   -- absolute path
  relative_path  TEXT    NOT NULL,          -- relative to scan root
  language       TEXT    NOT NULL,          -- 'typescript' | 'python' | etc.
  content_hash   TEXT    NOT NULL DEFAULT '', -- SHA-256 hex hash
  last_scanned   INTEGER NOT NULL DEFAULT 0,  -- unix ms of last scan
  has_errors     INTEGER NOT NULL DEFAULT 0   -- 1 if last parse had errors
);

CREATE TABLE symbols (
  id               INTEGER PRIMARY KEY,
  name             TEXT    NOT NULL,    -- unqualified: "approveEstimate"
  qualified_name   TEXT    NOT NULL,    -- with class/ns: "ApprovalService.approveEstimate"
  kind             TEXT    NOT NULL
    CHECK(kind IN (
      'function','method','class','interface',
      'type','variable','enum','namespace','route','model'
    )),
  file_id          INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  line_start       INTEGER NOT NULL,
  line_end         INTEGER NOT NULL,
  col_start        INTEGER NOT NULL DEFAULT 0,
  col_end          INTEGER NOT NULL DEFAULT 0,
  is_exported      INTEGER NOT NULL DEFAULT 0,
  is_default_export INTEGER NOT NULL DEFAULT 0,
  parent_name      TEXT,               -- class/ns name for methods
  parameters       TEXT    NOT NULL DEFAULT '[]', -- JSON array of param names
  meta             TEXT    NOT NULL DEFAULT '{}'  -- JSON, adapter-specific
);

CREATE TABLE imports (
  id              INTEGER PRIMARY KEY,
  from_file_id    INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  to_file_id      INTEGER REFERENCES files(id) ON DELETE SET NULL, -- null = external
  specifier       TEXT    NOT NULL,   -- raw: "@/utils", "./services/foo", "express"
  resolved_path   TEXT,               -- absolute path, null if external/unresolved
  is_external     INTEGER NOT NULL DEFAULT 0,
  kind            TEXT    NOT NULL
    CHECK(kind IN ('named','default','namespace','side-effect','dynamic','require')),
  imported_names  TEXT    NOT NULL DEFAULT '[]', -- JSON array
  local_alias     TEXT                           -- if renamed
);

CREATE TABLE exports (
  id                  INTEGER PRIMARY KEY,
  file_id             INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  symbol_id           INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
  exported_name       TEXT    NOT NULL,
  local_name          TEXT,               -- internal name if different
  is_default          INTEGER NOT NULL DEFAULT 0,
  is_re_export        INTEGER NOT NULL DEFAULT 0,
  re_export_specifier TEXT                -- source specifier for re-exports
);

CREATE INDEX idx_files_path          ON files(path);
CREATE INDEX idx_files_content_hash  ON files(content_hash);
CREATE INDEX idx_symbols_name        ON symbols(name);
CREATE INDEX idx_symbols_qualified   ON symbols(qualified_name);
CREATE INDEX idx_symbols_file        ON symbols(file_id);
CREATE INDEX idx_imports_from_file   ON imports(from_file_id);
CREATE INDEX idx_imports_to_file     ON imports(to_file_id);
CREATE INDEX idx_exports_file        ON exports(file_id);
```

### Acceptance criteria

- `gmap scan .` completes on a 500-file TS project in under 30 seconds
- All function declarations (named, arrow, method) are indexed
- Import edges are created for all local imports (not `node_modules`)
- Path aliases resolve correctly to real file paths
- Barrel file re-exports are traced to their origin symbol
- SQLite database is created at `~/.gmap/db.sqlite` (configurable)
- Re-scanning updates existing records, does not duplicate
- Scan output prints: files scanned, symbols found, import edges created, time elapsed

### Test cases (Vitest)

```typescript
// walker.test.ts
describe('file walker', () => {
  it('walks all .ts and .tsx files in a directory')
  it('respects .gitignore patterns')
  it('excludes node_modules by default')
  it('excludes dist/ and build/ directories')
  it('handles symlinks without infinite loops')
})

// parser.test.ts
describe('parser', () => {
  it('parses a simple TypeScript file without errors')
  it('handles files with syntax errors gracefully — logs warning, continues')
  it('processes .js files with JSDoc types')
  it('handles empty files without throwing')
})

// extractors/functions.test.ts
describe('function extractor', () => {
  it('extracts named function declarations')
  it('extracts arrow functions assigned to const')
  it('extracts class method declarations')
  it('extracts async functions')
  it('extracts generic functions')
  it('records correct line numbers')
  it('marks exported functions correctly')
  it('handles default exports')
})

// extractors/imports.test.ts
describe('import extractor', () => {
  it('extracts named imports: import { a, b } from "./module"')
  it('extracts default imports: import foo from "./foo"')
  it('extracts namespace imports: import * as ns from "./ns"')
  it('extracts type-only imports: import type { Foo } from "./foo"')
  it('marks node_modules imports as external')
  it('resolves relative paths to absolute paths')
  it('handles index file resolution: "./utils" → "./utils/index.ts"')
})

// alias-resolver.test.ts
describe('alias resolver', () => {
  it('reads paths from tsconfig.json')
  it('resolves @/components/Button to src/components/Button.ts')
  it('handles multiple tsconfig paths entries')
  it('falls back to relative resolution when no alias matches')
  it('handles tsconfig extends chains')
})
```

### Exit criteria
- All test cases pass
- Zero unhandled exceptions on the fixture projects
- `gmap scan .` works correctly on gmap's own source tree (dogfood test)
- SQLite schema matches spec exactly (verified by schema introspection test)

---

## Milestone 2 — Call Graph Engine

### Objective
Build a call graph on top of the symbol index from M1. For every function, track what it calls and what calls it. Support recursive tracing to arbitrary depth.

### Scope
- Analyse function bodies for call expressions
- Resolve callee identifiers to their symbol definitions
- Handle: direct calls, method calls, chained calls
- Mark unresolvable calls as `unresolved` (dynamic patterns, callbacks passed as args)
- Build caller and callee trees via graph traversal
- CLI commands: `gmap trace <fn>`, `gmap why <fn>`, `gmap calls <fn>`
- Detect common framework patterns: Express route handlers, event emitters

### Out of scope for M2
- Runtime call resolution (M7)
- Cross-package call resolution (post-V1)

### Files to create / modify

```
packages/
  core/
    src/
      graph/
        index.ts            # graph construction orchestrator
        call-extractor.ts   # extract call expressions from function bodies
        resolver.ts         # resolve callee to symbol definition
        traversal.ts        # BFS/DFS caller/callee tree traversal
        patterns/
          express.ts        # Express route handler detection
          events.ts         # EventEmitter pattern detection
      db/
        migrations/
          002_calls.sql
      types/
        graph.ts            # CallEdge, CallTree, ResolvedCall interfaces
    tests/
      graph/
        call-extractor.test.ts
        resolver.test.ts
        traversal.test.ts
        patterns/
          express.test.ts
      fixtures/
        call-chain/         # A → B → C → D chain
        circular/           # A → B → A circular call
        express-app/        # Express routes calling services
```

### Database schema (M2 additions)

```sql
CREATE TABLE calls (
  id INTEGER PRIMARY KEY,
  caller_symbol_id INTEGER NOT NULL REFERENCES symbols(id),
  callee_symbol_id INTEGER REFERENCES symbols(id),  -- null if unresolved
  callee_raw_name TEXT NOT NULL,                     -- raw call expression text
  resolution_status TEXT NOT NULL
    CHECK(resolution_status IN ('resolved','unresolved','external')),
  file_id INTEGER NOT NULL REFERENCES files(id),
  line_number INTEGER NOT NULL
);

CREATE INDEX idx_calls_caller ON calls(caller_symbol_id);
CREATE INDEX idx_calls_callee ON calls(callee_symbol_id);
CREATE INDEX idx_calls_status ON calls(resolution_status);
```

### Acceptance criteria

- `gmap why approveEstimate` returns all functions that call `approveEstimate`
- `gmap calls approveEstimate` returns all functions called by `approveEstimate`
- `gmap trace approveEstimate` returns full recursive call tree (default depth 5, configurable)
- Circular calls are detected and displayed without infinite loops
- Unresolved calls are reported with their raw call expression
- Resolution rate ≥ 80% on well-typed TypeScript projects
- Call graph construction adds ≤ 15 seconds to a 500-file project scan

### Test cases (Vitest)

```typescript
// call-extractor.test.ts
describe('call extractor', () => {
  it('extracts direct function calls: foo()')
  it('extracts method calls: obj.foo()')
  it('extracts chained calls: a().b().c()')
  it('extracts calls inside conditionals')
  it('extracts calls inside loops')
  it('extracts calls inside callbacks: arr.map(x => transform(x))')
  it('extracts calls inside try/catch blocks')
  it('records correct line numbers for each call')
})

// resolver.test.ts
describe('call resolver', () => {
  it('resolves call to function defined in same file')
  it('resolves call to imported named export')
  it('resolves call to default import')
  it('marks calls to node_modules as external')
  it('marks dynamic require() calls as unresolved')
  it('marks calls via variable reference as unresolved when target unknown')
  it('resolves class method calls when instance type is known')
})

// traversal.test.ts
describe('graph traversal', () => {
  it('returns all direct callers of a function')
  it('returns all direct callees of a function')
  it('traverses callee tree recursively to specified depth')
  it('detects and marks circular references without infinite loop')
  it('returns empty array for functions with no callers')
  it('returns empty array for functions with no callees')
  it('respects max depth parameter')
})
```

### Exit criteria
- All test cases pass
- Circular call detection verified on fixture
- `gmap trace` works on gmap's own scanner module (dogfood)
- Zero infinite loops in traversal on any fixture project

---

## Milestone 3 — Impact Analysis

### Objective
Given a symbol (function, file, or module), compute everything that would be affected if it changed — the blast radius.

### Scope
- Traverse the call graph upward (reverse direction) from the target symbol
- Identify affected: functions, files, routes, and test files
- Produce a structured impact report
- CLI command: `gmap impact <fn>`
- Detect test files by convention (`*.test.ts`, `*.spec.ts`, `__tests__/**`)
- Weight impact by edge distance (direct vs transitive)

### Files to create / modify

```
packages/
  core/
    src/
      analysis/
        impact.ts           # impact traversal engine
        report.ts           # ImpactReport formatter
        test-detector.ts    # test file heuristics
      types/
        impact.ts           # ImpactReport, AffectedNode interfaces
    tests/
      analysis/
        impact.test.ts
        test-detector.test.ts
      fixtures/
        impact-chain/       # deep dependency chain for blast radius test
```

### Impact report structure

```typescript
interface ImpactReport {
  target: Symbol;
  summary: {
    affectedFunctions: number;
    affectedFiles: number;
    affectedRoutes: number;
    affectedTests: number;
    maxDepth: number;
  };
  affected: {
    functions: AffectedNode[];
    files: AffectedFile[];
    routes: AffectedRoute[];
    tests: AffectedTest[];
  };
}

interface AffectedNode {
  symbol: Symbol;
  distance: number;         // hops from target
  path: Symbol[];           // call chain from target to this node
}
```

### Acceptance criteria

- `gmap impact updateStatus` returns all functions, files, routes, and tests affected
- Impact traversal completes in under 2 seconds on a 500-file project
- Distance is correctly calculated (direct caller = 1, caller's caller = 2, etc.)
- Test files are correctly identified by convention
- Report is output as formatted table in CLI and as JSON with `--json` flag
- Functions with no dependents return an empty impact report (not an error)

### Test cases (Vitest)

```typescript
// impact.test.ts
describe('impact analysis', () => {
  it('returns direct callers at distance 1')
  it('returns transitive callers at correct depth')
  it('identifies all affected files from call chain')
  it('stops traversal at max depth (default 10)')
  it('handles symbols with zero dependents gracefully')
  it('deduplicates symbols appearing via multiple paths')
  it('includes correct call path for each affected node')
  it('correctly identifies affected routes from route fixtures')
})

// test-detector.test.ts
describe('test file detector', () => {
  it('identifies *.test.ts as a test file')
  it('identifies *.spec.ts as a test file')
  it('identifies files inside __tests__/ as test files')
  it('does not mark *.ts files outside test conventions as tests')
  it('identifies vitest describe blocks as test indicators')
})
```

### Exit criteria
- All test cases pass
- Impact report for a known fixture matches expected output exactly (snapshot test)
- `gmap impact` runs on gmap's own db module and returns sensible results

---

## Milestone 4 — API Server + npm Package

### Objective
Wrap the core engine in a local API server. Expose WebSocket for streaming scan events and REST for point-in-time queries. Package everything for `npm install -g gmap-cli`.

### Scope
- Local HTTP + WebSocket server on `localhost:7842`
- WebSocket: scan progress events, graph update events
- REST: symbol lookup, callers, callees, impact, full graph snapshot
- `gmap serve` command starts the server
- `gmap scan` auto-starts server and streams events
- npm package configuration (`bin`, `main`, `exports`)
- Auto-open browser on `gmap scan` (configurable, `--no-open` flag)

### Files to create / modify

```
packages/
  server/
    src/
      index.ts              # server entry point
      ws/
        index.ts            # WebSocket server setup (ws package)
        events.ts           # event type definitions
        broadcaster.ts      # fan-out to all connected clients
      rest/
        index.ts            # Express router
        routes/
          symbols.ts        # GET /api/symbols, GET /api/symbols/:name
          callers.ts        # GET /api/callers/:name
          callees.ts        # GET /api/callees/:name
          impact.ts         # GET /api/impact/:name
          graph.ts          # GET /api/graph (full snapshot)
          scan.ts           # POST /api/scan
      middleware/
        cors.ts             # localhost-only CORS
        error.ts            # error handler
    tests/
      ws/
        broadcaster.test.ts
      rest/
        symbols.test.ts
        impact.test.ts
        graph.test.ts
  cli/
    src/
      commands/
        serve.ts            # gmap serve command
        open.ts             # auto-open browser helper
    package.json            # bin config, npm publish config
```

### WebSocket event schema

```typescript
type GmapEvent =
  | { type: 'scan:start';    payload: { path: string; timestamp: number } }
  | { type: 'scan:file';     payload: { path: string; index: number; total: number } }
  | { type: 'scan:symbol';   payload: { name: string; type: string; file: string } }
  | { type: 'scan:edge';     payload: { caller: string; callee: string } }
  | { type: 'scan:complete'; payload: { files: number; symbols: number; edges: number; duration: number } }
  | { type: 'scan:error';    payload: { message: string; file?: string } }
```

### REST API surface

```
GET  /api/health
GET  /api/graph
GET  /api/symbols
GET  /api/symbols/:name
GET  /api/callers/:name?depth=5
GET  /api/callees/:name?depth=5
GET  /api/impact/:name
POST /api/scan           { path: string }
```

### Acceptance criteria

- `npm install -g gmap-cli` installs successfully on Node 18+
- `gmap scan .` starts the server, scans, streams events, opens browser
- WebSocket client receives all scan events in correct order
- `scan:complete` event fires exactly once per scan
- All REST endpoints return JSON with correct Content-Type header
- REST endpoints return 404 with `{ error: string }` for unknown symbols
- Server binds only to `127.0.0.1` — never `0.0.0.0` by default
- `--port` flag overrides default port
- `--no-open` suppresses browser auto-open
- Concurrent WebSocket clients all receive events (fan-out)

### Test cases (Vitest)

```typescript
// broadcaster.test.ts
describe('WebSocket broadcaster', () => {
  it('sends event to all connected clients')
  it('handles zero connected clients without error')
  it('handles client disconnect mid-scan gracefully')
  it('queues events if client connects mid-scan')
})

// rest/symbols.test.ts
describe('symbols API', () => {
  it('GET /api/symbols returns array of all symbols')
  it('GET /api/symbols/:name returns correct symbol')
  it('GET /api/symbols/:name returns 404 for unknown symbol')
  it('GET /api/symbols supports ?type=function filter')
  it('GET /api/symbols supports ?file= filter')
})

// rest/impact.test.ts
describe('impact API', () => {
  it('GET /api/impact/:name returns valid ImpactReport')
  it('GET /api/impact/:name returns 404 for unknown symbol')
  it('GET /api/impact/:name respects ?depth= param')
  it('returns empty impact report for symbols with no dependents')
})
```

### Exit criteria
- All test cases pass
- `npm pack` produces valid tarball, installs cleanly in fresh Node environment
- WebSocket stress test: 5 concurrent clients all receive 100% of events
- Server shuts down cleanly on SIGINT / SIGTERM

---

## Milestone 5 — VS Code Extension

### Objective
Ship gmap as a VS Code extension. This is the primary distribution surface and the launch vehicle for public release. Developers see caller counts, impact badges, and call chains without leaving their editor.

### Scope
- Extension activates automatically when a `gmap.config.json` or `.gmap/` folder is detected in the workspace
- On activation: starts the gmap API server in the background (or connects to existing)
- Triggers a background scan if no SQLite index exists for the workspace
- **Hover provider**: hover any function name → inline card showing callers, callees, impact count
- **CodeLens**: above each function declaration, show `N callers · impact: M` — clickable
- **Inline decorations**: subtle gutter icon on functions with high impact (≥ 10 affected)
- **Sidebar panel**: tree view of all symbols, searchable, click to navigate
- **Command palette**: `gmap: Scan workspace`, `gmap: Show impact`, `gmap: Trace function`, `gmap: Why is this called`
- **Status bar item**: shows index status (`gmap ✓ 1,842 symbols`) with click to open dashboard

### Out of scope for M5
- Full graph visualisation (M6 dashboard)
- Runtime trace overlay (M7)

### Files to create

```
packages/
  vscode/
    src/
      extension.ts              # activate / deactivate entry point
      server-manager.ts         # starts/stops gmap API server as child process
      client/
        api.ts                  # REST client wrapping fetch to localhost:7842
        ws.ts                   # WebSocket client for scan progress
      providers/
        hover.ts                # HoverProvider — caller/callee card on hover
        codelens.ts             # CodeLensProvider — N callers · impact: M
        decoration.ts           # gutter icons for high-impact functions
      views/
        sidebar/
          provider.ts           # TreeDataProvider for symbol sidebar
          items.ts              # SymbolItem, FileItem tree nodes
        scan-progress/
          panel.ts              # WebviewPanel showing live scan progress
      commands/
        scan.ts                 # gmap.scan
        showImpact.ts           # gmap.showImpact
        traceFunction.ts        # gmap.traceFunction
        whyCalled.ts            # gmap.whyCalled
      statusbar/
        item.ts                 # status bar index status
      utils/
        symbol-at-cursor.ts     # resolve symbol name under cursor position
        debounce.ts             # debounce hover/codelens triggers
    tests/
      providers/
        hover.test.ts
        codelens.test.ts
      views/
        sidebar.test.ts
      utils/
        symbol-at-cursor.test.ts
    package.json                # VS Code extension manifest
    .vscodeignore
```

### VS Code extension manifest (package.json highlights)

```json
{
  "name": "gmap",
  "displayName": "gmap — codebase graph mapper",
  "description": "Understand what your code touches. Callers, callees, and blast radius inline.",
  "publisher": "gmap",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other", "Programming Languages"],
  "activationEvents": [
    "workspaceContains:gmap.config.json",
    "workspaceContains:.gmap/db.sqlite",
    "onCommand:gmap.scan"
  ],
  "contributes": {
    "commands": [
      { "command": "gmap.scan",          "title": "gmap: Scan workspace" },
      { "command": "gmap.showImpact",    "title": "gmap: Show impact" },
      { "command": "gmap.traceFunction", "title": "gmap: Trace function" },
      { "command": "gmap.whyCalled",     "title": "gmap: Why is this called" }
    ],
    "views": {
      "explorer": [
        { "id": "gmap.symbols", "name": "gmap symbols" }
      ]
    }
  }
}
```

### Hover card format

When hovering over `approveEstimate`:

```
gmap · approveEstimate()
─────────────────────────────────────
📍 services/approvalService.ts:42

↑ called by (3)
  submitReview()      routes/review.ts:18
  finalApproval()     routes/approval.ts:91
  adminOverride()     admin/tools.ts:7

↓ calls (4)
  updateStatus()  sendTelegram()
  writeAuditLog() notifySlack()

⚠ impact: 12 functions · 4 files · 2 routes
─────────────────────────────────────
[Trace]  [Impact]  [Open dashboard]
```

### Acceptance criteria

- Extension activates within 500ms of VS Code opening a scanned workspace
- Hover card appears within 150ms of hovering a known function name
- CodeLens renders above every function declaration in indexed files
- Background scan completes without blocking editor UI
- Status bar item updates in real time during scan
- `gmap: Scan workspace` command works from command palette with no prior setup
- Extension does not crash when API server is not running — shows "gmap: not running" in status bar with a start option
- Extension works on VS Code 1.85+ on macOS, Linux, Windows
- No extension host crashes on workspaces with 0 indexed symbols

### Test cases (Vitest)

```typescript
// providers/hover.test.ts
describe('hover provider', () => {
  it('returns hover card for a known function name at cursor')
  it('returns null for unknown symbol — no hover shown')
  it('returns null for non-function tokens (strings, keywords)')
  it('includes correct caller count in hover card')
  it('includes correct impact count in hover card')
  it('hover card renders within 150ms (performance)')
  it('handles API server being offline gracefully')
})

// providers/codelens.test.ts
describe('codelens provider', () => {
  it('renders CodeLens above function declarations')
  it('shows correct caller count')
  it('shows correct impact count')
  it('clicking CodeLens opens impact panel')
  it('does not render CodeLens for unindexed files')
  it('updates CodeLens after re-scan')
})

// utils/symbol-at-cursor.test.ts
describe('symbol at cursor', () => {
  it('resolves function name at cursor position')
  it('returns null when cursor is on a keyword')
  it('returns null when cursor is inside a string literal')
  it('handles cursor at start of function name')
  it('handles cursor at end of function name')
})
```

### Exit criteria
- All test cases pass
- Extension published to VS Code Marketplace (even as pre-release)
- Hover card renders correctly on gmap's own source files (dogfood)
- Zero extension host crashes across 30 minutes of normal editing on a 200-file project
- This milestone is the public launch point — post to HN, r/typescript, VS Code marketplace new releases

---

## Milestone 6 — Web Dashboard

### Objective
Build the browser-based dashboard that connects to the local API server. edex-UI inspired aesthetic. Interactive call graph, impact panel, symbol search.

### Scope
- React + Vite app served from the core package on `localhost:7842`
- Cytoscape.js for interactive call graph (force-directed layout)
- Real-time scan progress visualisation via WebSocket
- Symbol search with instant results
- Click a node to see callers, callees, impact in side panel
- Dark theme, monospace typography, cyan/teal accent palette
- "Open dashboard" button in VS Code extension links here

### Files to create

```
packages/
  dashboard/
    index.html
    vite.config.ts
    src/
      main.tsx
      App.tsx
      ws/
        client.ts           # WebSocket client, auto-reconnect
        events.ts           # event type mirror from server
      api/
        client.ts           # REST fetch helpers
      store/
        graph.ts            # Zustand store: nodes, edges, scan state
        ui.ts               # selected node, panel state
      components/
        layout/
          Shell.tsx         # outer layout: top bar + left + center + right
          TopBar.tsx        # project name, scan status, stats bar
        graph/
          GraphCanvas.tsx   # Cytoscape.js wrapper
          GraphNode.tsx     # custom node renderer
          GraphControls.tsx # zoom, layout toggle, filter
        panels/
          SymbolPanel.tsx   # left: search + symbol list
          DetailPanel.tsx   # right: callers / callees / impact tabs
          ScanProgress.tsx  # overlay during active scan
        shared/
          Badge.tsx
          StatCard.tsx
          CodePath.tsx      # file:line display
      styles/
        theme.css           # CSS custom properties, edex palette
        global.css
    tests/
      components/
        GraphCanvas.test.tsx
        DetailPanel.test.tsx
      api/
        client.test.ts
```

### Design tokens

```css
:root {
  --bg-primary:    #0a0e14;
  --bg-secondary:  #0d1117;
  --bg-panel:      #111820;
  --bg-elevated:   #1a2332;
  --accent-cyan:   #00d4ff;
  --accent-teal:   #00ff9f;
  --accent-amber:  #ff9f00;
  --accent-red:    #ff4040;
  --text-primary:  #c5d1de;
  --text-muted:    #4a6278;
  --text-dim:      #2a3d52;
  --border:        #1e2d3d;
  --font-mono:     'JetBrains Mono', 'Fira Code', monospace;
}
```

### Acceptance criteria

- Dashboard loads in browser within 1 second of `gmap scan` completing
- Call graph renders with all nodes and edges from scan
- Graph nodes are clickable — clicking shows callers/callees/impact in side panel
- Scan progress overlay shows real-time file count and symbol count
- Symbol search returns results within 100ms (client-side filter)
- Graph layout is stable (no oscillating nodes after settling)
- Dashboard is functional at 1280×720 minimum viewport
- No network requests to external domains (fully local)

### Test cases (Vitest + Testing Library)

```typescript
// GraphCanvas.test.tsx
describe('GraphCanvas', () => {
  it('renders without crashing with empty graph')
  it('renders correct number of nodes from store')
  it('calls onNodeClick when a node is clicked')
  it('handles graph updates without full re-render')
})

// DetailPanel.test.tsx
describe('DetailPanel', () => {
  it('shows callers tab by default when node selected')
  it('switches to callees tab on click')
  it('switches to impact tab on click')
  it('displays "no callers" message when caller list is empty')
  it('displays file path and line number for each caller')
})
```

### Exit criteria
- All test cases pass
- Lighthouse performance score ≥ 80 on dashboard page
- Dashboard renders correctly on Chrome, Firefox, and Safari
- No console errors in production build

---

## Milestone 7 — Runtime Tracing

### Objective
Instrument a running Node.js process to capture actual execution paths, function call counts, and hot paths. Overlay runtime data onto the static call graph in the dashboard and VS Code extension.

### Scope
- Node.js instrumentation via `--require` hook
- Capture: function entry/exit, call counts, execution time, call stack
- Write runtime events to SQLite (`runtime_events`, `executions` tables)
- `gmap record` launches the target process with instrumentation attached
- Dashboard overlays execution counts on graph nodes (hotter = brighter)
- VS Code CodeLens shows execution count alongside caller count: `3 callers · 127 executions · impact: 12`
- Dead code detection: symbols never executed after N sessions

### Files to create / modify

```
packages/
  tracer/
    src/
      instrument.ts         # --require hook, patches module loader
      collector.ts          # batches events, writes to SQLite
      ipc.ts                # sends events to gmap server via local socket
    tests/
      instrument.test.ts
      collector.test.ts
  core/
    src/
      db/
        migrations/
          003_runtime.sql
      analysis/
        hotpaths.ts         # identify hot execution paths
        deadcode.ts         # symbols with zero executions
```

### Database schema (M7 additions)

```sql
CREATE TABLE executions (
  id INTEGER PRIMARY KEY,
  symbol_id INTEGER NOT NULL REFERENCES symbols(id),
  session_id TEXT NOT NULL,
  call_count INTEGER NOT NULL DEFAULT 0,
  total_duration_ms REAL NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE TABLE runtime_events (
  id INTEGER PRIMARY KEY,
  symbol_id INTEGER NOT NULL REFERENCES symbols(id),
  session_id TEXT NOT NULL,
  caller_symbol_id INTEGER REFERENCES symbols(id),
  timestamp INTEGER NOT NULL,
  duration_ms REAL
);

CREATE INDEX idx_executions_symbol ON executions(symbol_id);
CREATE INDEX idx_executions_session ON executions(session_id);
```

### Acceptance criteria

- `gmap record node dist/server.js` starts the process with instrumentation
- After process exits, execution counts are stored in SQLite
- Dashboard graph nodes show call count badges
- VS Code CodeLens updates to include execution counts after a record session
- Hot paths (top 10% by call count) are highlighted in amber
- Dead code report lists symbols with zero executions across all sessions
- Instrumentation overhead ≤ 10ms per function call on average
- Works with ts-node and compiled JS output

### Exit criteria
- Instrumentation works on an Express server fixture (start, handle 10 requests, exit)
- Execution counts match manual count from fixture
- Dashboard overlay renders without performance regression
- VS Code CodeLens reflects runtime data correctly

---

## Milestone 8 — AI Explanations

### Objective
Add an optional AI layer that uses the graph data and source snippets to produce natural language explanations. Pluggable LLM backend.

### Scope
- `gmap explain <fn>` — explain what a function does and why it exists
- `gmap explain --workflow <fn>` — reconstruct the business workflow this function is part of
- VS Code command: `gmap: Explain this function` in command palette and right-click menu
- Supported backends: Claude (Anthropic), OpenAI, Ollama (local)
- AI receives: symbol definition, direct callers, direct callees, source snippet
- AI never receives: full file contents, secrets, environment variables
- Config: `gmap.config.json` → `ai.provider`, `ai.model`, `ai.apiKey`

### Files to create / modify

```
packages/
  core/
    src/
      ai/
        index.ts            # provider factory
        context-builder.ts  # assembles graph context for prompt
        providers/
          anthropic.ts
          openai.ts
          ollama.ts
        prompts/
          explain.ts
          workflow.ts
    tests/
      ai/
        context-builder.test.ts
        providers/
          anthropic.test.ts  # mocked
  vscode/
    src/
      commands/
        explain.ts          # gmap.explain command
```

### Acceptance criteria

- `gmap explain approveEstimate` returns a coherent plain-English explanation
- Explanation includes: purpose, callers context, callees context
- VS Code right-click → `gmap: Explain this function` works on any indexed symbol
- Works with Ollama locally (no API key required)
- Fails gracefully when no AI provider is configured — suggests config steps
- Context sent to AI never exceeds 4000 tokens
- API key is never logged or written to disk beyond `gmap.config.json`

### Exit criteria
- Explanation quality verified manually on 3 real functions from a test project
- Context builder unit tests pass
- Provider auth failure returns user-friendly error, not stack trace
- VS Code command works end-to-end with Ollama (no external API key needed)

---

## Security Measures

### Network
- API server binds exclusively to `127.0.0.1`. The `--host` flag is required to expose externally — documented with a clear warning.
- CORS policy allows only `localhost` and `127.0.0.1` origins.
- No inbound connections accepted except from loopback interface.
- WebSocket server validates `Origin` header on handshake.
- VS Code extension connects only to `127.0.0.1:7842` — never to external hosts.

### Filesystem
- Scanner only reads files within the specified scan root. Path traversal attempts (e.g. `../../etc/passwd` as a symbol name in API) are rejected.
- All file path inputs are normalised and validated against the scan root before any read operation.
- SQLite database stored in `~/.gmap/` with `0600` permissions (owner read/write only).

### AI layer
- Source snippets sent to external AI providers are limited to the function body only — never the full file.
- API keys are read from `gmap.config.json` or environment variables. Never committed to the scanned project or logged.
- Context builder strips comments containing common secret patterns (API keys, tokens, passwords) before sending to AI.
- Ollama provider makes no external network requests — fully local.

### Supply chain
- `package.json` pins all production dependencies to exact versions (`"ws": "8.17.1"` not `"^8"`).
- `npm audit` is run as part of CI on every PR.
- No `postinstall` scripts in the published npm package or VS Code extension.

### Input validation
- All REST API path parameters are validated against `^[a-zA-Z0-9_$.]+$` before database lookup.
- Query parameters (`depth`, `limit`) are parsed as integers with min/max bounds enforced.
- `POST /api/scan` validates that the provided path exists and is a directory before starting scan.
- VS Code extension sanitises all symbol names before passing to API — no raw editor text reaches the server unvalidated.

---

## Summary

**gmap** (codebase graph mapper) is a local-first, open-source code understanding tool for TypeScript/JavaScript projects. It produces a static call graph and dependency map from source code, serves this data via a local WebSocket + REST API, and surfaces it where developers already work — inside VS Code as inline hover cards and CodeLens, and in a browser dashboard for deeper exploration.

The name follows the tradition of nmap and mmap: short, lowercase, purpose-clear. The CLI reads like plain English: `gmap why updateStatus`, `gmap impact updateStatus`, `gmap trace approveEstimate`.

The build is structured in 8 milestones, each independently useful. The public launch target is **Milestone 5** — the VS Code extension. That's the version that gets posted to HN and the VS Code marketplace. Everything after is additive.

The core engine is intentionally language-agnostic from the start, making Python and other language adapters straightforward additions post-V1. AI is additive, not load-bearing. The tool is fully useful with zero AI configuration.

Distribution: VS Code Marketplace (primary) → npm → AUR/Homebrew (community-driven, post-traction).

---

## Dependency Graph

```
M1 (Scanner)
│
├── M2 (Call Graph)            depends on: M1 symbols + import edges
│   │
│   ├── M3 (Impact)            depends on: M2 call edges
│   │   │
│   │   └── M4 (API Server)    depends on: M1 + M2 + M3 analysis engines
│   │       │
│   │       ├── M5 (VS Code)   depends on: M4 REST + WebSocket API  ← LAUNCH HERE
│   │       │   │
│   │       │   └── M6 (Dashboard) depends on: M4 API + M5 for "open dashboard" link
│   │       │       │
│   │       │       └── M7 (Runtime Tracing) depends on: M4 API + M5 CodeLens + M6 overlay
│   │       │           │
│   │       │           └── M8 (AI) depends on: M1 + M2 + M3 data + M5 VS Code command
│   │       │
│   │       └── M8 (AI)        also depends on: M4 server for explain endpoint
│   │
│   └── M8 (AI)                also depends on: M2 call context

External dependencies:
  ts-morph              → M1 parser layer
  better-sqlite3        → M1, M2, M3, M7 persistence
  ws                    → M4 WebSocket server
  express               → M4 REST server
  commander             → CLI (all milestones)
  vscode extension API  → M5
  react + vite          → M6 dashboard
  cytoscape             → M6 graph visualisation
  zustand               → M6 state management
  vitest                → all test suites
```

### Hard dependency order
No milestone can begin until all milestones it depends on have passed their exit criteria.

```
M1 → M2 → M3 → M4 → M5 → M6 → M7
                               ↑
                    M8 (can start in parallel with M6 once M4 complete)
```

### Critical path to launch
```
M1 → M2 → M3 → M4 → M5 (publish to VS Code Marketplace)
```

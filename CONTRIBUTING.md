# Contributing to gmap

Thank you for your interest in contributing to **gmap**! To maintain a high-quality developer tool, we enforce strict standards around formatting, coding conventions, testing, and architecture.

Please read this document fully before submitting a Pull Request.

---

## 1. Development Environment

### Requirements
- **Node.js**: v20+ (pinned in [.nvmrc](file:///.nvmrc))
- **pnpm**: v9+ (workspaces package manager)
- **Turbo**: Used for build, typecheck, and test pipeline orchestration.

### Initial Setup
```bash
# Install dependencies
pnpm install

# Build all packages in correct order
pnpm build

# Typecheck and run tests to verify setup
pnpm typecheck
pnpm test
```

---

## 2. Coding Conventions & Standards

### Formatting & Linting
- **Prettier** & **ESLint**: Enforced on every commit. Run `pnpm lint` and `pnpm format` to check.
- **Rule of Zero Warnings**: Code with linter warnings or TypeScript compiler errors will not be merged.
- **TypeScript Strict Mode**: Fully enabled. Avoid using `any` or casting types unless absolute necessary (e.g. interacting with third-party untyped libraries).

### Commit Message Guidelines
We follow the **Conventional Commits** specification:
- `feat:` A new user-facing CLI command, API endpoint, or visual feature.
- `fix:` A bug fix in any package.
- `docs:` Documentation-only changes (including ADRs).
- `test:` Adding or fixing test suites.
- `refactor:` Code refactoring with no user-facing behavioral changes.
- `chore:` Maintenance tasks, dependency updates, and build config.

---

## 3. Testing Policy

Every feature pull request **must** be accompanied by tests:
- Core engine and database features must have unit or integration tests in `@gmap/core`.
- CLI commands should have end-to-end command line execution tests in `@gmap/cli`.
- Run tests via `pnpm test`. Run individual package tests via `pnpm --filter <package> test`.

---

## 4. Architectural Rules

### Monorepo Structure
We use a clean dependency flow. **All packages import from `@gmap/core`. Sibling packages must never import from each other.**

- `CLI` ─── ▶ `@gmap/core`
- `Dashboard` ─── ▶ `@gmap/server`
- `VSCode` ─── ▶ `@gmap/server` (via HTTP/WebSocket)
- `Server` ─── ▶ `@gmap/core`
- `Tracer` ─── ▶ `@gmap/core`

### Port & Binding Safety
- The API server **must** bind to local loopback (`127.0.0.1` / `localhost`) only.
- Never bind to `0.0.0.0` unless explicitly requested by the user via the `--host` flag.

### SQLite Pragma Setup
All database connections must declare matching WAL pragmas to prevent data corruption during simultaneous read/write cycles (e.g. CLI scanning while VS Code reads).

---

## 5. Submitting Changes

1. **Check for existing issues**: Search the backlog to see if someone is already working on it.
2. **Open an RFC (if applicable)**: For major architectural changes, write a proposal first (see [RFC Process](file:///home/zenoguy/Desktop/projects/XRay/documentation/rfc-process.md)).
3. **Write tests**: Validate both happy path and failure cases.
4. **Pass all checks**: Ensure `pnpm build`, `pnpm typecheck`, and `pnpm test` pass.
5. **Open a PR**: Fill out the PR template with clear steps to reproduce and verify your change.

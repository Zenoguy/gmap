# ADR 0010 — Port 7842 as default API port

**Status**: Accepted  
**Date**: June 2026  
**Deciders**: Core team

---

## Problem

The gmap API server needs a default port. The port must not conflict with common development ports that a developer is likely to be running when using gmap in their project.

---

## Common ports to avoid

| Port | Common occupant |
|---|---|
| 3000 | React dev, Rails |
| 4000 | Phoenix (Elixir), Gatsby |
| 5000 | Flask, .NET Kestrel |
| 5173 | Vite |
| 8080 | Generic HTTP alt, Spring Boot |
| 8443 | HTTPS alt |
| 9000 | SonarQube, PHP-FPM |
| 4200 | Angular CLI |
| 3001 | Create React App alt |

---

## Decision

**Default port: `7842`.**

The number was chosen for low conflict probability (no common tool uses this range) and memorability. It is not a round number, which helps developers distinguish it from generic tool defaults.

The port is configurable:
- `--port <n>` CLI flag
- `port` field in `gmap.config.json`
- `GMAP_PORT` environment variable (lowest precedence)

---

## Consequences

- All internal references to "the gmap server port" use the constant `DEFAULT_PORT = 7842` from `@gmap/core`. No magic number appears in more than one place.
- The VS Code extension hardcodes `7842` as its default connect target. The extension reads the workspace `gmap.config.json` to discover a non-default port.
- The Vite dashboard dev server runs on `7843` (default port + 1) to avoid occupying the same port as the production server during development.
- Documentation, `--help` output, and the VS Code extension README all state the default port explicitly.

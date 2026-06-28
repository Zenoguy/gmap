# gmap RFC Process

Any significant change to the architectural structure, API endpoints, serialization formats, or database schema must go through the Request for Comments (RFC) process before implementation.

This process ensures alignment across contributors, prevents architectural decay, and keeps gmap focused on its core design principles.

---

## What Requires an RFC?

You **must** submit an RFC if you propose:
- Adding a new database backend (e.g. Neo4j, Redis, PostgreSQL).
- Introducing a new protocol or transport layer (e.g. GraphQL, gRPC).
- Changing the schema of the `db.sqlite` tables.
- Adding cloud-hosted services or telemetry endpoints.
- Introducing heavy default background processes (e.g. continuous static analysis indexing).
- Changing the public API boundary of `@gmap/core`.

You **do not** require an RFC for:
- Bug fixes.
- Performance optimizations.
- Simple CLI command additions or output formatting tweaks.
- Minor visual improvements in the dashboard UI.
- Upgrading internal package dependencies.

---

## The RFC Lifecycle

```
┌──────────────┐      ┌─────────────────┐      ┌─────────────┐      ┌─────────────┐
│  1. Proposal │ ───▶ │  2. Discussion  │ ───▶ │  3. Decision│ ───▶ │  4. Merge   │
│  (PR to RFC) │      │  (Review Cycle) │      │  (Accept/   │      │  (Create    │
│              │      │                 │      │   Reject)   │      │   ADR link) │
└──────────────┘      └─────────────────┘      └─────────────┘      └─────────────┘
```

1. **Proposal**: Copy the template below and create a markdown file under `documentation/rfc/XXXX-title.md`. Open a Pull Request.
2. **Discussion**: Core maintainers and community members will review, discuss, and request refinements on the PR.
3. **Decision**: Maintainers will either **Accept** or **Reject** the RFC based on architectural alignment, tradeoffs, and simplicity.
4. **Merge**: Once accepted, the RFC is merged into the repository. An Architecture Decision Record (ADR) referencing the RFC is created under `documentation/adr/`.

---

## RFC Markdown Template

```markdown
# RFC: [Descriptive Title]

- **Proposer**: [Your Name / Github Handle]
- **Date**: [YYYY-MM-DD]
- **PR Link**: [URL to Github Pull Request]

## Summary
Provide a brief, high-level summary of what you are proposing.

## Problem Statement
What problem does this solve? Why is the current architecture insufficient? Include code snippets or trace logs if helpful.

## Proposed Design
Detail the technical design:
- File structural changes.
- Database schema changes (include SQL schemas).
- API changes (HTTP/WS payloads).
- Dependency additions (why are they necessary?).

## Alternatives Considered
What other approaches did you evaluate? Why were they dismissed?

## Tradeoffs and Drawbacks
What are the negative consequences? Consider:
- Increased setup complexity.
- Slower scan times or increased disk footprint.
- Native build issues (e.g. C/C++ compilation).
- Security and privacy risks.

## Unresolved Questions
What details are still outstanding and require discussion?
```

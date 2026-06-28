# ADR 0004 — WebSocket for streaming, REST for queries

**Status**: Accepted  
**Date**: June 2026  
**Deciders**: Core team

---

## Problem

The gmap API server needs to serve two fundamentally different communication patterns:

1. **Long-running operations** (scanning a 500-file project) where the client needs live progress — files processed, symbols found, edges created.
2. **Point-in-time queries** (who calls `approveEstimate`?) where the client fires a request and expects an immediate structured response.

Choosing a single protocol for both leads to compromise in one direction or the other.

---

## Alternatives

| Option | Description |
|---|---|
| **REST only** | Polling for scan progress. Simple but wastes connections and adds 500ms+ latency to progress updates. |
| **WebSocket only** | Every query becomes a send/receive message pair over a persistent socket. Complex client code, no HTTP caching, awkward for simple GET requests. |
| **Server-Sent Events (SSE)** | Streaming from server to client only. Doesn't support bidirectional communication needed for triggering scans over the same channel. |
| **WebSocket + REST** ✅ | WebSocket for push events, REST for pull queries. Each protocol is used where it excels. |
| **gRPC** | Bidirectional streaming with type-safe contracts. Overkill for a local dev tool; requires code generation; poor browser support without a proxy. |

---

## Tradeoffs

### WebSocket + REST advantages
- WebSocket: server pushes scan events as they happen — zero polling, zero unnecessary network traffic.
- REST: HTTP GET semantics for queries means browser caching, standard `curl` debugging, and simple integration with any HTTP client.
- The two channels are independently scalable: multiple clients can subscribe to WebSocket events while REST endpoints handle burst queries.
- REST endpoints can be called directly by CI scripts or external tools without a WebSocket handshake.

### WebSocket + REST disadvantages
- Two protocols to maintain and document.
- Client code (VS Code extension, dashboard) must manage both a fetch client and a WebSocket connection.
- WebSocket reconnection logic is the client's responsibility (auto-reconnect with exponential backoff).

---

## Decision

**WebSocket handles all server-push events. REST handles all point-in-time queries.**

This separation is intentional and must not be collapsed. The rule is simple:

- **Is the data produced over time by a running operation?** → WebSocket event.
- **Is the data available immediately from the index?** → REST endpoint.

### WebSocket events (server → client, fan-out to all connected clients)

```
scan:start     scan has begun
scan:file      a file was processed (index, total)
scan:symbol    a symbol was extracted
scan:edge      a call edge was recorded
scan:complete  scan finished successfully
scan:error     a file failed to parse (non-fatal)
```

### REST endpoints

```
GET  /api/health
GET  /api/graph
GET  /api/symbols
GET  /api/symbols/:name
GET  /api/callers/:name?depth=5
GET  /api/callees/:name?depth=5
GET  /api/impact/:name
POST /api/scan          { path: string }
```

### Port

Default port: **7842**. Chosen to avoid conflicts with common dev ports (3000, 4000, 5000, 8080). Configurable via `--port` flag or `gmap.config.json`.

---

## Consequences

- **Fan-out**: all connected WebSocket clients receive all scan events. The broadcaster must handle client disconnections mid-scan gracefully (remove from client list, continue broadcasting to remaining clients).
- **Replay buffer**: clients that connect mid-scan should receive a catch-up snapshot. The API server maintains a ring buffer of recent events (capped at ~1000) for this purpose.
- **Security**: WebSocket server validates the `Origin` header on handshake. Only `localhost` and `127.0.0.1` origins are accepted.
- **`POST /api/scan`**: triggers a scan asynchronously. The HTTP response is immediate (202 Accepted); progress arrives via WebSocket events.
- **Dashboard dev proxy**: the Vite dev server (port 7843) proxies `/api` and `/ws` to `localhost:7842`. In production, the dashboard is served statically by the gmap server itself.

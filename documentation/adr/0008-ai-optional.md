# ADR 0008 — AI is strictly optional

**Status**: Accepted  
**Date**: June 2026  
**Deciders**: Core team

---

## Problem

AI can dramatically improve the narrative layer of codebase understanding (e.g., "explain what this cluster of functions does"). But baking AI deeply into the core data path — inference on every scan, background embeddings, automatic annotations — creates hard dependencies on external services, API costs, latency, and privacy risks in the tool used to understand private codebases.

---

## Alternatives

| Option | Description |
|---|---|
| **AI everywhere** | AI annotations generated automatically on every scan. Rich output, but high cost, latency, and privacy risk. |
| **AI as an optional layer** ✅ | Core features (scan, graph, callers, callees, impact) work without any AI. AI features are explicitly invoked. |
| **No AI** | Pure static analysis. Maximum privacy and performance, minimum accessibility for non-experts. |
| **Local AI only** | Ollama / llama.cpp only. No external API calls ever. Limits AI quality; many users don't run local models. |

---

## Tradeoffs

### AI-optional advantages
- The tool is fully functional with zero API keys, zero network access, zero cost.
- AI calls are explicit and auditable: the user knows exactly when AI is invoked.
- Privacy: AI receives only the graph data and source snippets relevant to the query — never full file contents.
- Token usage is minimised: the prompt contains structured graph data (callers, callees, types), not raw source code.
- The AI layer can be upgraded independently (swap Anthropic for a local Ollama model) without touching core.

### AI-optional disadvantages
- Users must discover and explicitly use `gmap explain` to get AI features.
- Context quality depends on the quality of the graph data passed to the AI. A sparse graph = sparse AI insight.

---

## Decision

**No AI call is made unless the user explicitly invokes `gmap explain <symbol>`. No background AI inference. No telemetry.**

### What AI receives

```json
{
  "symbol": "approveEstimate",
  "kind": "function",
  "file": "src/estimates/approve.ts",
  "callers": ["handleFormSubmit", "batchApproveEstimates"],
  "callees": ["validateEstimate", "persistEstimate", "notifyUser"],
  "sourceSnippet": "// first 20 lines of the function body only"
}
```

**AI never receives**: full file contents, other files, environment variables, or anything outside the symbol's immediate graph neighbourhood.

### AI providers (M8)

| Provider | Mode | Config key |
|---|---|---|
| Ollama | Local, zero-cost, zero-privacy-risk | `ai.provider: "ollama"` |
| Anthropic Claude | Remote, best quality | `ai.provider: "anthropic"`, `ai.apiKey` |
| OpenAI | Remote | `ai.provider: "openai"`, `ai.apiKey` |

Ollama is the zero-config path. Cloud providers require explicit API key configuration.

---

## Consequences

- **M1–M7** are fully implementable without any AI dependency. AI is M8.
- **`gmap explain`** is the only CLI command that makes network requests by default. All other commands are pure local operations.
- **Prompt design** is a first-class engineering concern in M8. The token budget is shared between graph context and instruction. Graph context is truncated before instruction if the budget is tight.
- **No embeddings in V1**: semantic search ("find functions related to billing") is not in V1. It requires vector storage and background indexing — both deferred post-V1.
- **AI errors** (rate limits, API outages) are surfaced clearly to the user. They never cause data loss or corrupt the graph.

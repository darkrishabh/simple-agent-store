# Architecture

## North star

SimpleAgentStore is a deliberately small, user-owned object store shared by AI agents. Agents interpret natural language; SimpleAgentStore executes deterministic storage and retrieval operations.

```text
Codex ─┐
Claude ├── MCP adapter ── SimpleAgentStore core ── SQLite + FTS5
Other ─┘                         │
                                └── local CRUD dashboard
```

MCP and the dashboard are adapters. The TypeScript `AgentStore` class is the core contract; its exported name stays compatible across the project rename. SQLite is the MVP backend, not a permanent protocol constraint.

## Components

| Component | Responsibility |
| --- | --- |
| `src/types.ts` | Object envelope, filters, results, and public TypeScript types. |
| `src/store.ts` | Validation, schema migration, transactions, indexes, CRUD, pagination, and deterministic retrieval. |
| `src/mcp.ts` | Tool schemas and mapping between MCP calls and the core. |
| `src/mcp-http.ts` | Loopback Streamable HTTP transport, origin/host checks, and optional bearer-token authentication. |
| `src/dashboard-server.ts` and `web/` | Local inspection and CRUD interface over the core. |
| `src/config.ts` | Shared persistent SQLite file, port, and bind-host settings for adapters. |
| `plugins/simpleagentstore/` | Optional routing skill and default local MCP connection; it does not contain credentials or host the store. |
| `compose.yaml` and `Dockerfile` | Local MCP/dashboard packaging with a shared SQLite volume and loopback port publishing. |

## Object contract

Callers own stable keys. A write contains a canonical kind, arbitrary JSON object value, explicit searchable text, labels, and optional behavioral metadata. SimpleAgentStore adds an immutable ID, timestamps, and a monotonically increasing version. Writing an existing key is an upsert and preserves its ID and creation time.

Kinds are intentionally small: `note`, `todo`, `reminder`, `calendar`, `reference`, and `other`.

## Retrieval flow

1. Apply deterministic filters for kind, labels, source, timestamps, completion state, or key prefix.
2. Build a bounded candidate set from FTS5, the normalized-label index, and requested phone/email/URL shape indexes.
3. Score and sort candidates deterministically.
4. Return metadata, match fields, and snippets—not full values.
5. Fetch the selected full object by stable key.

Natural-language query rewriting, synonym choice, and relevance judgment remain in the client. SimpleAgentStore does not call an LLM or create embeddings.

## Persistence and concurrency

SQLite runs in WAL mode with foreign keys enabled. Each `put` and label-index update is one transaction. SQLite permits multiple readers but serializes writers. There is no optimistic concurrency field: simultaneous writes to the same key are last-commit-wins and increment the version.

TTL is logical. Expired objects are excluded from ordinary reads but remain on disk until explicitly deleted. Cursor pagination is ordered by creation time and key; cursors are opaque and must be passed back unchanged.

## Trust boundaries

The local process and database owner are trusted. MCP clients, stored values, labels, queries, and browser input are untrusted. The store validates shapes and uses SQL parameters, but calling agents remain responsible for treating retrieved content as data rather than instructions.

See [SECURITY.md](../SECURITY.md) and the [threat model](THREAT_MODEL.md) for deployment limits.

## Non-goals

- embeddings, RAG, or semantic vector search;
- automatic classification or taxonomy management;
- knowledge-graph inference;
- workflow or reminder execution;
- hosted multi-user identity and authorization;
- invisible agent memory.

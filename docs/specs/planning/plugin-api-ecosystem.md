---
title: "Plugin API and App Ecosystem"
id: plugin-api-ecosystem
status: planning
informed_by: []
section: "Platform"
depends_on:
  - "signet-runtime"
success_criteria:
  - "Plugin API supports dashboard/CLI integrations for first-party and third-party apps"
scope_boundary: "Plugin registration, lifecycle, event subscription, and push/pull memory APIs. Does not cover plugin sandboxing, monetization, or marketplace distribution (see git-marketplace-monorepo)."
draft_quality: "auto-generated, needs user validation before implementation"
---

# Plugin API and App Ecosystem

*Registered external services that push, pull, and subscribe to
Signet's memory layer.*

---

## Problem Statement

Signet's daemon exposes an HTTP API on port 3850 that agents and the
CLI use for memory operations. But there is no formal mechanism for
external applications to integrate. An Obsidian plugin that syncs
vault notes as memories, a Google Drive connector that ingests shared
documents, or a browser extension that pushes highlights — all of
these require ad-hoc API calls with no registration, no lifecycle
management, no event subscription, and no way for the daemon to know
which external services are connected.

Without a plugin contract, integrations are fragile: they break on
API changes, they cannot receive push notifications when memories
change, and the daemon cannot enforce per-plugin rate limits or
permissions.

---

## Goals

1. Define a plugin registration contract (manifest, capabilities, auth token).
2. Support bidirectional data flow: plugins push memories in, plugins pull memories out.
3. Provide an event subscription system so plugins receive real-time notifications on memory changes.
4. Enforce per-plugin rate limits and capability scoping.
5. Ship first-party plugins for Obsidian vault sync, browser extension deep integration, and document ingestion (Google Drive / Notion).

---

## Proposed Capability Set

### A. Plugin Manifest and Registration

Plugins register with the daemon via a manifest:

```json
{
  "id": "obsidian-vault-sync",
  "name": "Obsidian Vault Sync",
  "version": "1.0.0",
  "author": "signetai",
  "capabilities": ["memory:write", "memory:read", "events:subscribe"],
  "webhook_url": "http://localhost:9100/signet-webhook",
  "description": "Syncs Obsidian vault notes as memories"
}
```

- `POST /api/plugins/register` — accepts manifest, returns a
  plugin-scoped API token. Token is stored in
  `$SIGNET_WORKSPACE/.plugins/{id}/token`.
- `DELETE /api/plugins/{id}` — unregisters plugin, revokes token.
- `GET /api/plugins` — lists registered plugins with status.
- `GET /api/plugins/{id}` — plugin detail including capability list
  and usage stats.

Registration is idempotent. Re-registering with the same ID updates
the manifest and rotates the token.

### B. Capability Scoping

Each plugin declares capabilities in its manifest. The daemon
enforces these as permission boundaries:

| Capability | Grants |
|---|---|
| `memory:read` | `GET /api/memories/*`, `POST /memory/search` |
| `memory:write` | `POST /api/memories`, `PUT /api/memories/:id` |
| `memory:delete` | `DELETE /api/memories/:id` |
| `events:subscribe` | WebSocket `/api/plugins/{id}/events` |
| `skills:read` | `GET /api/skills/*` |
| `skills:invoke` | `POST /api/skills/:name/invoke` |
| `entities:read` | `GET /api/entities/*`, knowledge graph queries |

Requests with a plugin token that exceed declared capabilities
receive 403. The auth middleware (`packages/daemon/src/auth/`) checks
the plugin's capability set before routing.

### C. Event Subscription (WebSocket)

Plugins with `events:subscribe` capability connect to a WebSocket
endpoint:

```
ws://localhost:3850/api/plugins/{id}/events
```

Events are JSON messages:

```json
{
  "type": "memory:created",
  "payload": { "id": 1234, "content": "...", "agent_id": "default" },
  "timestamp": "2026-03-24T12:00:00Z"
}
```

Event types:
- `memory:created` — new memory written by pipeline or API.
- `memory:updated` — memory content or metadata changed.
- `memory:deleted` — memory removed.
- `entity:changed` — entity aspects/attributes modified.
- `session:started` / `session:ended` — session lifecycle.
- `skill:invoked` — skill was called by an agent.

Plugins specify event type filters at connection time via query
params: `?events=memory:created,session:ended`. Unfiltered
connections receive all events the plugin's capabilities allow.

Agent scoping: events are filtered by the plugin's associated
`agent_id` (set at registration or defaulting to `'default'`).
Plugins never receive events for agents they are not authorized
to observe.

### D. Plugin-Scoped Memory Operations

Memories created by plugins carry provenance:

- `POST /api/memories` with a plugin token sets
  `source = 'plugin:{id}'` on the memory row.
- Plugin-created memories are tagged in the `memories` table and
  visible in dashboard with the plugin's name as provenance.
- Plugins can read only memories matching their `agent_id` scope
  (invariant 1). Cross-agent reads require explicit capability
  `memory:read:cross-agent`.

### E. Rate Limiting

Per-plugin rate limits enforced by the existing rate limiter
(`packages/daemon/src/auth/rate-limiter.ts`):

- Default: 60 requests/minute for read operations, 20/minute for
  write operations.
- Configurable in `agent.yaml`:

```yaml
plugins:
  rate_limits:
    default_read: 60
    default_write: 20
    overrides:
      obsidian-vault-sync:
        read: 120
        write: 60
```

- Rate limit exceeded returns 429 with `Retry-After` header.

### F. First-Party Plugins (Reference Implementations)

Three first-party plugins demonstrate the API contract:

1. **Obsidian Vault Sync** — watches a configured vault directory,
   pushes new/modified notes as memories with `source = 'plugin:obsidian'`.
   Subscribes to `memory:created` events to sync memories back to
   vault as notes (bidirectional).

2. **Browser Extension Deep** — extends the existing
   `@signet/extension` with event subscription. Receives
   `memory:created` events to update the popup in real-time.
   Pushes highlights with richer metadata (URL, selection context,
   page title).

3. **Document Ingestion** — generic document importer that accepts
   file paths or URLs, extracts text, and pushes as memories. Covers
   Google Drive (via API), Notion (via API), and local files. Builds
   on the existing `url-fetcher.ts` in the pipeline.

---

## Non-Goals

- Plugin sandboxing or isolation (trust model is token-scoped, not
  process-isolated).
- Plugin marketplace or discovery (see `git-marketplace-monorepo`).
- Plugin monetization or licensing.
- GraphQL or gRPC transport (HTTP + WebSocket only in v1).
- Dashboard plugin UI panels (plugins integrate via data, not UI
  components in v1).

---

## Integration Contracts

- **Signet Runtime**: runtime manages plugin lifecycle alongside
  MCP server lifecycle. Plugin registration and health checks are
  runtime responsibilities.
- **Auth Middleware**: plugin tokens are a new token type in
  `packages/daemon/src/auth/tokens.ts`. Capability checks extend
  the existing policy engine (`policy.ts`).
- **Multi-Agent**: plugins are scoped to `agent_id` at registration
  (invariant 1). A plugin can serve multiple agents by registering
  once with `agent_id = '*'` (requires explicit `cross-agent`
  capability).
- **Predictive Scorer**: plugin-sourced memories carry `source`
  provenance. The scorer can weight plugin-sourced memories
  differently if the source proves reliable (new feature signal).
- **Entity Taxonomy**: plugin-created entities use the canonical
  taxonomy (invariant 3). Plugins cannot introduce new entity types.
- **Constraints**: plugin-created memories with constraint attributes
  surface unconditionally (invariant 5).

---

## Rollout Phases

### Phase 1: Registration + Push/Pull

Plugin registration, token-scoped auth, capability enforcement.
Plugins can push and pull memories via HTTP. No event subscription
yet. First-party Obsidian plugin as reference (push-only).

### Phase 2: Event Subscription + Bidirectional Sync

WebSocket event stream. Obsidian plugin gains bidirectional sync.
Browser extension deep integration. Rate limiting enabled.

### Phase 3: Document Ingestion + Ecosystem

Document ingestion plugin. Dashboard shows registered plugins with
status and usage. Plugin health monitoring (last-seen, error rate).
Scorer integration for plugin-sourced memory weighting.

---

## Validation and Tests

- Registration test: register a plugin, verify token is returned and
  stored at `$SIGNET_WORKSPACE/.plugins/{id}/token`.
- Capability test: register with `memory:read` only, attempt a write,
  verify 403 response.
- Event subscription test: connect WebSocket, write a memory via API,
  verify `memory:created` event is received within 1 second.
- Agent scoping test: register plugin for agent A, write a memory for
  agent B, verify the plugin's read returns only agent A memories.
- Rate limit test: exceed the write rate limit, verify 429 response
  with correct `Retry-After` header.
- Provenance test: write a memory via plugin token, verify
  `source = 'plugin:{id}'` on the memory row.

---

## Success Metrics

- A registered plugin can push a memory and receive a confirmation
  within <100ms (local network).
- Event subscription delivers notifications within 500ms of the
  triggering database write.
- First-party Obsidian plugin successfully syncs 100 vault notes as
  memories without rate limit errors at default limits.

---

## Open Decisions

1. **Event delivery guarantee** — should WebSocket events be
   at-most-once (current plan) or at-least-once with ack/retry?
   At-least-once adds complexity but prevents missed events during
   transient disconnects.
2. **Plugin discovery** — should plugins be able to discover each
   other via the API? Useful for plugin composition but raises
   security questions about plugin-to-plugin data access.
3. **Webhook vs WebSocket** — the manifest includes `webhook_url`
   for push delivery. Should v1 support both webhook (HTTP POST)
   and WebSocket, or defer webhooks to Phase 3?

---
title: "Distributed Harness and Agent Orchestration"
id: distributed-harness-orchestration
status: planning
informed_by: []
section: "Platform"
depends_on:
  - "multi-agent-support"
  - "signet-runtime"
success_criteria:
  - "Architecture supports multiple remote harnesses, multiple agents, and multiple memory backends under one control plane"
scope_boundary: "Defines control plane protocol, daemon discovery, and memory routing for multi-machine deployments; does not define agent scheduling policies or cloud hosting infrastructure"
draft_quality: "auto-generated, needs user validation before implementation"
---

# Distributed Harness and Agent Orchestration

Spec metadata:
- ID: `distributed-harness-orchestration`
- Status: `planning`
- Hard depends on: `multi-agent-support`, `signet-runtime`
- Registry: `docs/specs/INDEX.md`

---

## 1) Problem

Signet currently runs as a single daemon per machine, serving one
`~/.agents/` workspace. Multi-agent support (migration 043) added
agent_id scoping within that single daemon, but the architecture
assumes co-location: all agents share one SQLite database on one host.

Real deployments need more. A Mac Studio running 3 agents needs to
coordinate with a Linux server running 2 more, each with their own
daemon instance. Today there is no discovery protocol, no cross-daemon
memory routing, and no unified control plane. Operators must manually
configure each machine independently.

## 2) Goals

1. Define a control plane protocol for daemon-to-daemon discovery and health.
2. Route memory queries across daemon instances by agent_id ownership.
3. Preserve agent_id scoping invariant across all cross-daemon operations.
4. Support heterogeneous deployments (mixed OS, mixed daemon versions).
5. Degrade gracefully when remote daemons are unreachable.

## 3) Proposed capability set

### A) Daemon discovery and registration

Each daemon advertises itself to a designated coordinator (primary daemon)
via periodic heartbeat on a new `/api/cluster/heartbeat` endpoint. The
heartbeat includes: daemon version, host, port, agent roster, and
capabilities (pipeline enabled, graph enabled, etc.). The coordinator
maintains a `cluster_peers` in-memory registry with TTL-based expiry.

### B) Agent ownership routing

The coordinator maps agent_id to owning daemon. When a memory query
arrives for an agent hosted on a remote daemon, the coordinator proxies
the request via HTTP. The routing table is derived from heartbeat data.
Local agents are served directly; remote agents incur one proxy hop.

### C) Cross-daemon memory federation

Read operations (recall, search, expand) can fan out to multiple daemons
when the query spans agents with different visibility policies (shared,
group). Write operations always route to the owning daemon. Federation
respects agent read policy from `multi-agent-support` (isolated agents
never fan out).

### D) Control plane CLI

`signet cluster status` shows all known daemons, their agents, and health.
`signet cluster join <host:port>` registers a remote daemon with the
coordinator. `signet cluster remove <host>` deregisters. All commands
call the coordinator daemon's HTTP API.

## 4) Non-goals

- No custom transport protocol (HTTP over existing Hono/axum stack).
- No automatic agent migration between daemons.
- No shared SQLite across network (each daemon owns its database).
- No cloud orchestration or container scheduling.

## 5) Integration contracts

### Distributed Orchestration <-> Multi-Agent Support

- Agent_id scoping from multi-agent is the routing key for federation.
- Agent visibility (isolated/shared/group) determines fan-out eligibility.
- The cluster roster is additive to the per-daemon agent roster.

### Distributed Orchestration <-> Signet Runtime

- Runtime session start resolves the target daemon via the routing table.
- Runtime API calls are daemon-addressed, not cluster-addressed (the
  coordinator resolves once at session start).

### Distributed Orchestration <-> Rust Daemon Parity

- The cluster protocol must work identically on JS and Rust daemons.
- Version negotiation in heartbeat enables mixed-version clusters.

## 6) Rollout phases

### Phase 1 (single-coordinator, read-only federation)

- Heartbeat endpoint and peer registry on coordinator daemon.
- CLI `signet cluster status` and `signet cluster join`.
- Cross-daemon recall proxy for shared-visibility agents.
- No write federation (writes must target the owning daemon directly).

### Phase 2 (full federation)

- Write routing to owning daemon via coordinator proxy.
- Fan-out search across multiple daemons with result merging.
- Health-aware routing (skip unreachable daemons, surface degradation).

### Phase 3 (resilience)

- Coordinator failover (any daemon can become coordinator).
- Conflict resolution for agent_id collisions across daemons.
- Metrics and dashboard visualization of cluster topology.

## 7) Validation and tests

- Heartbeat TTL expiry removes stale peers from the registry.
- Recall for a remote agent returns results from the owning daemon.
- Isolated agents never appear in cross-daemon fan-out results.
- Agent_id is present on every federated query (scoping invariant).
- Coordinator proxy adds < 5ms overhead on localhost.
- Graceful degradation: unreachable daemon returns partial results, not error.

## 8) Success metrics

- Multi-machine deployment operates from a single CLI entry point.
- Cross-daemon recall latency stays under 50ms on LAN.
- Zero data collision across agents on different daemons.
- Cluster survives single-daemon failure without data loss.

## 9) Open decisions

1. Whether the coordinator is a designated daemon or an elected role.
2. Authentication model for inter-daemon communication (shared secret vs mTLS).
3. Whether to support WAN deployments or restrict to LAN-only in v1.

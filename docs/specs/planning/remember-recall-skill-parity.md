---
title: "Remember/Recall Skill Parity Refresh"
id: remember-recall-skill-parity
status: planning
informed_by: []
section: "Procedural Memory"
depends_on:
  - "procedural-memory-plan"
success_criteria:
  - "/remember and /recall skills align with current memory architecture and schema"
scope_boundary: "Refreshes skill behavior and MCP tool contracts for remember/recall; does not add new memory types or change the pipeline extraction logic"
draft_quality: "auto-generated, needs user validation before implementation"
---

# Remember/Recall Skill Parity Refresh

Spec metadata:
- ID: `remember-recall-skill-parity`
- Status: `planning`
- Hard depends on: `procedural-memory-plan`
- Registry: `docs/specs/INDEX.md`

---

## 1) Problem

The `/remember` and `/recall` skills (and their MCP equivalents
`memory_store` and `memory_search`) were written before three major
architecture changes: the knowledge graph (KA-1 through KA-6), multi-agent
support (migration 043), and the predictive memory scorer. As a result:

1. **No entity linking on write.** `memory_store` bypasses the graph entirely.
2. **No graph-aware recall.** `memory_search` uses embedding-primary path,
   not graph traversal as pipeline recalls do.
3. **No agent scoping.** Skills do not pass `agent_id` to the daemon API.
4. **No structured memory types.** The `type` parameter accepts free-form
   strings with no validation against the entity taxonomy.

## 2) Goals

1. Stored memories trigger entity linking and graph integration.
2. Recall uses graph traversal as primary path with embedding as gap-fill.
3. Agent_id flows through all skill invocations to the daemon API.
4. Memory types are validated against the entity taxonomy.
5. Backward compatibility: existing callers see improved results, not errors.

## 3) Proposed capability set

### A) Entity linking on remember

`/api/memory/remember` runs inline entity linking (`inline-entity-linker.ts`)
on stored content, creating entity mentions, aspects, and attributes at
write time. Linking runs synchronously within the remember transaction.

### B) Graph-aware recall

`memory_search` uses the same retrieval path as pipeline recalls: graph
traversal as primary channel, FTS5 as gap-fill, post-fusion dampening
(DP-16). The `expand` parameter defaults to `true`. Constraint memories
surface regardless of score rank (cross-cutting invariant).

### C) Agent-scoped operations

MCP tool handlers resolve `agent_id` from session context via the session
tracker and pass it to daemon API calls as `x-signet-agent-id` header.
All queries filter by agent_id and visibility.

### D) Structured memory types with taxonomy validation

The `type` parameter validates against the entity taxonomy: `person`,
`project`, `system`, `tool`, `concept`, `skill`, `task`, `unknown`.
Invalid types return 400 with valid options. Default is `unknown`.

### E) Scorer signal emission

Store events produce write-source features (skill vs pipeline vs manual).
Recall events produce retrieval-outcome features (hit/miss, rank, feedback).
These signals feed into scorer training pairs.

## 4) Non-goals

- No new MCP tool definitions (existing `memory_store` and `memory_search` are refreshed).
- No changes to the extraction pipeline (this is about explicit user-initiated operations).
- No skill YAML format changes.
- No dashboard UI changes for skills.

## 5) Integration contracts

### Skill Parity <-> Procedural Memory

- Skills stored as graph entities (per procedural-memory-plan) can be
  recalled via `memory_search` with type filter `skill`.
- Usage tracking on skill entities increments when a skill-typed memory
  is stored or recalled.

### Skill Parity <-> Predictive Scorer

- New write-source and retrieval-outcome signals become scorer features.
- Scorer must handle the new feature dimensions gracefully (cold start
  uses default weights until training pairs accumulate).

### Skill Parity <-> Multi-Agent Support

- Agent_id is mandatory on all skill-originated daemon API calls.
- Visibility rules (isolated/shared/group) apply identically to
  skill-originated and pipeline-originated memories.

## 6) Rollout phases

### Phase 1 (agent scoping + type validation)

- Thread agent_id through MCP tool handlers to daemon API.
- Add taxonomy validation on `memory_store` type parameter.
- No behavior change for recall (still embedding-primary).

### Phase 2 (graph integration)

- Enable inline entity linking on `/api/memory/remember`.
- Switch `memory_search` to graph-traversal-primary recall path.
- Default `expand` to true on the MCP tool.

### Phase 3 (scorer integration)

- Emit write-source and retrieval-outcome signals from skill operations.
- Validate scorer training pairs include skill-originated data.

## 7) Validation and tests

- Memory stored via `memory_store` produces entity mentions in `memory_entity_mentions`.
- Recall via `memory_search` returns graph-traversal results when entities are present.
- Agent_id is present on every daemon API call from skill handlers.
- Invalid memory type returns 400 with valid options listed.
- Constraint memories surface in recall results regardless of score.
- Multi-agent isolation: agent A's skill-stored memory is not visible to isolated agent B.

## 8) Success metrics

- Skill-stored memories participate in graph traversal (non-zero entity mention count).
- Recall quality from skills matches pipeline-originated recall quality on LoCoMo suite.
- Zero agent_id scoping violations in multi-agent deployments.
- No breaking changes for existing `memory_store`/`memory_search` callers.

## 9) Open decisions

1. Whether entity linking on remember should be synchronous (blocking) or
   queued via the pipeline job system.
2. Whether to add a `confidence` parameter to `memory_store` for
   user-specified certainty levels.
3. Whether recall should support explicit graph traversal depth as a
   parameter or keep it internal.

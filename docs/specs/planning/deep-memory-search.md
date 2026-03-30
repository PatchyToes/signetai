---
title: "Deep Memory Search (Agentic Escalation)"
id: deep-memory-search
status: planning
informed_by: []
section: "Retrieval"
depends_on:
  - "desire-paths-epic"
  - "ssm-foundation-evaluation"
success_criteria:
  - "Optional deep memory search path uses multi-agent LLM retrieval only when primary retrieval confidence is low"
scope_boundary: "Defines the escalation trigger, LLM-powered comparison logic, and result merging; does not replace primary retrieval or change the embedding pipeline"
draft_quality: "auto-generated, needs user validation before implementation"
---

# Deep Memory Search (Agentic Escalation)

Spec metadata:
- ID: `deep-memory-search`
- Status: `planning`
- Hard depends on: `desire-paths-epic`, `ssm-foundation-evaluation`
- Registry: `docs/specs/INDEX.md`

---

## 1) Problem

Primary retrieval (graph traversal + hybrid vector/keyword) works well
when the query maps to embedded content. But some queries fail because
the connection is semantic, not lexical or geometric: the memory exists
but its embedding is distant and keywords don't overlap. LoCoMo
experiments showed retrieval was the bottleneck in most failures.

Supermemory demonstrates that an LLM can read and compare memories
directly, finding connections embedding similarity misses. The tradeoff
is cost/latency (10-100x slower). The solution: escalation when
primary confidence is low.

## 2) Goals

1. Define a confidence threshold that triggers deep search escalation.
2. Use an LLM to read, compare, and rank candidate memories directly.
3. Keep deep search optional and off by default (opt-in via config).
4. Bound latency and cost with token budgets and candidate limits.
5. Feed deep search outcomes back to the scorer as training signal.

## 3) Proposed capability set

### A) Confidence-based escalation trigger

After primary retrieval, compute confidence from top-score magnitude,
rank-1-to-rank-2 gap, and result count. Below a configurable threshold
(default: 0.3, exposed at `memory.deepSearch.threshold` in agent.yaml),
the query escalates to deep search.

### B) Candidate expansion

Expands beyond primary results via three strategies: temporal neighbors
(same/adjacent sessions), entity neighbors (one-hop via `entity_dependencies`),
and community members (same Louvain cluster). Pool capped at configurable
limit (default: 50).

### C) LLM comparison and ranking

The LLM receives the query and candidate pool, returns a ranked list with
relevance scores and reasoning. Focuses on semantic connection, temporal
relevance, and contradiction detection. Uses pipeline extraction provider
by default; override via `memory.deepSearch.model`.

### D) Result merging

Weighted blend with primary results. Constraint memories from deep search
always surface (cross-cutting invariant). Duplicates use the higher score.

### E) Cost and latency bounds

Token budget (default: 8192), timeout (default: 10s, returns primary
results on abort), and per-session rate limit (default: 5 invocations).

### F) Scorer feedback loop

Deep search hits produce training pairs: negative for primary path
(missed memory), positive for expansion features used. Over time the
scorer learns to rank these memories higher, reducing deep search
invocation rate.

## 4) Non-goals

- No replacement of primary retrieval (deep search is supplementary only).
- No real-time indexing changes (deep search is read-path only).
- No custom embedding model training.
- No cross-agent deep search (agent_id scoping preserved).

## 5) Integration contracts

### Deep Search <-> Desire Paths

- Deep search consumes graph traversal results and entity dependency edges
  for candidate expansion.
- Constraint-surfacing invariant applies to deep search results.
- Post-fusion dampening (DP-16) applies before the confidence check.

### Deep Search <-> SSM Foundation

- SSM temporal scoring can inform candidate expansion ordering.
- Deep search outcomes feed SSM training as temporal relevance signal.
- SSM evaluation harness includes deep search ablation runs.

### Deep Search <-> Predictive Scorer

- Deep search hits/misses produce scorer training pairs.
- Scorer feature vector gains a `deep_search_eligible` boolean dimension.
- As scorer improves, deep search invocation rate should decline.

## 6) Rollout phases

### Phase 1 (shadow mode)

- Deep search runs in shadow mode: executes but does not merge results.
- Logs deep search candidates, LLM rankings, and comparison to primary results.
- Confidence threshold tuned from shadow data.
- No user-visible behavior change.

### Phase 2 (opt-in active)

- `memory.deepSearch.enabled: true` in agent.yaml activates result merging.
- Token budget, timeout, and rate limit enforced.
- Dashboard shows deep search invocation count and hit rate.

### Phase 3 (scorer-driven adaptive threshold)

- Confidence threshold adjusted dynamically by the scorer based on
  historical deep search hit rate per query category.
- Deep search invocations decrease as scorer improves.

## 7) Validation and tests

- Deep search only triggers when confidence is below threshold.
- Candidate pool respects configured cap.
- Timeout aborts cleanly, returns primary results.
- Rate limit enforced per session. Agent_id on all expansion queries.
- Constraint memories from deep search surface in final results.
- Shadow mode produces logs without changing returned results.

## 8) Success metrics

- Recovers at least 30% of memories primary retrieval misses on LoCoMo.
- Average latency under 5s (p95 under 10s).
- Invocation rate decreases over time as scorer improves.
- Zero agent_id scoping violations in candidate expansion.

## 9) Open decisions

1. Whether the LLM prompt includes entity graph context or just raw content.
2. Whether to batch multiple low-confidence queries in one LLM call.
3. Whether deep search is exposed as MCP tool or internal escalation only.

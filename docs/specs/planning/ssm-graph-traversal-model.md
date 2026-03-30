---
title: "SSM Graph Traversal Model"
id: ssm-graph-traversal-model
status: planning
informed_by:
  - "docs/research/technical/SSM-GRAPH-INTERSECTION.md"
  - "docs/research/technical/RESEARCH-SSM-INTEGRATION.md"
  - "docs/research/technical/SSM-LITERATURE-REVIEW.md"
  - "arxiv:2601.07372 (Engram: Conditional Memory via Scalable Lookup)"
section: "Knowledge Architecture"
depends_on:
  - "ssm-temporal-backbone"
  - "desire-paths-epic"
  - "knowledge-architecture-schema"
  - "ontology-evolution-core"
success_criteria:
  - "SSM-assisted path ranking improves multi-hop retrieval quality over static scoring"
  - "Graph-conditioned scoring respects constraint-surfacing and traversal bounds invariants"
  - "Shadow and ablation runs show measurable gains before default-path adoption"
scope_boundary: "Defines SSM-assisted path scoring for graph traversal outputs; does not replace deterministic traversal bounds or constraint injection rules"
---

# SSM Graph Traversal Model

## 1) Problem

Graph traversal in Signet (DP-6) produces candidate paths through the
entity dependency graph. Currently, path ranking uses a static composite
score: `strength * confidence * association_weight` with post-fusion
dampening (DP-16: gravity, hub, resolution filters). This works for
single-hop and well-connected entities but degrades on multi-hop paths
where the quality of intermediate edges matters more than terminal scores.

The core issue is that static path scoring cannot learn from traversal
outcomes. When the system discovers that a particular 3-hop path through
entities A -> B -> C consistently produces relevant memories, the static
scorer has no mechanism to remember that pattern. Each traversal starts
from scratch.

SSM-GRAPH-INTERSECTION research identifies DyGMamba (two-level SSM for
continuous-time dynamic graphs) and TF-TKG (temporal filtering for
knowledge graph reasoning) as directly applicable architectures. The
Engram paper further validates that hash-based O(1) lookup for static
patterns combined with learned dynamic scoring outperforms purely
learned approaches, suggesting that graph structure (static) and
traversal dynamics (learned) should remain separate systems.

## 2) Goals

1. Score traversal paths using an SSM that processes the sequence of
   edges (hops) as a temporal sequence, learning which edge patterns
   lead to relevant memory retrieval.
2. Incorporate per-edge signals (confidence, co-occurrence, relationship
   type, age, traversal count) as features for the path SSM.
3. Operate in shadow mode with deterministic fallback to static path
   scoring. No production path ranking changes without passing gates.
4. Provide per-path explainability: why a path was promoted or demoted,
   which edges contributed most to the score.
5. Preserve all hard invariants: bounded traversal, constraint surfacing,
   agent scoping, post-fusion dampening.

## 3) Proposed capability set

### A) Path feature encoding

Each traversal path is a sequence of edges. Encode each edge as a
feature vector:

| Feature | Description | Encoding |
|---------|-------------|----------|
| source_type | Entity type of source node | One-hot (8 types) |
| target_type | Entity type of target node | One-hot (8 types) |
| relationship_type | Dependency type | Categorical embedding |
| confidence | Edge confidence (0-1) | Direct |
| strength | Edge strength (0-1) | Direct |
| association_weight | NPMI co-occurrence | Direct |
| log_edge_age | Days since edge creation | log1p |
| traversal_count | Times this edge was traversed | log1p |
| hop_position | Position in path (0-indexed) | Normalized by max hops |
| is_community_boundary | Does edge cross Louvain communities? | Binary |
| source_density | Structural density of source entity | log1p |
| target_density | Structural density of target entity | log1p |

12-dim per edge. A 3-hop path produces a sequence of 3 feature vectors.

### B) Path SSM architecture

Inspired by DyGMamba's two-level design:

**Level 1: Edge-level SSM**

Processes the edge feature sequence along a single path:

```
Edge sequence: [e1, e2, ..., eH]  (H = hop count, max 5)
    |
    v
Input projection: Linear(12, 32)
    |
    v
Selective SSM (1 layer, state_dim=16, conv_kernel=3)
    |
    v
Path embedding: last hidden state (32-dim)
```

Short sequences (max 5 hops from bounded traversal) make the SSM's
sequential scan cheap. The causal convolution (kernel=3) captures
local edge-pair patterns (e.g., "uses -> depends_on" is a common
productive pattern).

**Level 2: Path comparison**

Multiple candidate paths compete for ranking:

```
Candidate paths: [path1, path2, ..., pathN]
    |
    v
Path embeddings from Level 1: [p1, p2, ..., pN]
    |
    v
Query conditioning: dot(query_embedding_down, path_embedding)
    |
    v
Score head: Linear(32, 1)
    |
    v
ListNet loss over path rankings
```

Query conditioning uses the session context embedding (downprojected
to 32-dim) to bias path scores toward the current session's focus.

**Parameter budget**: ~50K parameters. Intentionally small because
paths are short sequences (max 5 edges) and the model's job is
narrow: rank paths, not generate them.

### C) Training signal: path feedback

DP-9 (path feedback propagation) provides the training signal:

- After a session, paths that led to memories receiving positive agent
  feedback get positive labels.
- Paths leading to irrelevant memories get negative labels.
- Paths that were not traversed get zero labels (unknown).

This is a sparse signal. Augment with:

- **Heuristic labels from DP-6 benchmark**: the 50-question LoCoMo set
  provides ground truth for which paths lead to correct answers.
- **Synthetic path data**: generate synthetic entity graphs with known
  productive paths, following SYNTHETIC-DATA-GENERATION patterns.

### D) Shadow mode and fallback

Path SSM runs in shadow mode by default:

- Static scorer produces the production path ranking.
- Path SSM produces a shadow ranking on the same candidate paths.
- Both are logged for offline comparison.
- Dashboard shows agreement rate, per-pattern performance, and
  which paths the SSM would have promoted/demoted.

Deterministic fallback: if the SSM sidecar is unavailable, times out
(>10ms), or returns NaN scores, the static scorer's ranking is used
with no degradation. Same fail-open pattern as the production scorer.

### E) Explainability payload

Each scored path includes an explanation:

```json
{
  "path": ["entity:signet", "entity:cloudflare", "entity:wrangler"],
  "score": 0.82,
  "static_score": 0.65,
  "explanation": {
    "dominant_edge": 1,
    "dominant_feature": "association_weight",
    "community_crossing_penalty": 0.0,
    "hop_count_factor": 0.95
  }
}
```

The `dominant_edge` and `dominant_feature` are computed by gradient
attribution: which edge and which feature had the largest gradient
magnitude for the final score.

### F) Constraint preservation

Hard invariants from INDEX.md:

- **Bounded traversal**: the SSM scores paths after traversal, it does
  not control traversal bounds. Max hops, max candidates, and timeout
  are unchanged.
- **Constraint surfacing**: paths containing constraint-bearing entities
  are never suppressed by SSM scoring. Constraints surface regardless
  of path score (invariant 5).
- **Agent scoping**: all path data is agent-scoped. No cross-agent
  path scoring.
- **Post-fusion dampening**: DP-16 gravity/hub/resolution filters
  apply after SSM scoring, same as they apply after static scoring.

## 4) Non-goals

- No unbounded traversal. Max hops and candidate limits are fixed.
- No removal of post-fusion dampening or constraint overrides.
- No modification of the entity dependency graph structure.
- No real-time graph topology learning (that's ontology-evolution-core).
- No replacement of the temporal backbone (this spec extends it for
  graph-structured inputs, not replaces it).

## 5) Integration contracts

### SSM Graph Traversal <-> Desire Paths

- Consumes traversal path output from DP-6 (entity-anchored search).
- Path features include DP-2 edge confidence and DP-5 community IDs.
- DP-9 path feedback is the primary training signal.
- DP-16 post-fusion dampening applies after SSM path scoring.

### SSM Graph Traversal <-> Knowledge Architecture

- Entity types from KA taxonomy used for source_type/target_type features.
- Structural density from KA used for source/target density features.
- Entity aspects/attributes accessed for explainability but not as
  direct SSM inputs (keeps feature vector compact).

### SSM Graph Traversal <-> SSM Temporal Backbone

- Path SSM is a separate model from the temporal backbone SSM.
- The temporal backbone handles per-memory relevance over time.
- The path SSM handles per-path quality over graph structure.
- Both run as shadow sidecars with independent fallbacks.
- Future: the two models could share a session context embedding,
  but they score different things (memories vs paths).

### SSM Graph Traversal <-> Predictive Memory Scorer

- DP-10 (path scoring) evolves the scorer feature vector to include
  per-path signals: best_path_ssm_score, path_hop_count,
  min_edge_confidence, community_crossings.
- These become additional dimensions in the scorer's feature payload,
  not a replacement for existing features.

## 6) Rollout phases

### Phase 1: Shadow deployment

- Implement path feature encoder (12-dim per edge).
- Train path SSM on synthetic + LoCoMo benchmark data.
- Deploy as shadow sidecar alongside static path scorer.
- Log predictions, dashboard comparison panel.
- Validate on multi-hop benchmark slices.

### Phase 2: DP-9 feedback integration

- Wire path feedback from real sessions into training pipeline.
- Implement explainability payload with gradient attribution.
- Extend shadow logging with per-path explanation.
- Run TSTR protocol: synthetic-trained vs real-trained vs combined.

### Phase 3: Production blending

- Blend path SSM scores with static scores using configurable alpha.
- Start at alpha=0.1, increase based on shadow metrics.
- A/B evaluation: alternating sessions with and without path SSM.
- Minimum 50 sessions per arm before increasing alpha.
- Automatic rollback on any regression in multi-hop benchmark.

## 7) Validation and tests

- Multi-hop retrieval: >10% MRR improvement on 3+ hop paths compared
  to static path scoring, on the LoCoMo benchmark subset.
- Constraint preservation: zero constraint suppression incidents across
  all test sessions (must remain at zero).
- Bounded traversal: path SSM only scores paths within configured max
  hops (traversal bounds are enforced upstream, not by the SSM).
- Latency: path scoring adds <5ms p95 to traversal pipeline (paths
  are short, model is small).
- Fallback: deterministic fallback engages correctly when SSM sidecar
  is killed mid-scoring.
- Agent scoping: paths from agent A never influence scoring for agent B.
- Explainability: gradient attribution correctly identifies dominant
  edge in >80% of synthetic test cases with known productive edges.

## 8) Success metrics

- Multi-hop precision: fraction of 3+ hop paths leading to relevant
  memories increases by >15% compared to static scoring.
- Path diversity: SSM-scored retrieval surfaces memories from >20% more
  distinct entities than static scoring on the same queries.
- Agent feedback correlation: SSM path scores correlate with downstream
  agent feedback (Spearman rho > 0.3, p < 0.05).
- Convergence speed: path SSM produces useful rankings within 20
  sessions of path feedback data.

## 9) Open decisions

1. Whether the path SSM should share parameters with the temporal
   backbone SSM or be a completely independent model. Independent is
   simpler and avoids coupling failure modes. Shared saves compute
   but creates a single point of failure.
2. Whether edge features should include entity embedding fragments
   (downprojected, like the current scorer's encoding paths) or stay
   purely structural. Structural keeps the model small; embeddings
   add semantic signal but increase parameter count.
3. How to handle paths with mixed confidence levels: should a single
   low-confidence edge in a 4-hop path tank the whole path score, or
   should the SSM learn its own confidence aggregation? The static
   scorer uses min-confidence, which is conservative. The SSM could
   learn something more nuanced.

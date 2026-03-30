---
title: "Post-Merge Canary Suite"
id: post-merge-canary-suite
status: planning
informed_by: []
section: "Release"
depends_on:
  - "release-train-cadence"
success_criteria:
  - "Main branch merges trigger lightweight canary checks before broader rollout"
scope_boundary: "A GitHub Actions workflow and a canary test script. No changes to daemon or core source code."
draft_quality: "auto-generated, needs user validation before implementation"
---

# Post-Merge Canary Suite

## Problem

PR-level tests validate individual packages but miss integration-level
regressions: daemon fails to start after a migration, search quality
degrades, remember/recall cycle breaks. These are caught only after
release when users report issues. The full test suite is too slow for
post-merge gating.

## Goals

1. Run a lightweight integration canary after every merge to main.
2. Catch daemon startup, memory pipeline, and search regressions
   within minutes of merge.
3. Complete in under 3 minutes (not a full test suite).

## Non-goals

- Replacing PR-level unit and integration tests.
- Performance benchmarking (canary checks correctness, not speed).
- Blocking the merge itself (canary runs post-merge).

## Proposed approach

**Canary script** (`scripts/canary.ts`): A self-contained script
that exercises the critical integration path:

1. **Build**: Run `bun run build` to verify the build succeeds from
   a clean state.
2. **Daemon startup**: Start the daemon on a test port (3851) with a
   temporary workspace directory. Verify `/health` returns 200 within
   10 seconds.
3. **Migration integrity**: Verify the daemon applied all migrations
   by checking the migration count via the API or direct SQLite query.
4. **Remember/recall cycle**: POST a test memory to `/api/remember`.
   Search for it via `/memory/search`. Verify the memory is returned
   with a relevance score above a threshold.
5. **Cleanup**: Stop the daemon, remove the temporary workspace.

**CI workflow** (`.github/workflows/canary.yml`): Triggered on push
to main. Runs the canary script. On failure, posts an alert (GitHub
issue labeled `canary-failure`, or Discord notification).

**Failure handling**: Canary failures do not revert the merge (too
disruptive). Instead, they create a high-priority issue assigned to
the last committer. The release train workflow checks for open canary
failure issues and blocks release if any exist.

## Phases

### Phase 1 -- Core canary checks

- Implement `scripts/canary.ts` with steps 1-5.
- Add canary workflow triggered on push to main.
- Add failure alerting via GitHub issue creation.

### Phase 2 -- Release train integration

- Block release workflow if open canary-failure issues exist.
- Add search quality baseline check (compare recall scores against a
  known-good threshold).
- Add canary run time tracking to detect performance regressions in
  the canary itself.

## Validation criteria

- A merge that breaks daemon startup triggers a canary failure alert
  within 5 minutes.
- A successful merge with no regressions completes canary in under 3
  minutes.
- The remember/recall cycle test catches search regressions (e.g.,
  missing FTS index).
- Canary failure creates a GitHub issue with the failing step and
  commit SHA.

## Open decisions

1. Should the canary run on a self-hosted runner (for consistent
   performance) or GitHub-hosted runners?

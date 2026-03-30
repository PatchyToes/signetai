---
title: "PR Risk Tier Policy"
id: pr-risk-tier-policy
status: planning
informed_by: []
section: "Process"
depends_on:
  - "ci-contract-invariants-lane"
success_criteria:
  - "PRs declare risk tier and high-risk PRs require rollback/test plans"
scope_boundary: "GitHub Actions workflow, PR template, and a risk-classification script. No changes to application code."
draft_quality: "auto-generated, needs user validation before implementation"
---

# PR Risk Tier Policy

## Problem

All PRs go through the same review process regardless of scope. A
one-line typo fix waits for the same review cycle as a schema
migration. High-risk PRs (API changes, new migrations, new packages)
sometimes lack rollback plans or sufficient test coverage. This
wastes reviewer time on low-risk changes and under-scrutinizes
high-risk ones.

## Goals

1. Auto-classify PRs into risk tiers based on changed files.
2. Fast-track low-risk PRs with minimal review friction.
3. Require explicit rollback/test plans for high-risk PRs.
4. Surface the risk tier visibly in CI and PR labels.

## Non-goals

- Blocking any PR from merging (tiers add requirements, not gates).
- Replacing human judgment on edge cases.

## Proposed approach

**Risk tiers**:

- **Tier 0 (trivial)**: Docs-only, comment-only, or config tweaks
  under 20 lines. No review required beyond CI pass.
- **Tier 1 (standard)**: Source changes under 200 lines, no schema
  or API changes. One approval required.
- **Tier 2 (elevated)**: Schema migrations, API route changes, new
  packages, changes to build scripts, or changes over 200 lines. One
  approval required plus: spec alignment check, rollback plan in PR
  description, regression test for each bug fix.

**Classification script** (`scripts/ci-risk-tier.ts`): Analyzes the
PR diff. Checks for migration files, API route files, package.json
additions, line count. Outputs the tier as a GitHub Actions output
variable.

**CI integration**: The risk tier is applied as a PR label
(`risk:tier-0`, `risk:tier-1`, `risk:tier-2`). Tier 2 PRs get an
additional CI check that verifies the PR description contains a
`## Rollback plan` section and a `## Test plan` section.

**PR template update**: Add optional Rollback plan and Test plan
sections to the PR template. Tier 2 classification makes them
mandatory (CI fails if absent).

## Phases

### Phase 1 -- Classification and labeling

- Implement `scripts/ci-risk-tier.ts` with file-pattern heuristics.
- Add CI step to compute tier and apply PR label.
- Update PR template with Rollback plan and Test plan sections.

### Phase 2 -- Enforcement

- Add required check for Tier 2 PRs validating description sections.
- Configure branch protection to require 0 approvals for Tier 0, 1
  for Tier 1 and Tier 2.
- Review and adjust tier boundaries after 4 weeks of data.

## Validation criteria

- A docs-only PR is labeled `risk:tier-0` automatically.
- A PR adding a migration file is labeled `risk:tier-2`.
- A Tier 2 PR without a rollback plan section fails CI.
- Tier boundaries are configurable without code changes (JSON config).

## Open decisions

1. Should Tier 2 PRs require two approvals instead of one, or is one
   approval plus the structural checks sufficient?

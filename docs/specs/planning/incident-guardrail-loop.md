---
title: "Incident to Guardrail Loop"
id: incident-guardrail-loop
status: planning
informed_by: []
section: "Process"
depends_on:
  - "ci-contract-invariants-lane"
success_criteria:
  - "Every production incident produces at least one durable AGENTS/CI guardrail update"
scope_boundary: "PR template changes, a CI check script, and process documentation. No application code changes."
draft_quality: "auto-generated, needs user validation before implementation"
---

# Incident to Guardrail Loop

## Problem

CLAUDE.md mandates that every bug fix adds a durable prevention
mechanism (regression test, invariant check, CI guard, or spec
update). This rule is documented but not enforced. Bug-fix PRs
sometimes ship without any guardrail, leaving the codebase vulnerable
to the same failure class. There is no tracking of guardrail coverage
or accountability.

## Goals

1. Enforce that bug-fix PRs include at least one durable guardrail.
2. Track the guardrail-per-incident ratio over time.
3. Make the requirement visible and easy to satisfy.

## Non-goals

- Defining what constitutes a "good enough" guardrail (that is human
  judgment).
- Auto-generating tests or guardrails.
- Tracking incidents outside of the git/PR workflow.

## Proposed approach

**Bug-fix PR detection**: A CI script identifies bug-fix PRs by
conventional commit prefix. Any PR where the majority of commits use
`fix:` is classified as a bug-fix PR.

**Guardrail checklist** (PR template): The PR template includes a
guardrail section that bug-fix PRs must complete:

```markdown
## Guardrail (required for bug fixes)
- [ ] Regression test added
- [ ] Invariant check or CI guard added
- [ ] Spec/index/dependency update if behavior changed
- [ ] CLAUDE.md rule update if process-related failure
```

At least one checkbox must be checked for bug-fix PRs.

**CI enforcement** (`scripts/ci-guardrail-check.ts`): Runs on every
PR. If the PR is classified as a bug fix:
1. Parse the PR description for the guardrail section.
2. Verify at least one checkbox is marked.
3. Optionally verify that the PR diff includes at least one test file
   change (`.test.ts`, `.spec.ts`).

Non-bug-fix PRs skip this check.

**Tracking**: A scheduled script (`scripts/guardrail-ratio.ts`) runs
weekly. Queries merged PRs via `gh pr list --state merged`. For each
bug-fix PR, checks whether it included a guardrail. Reports the ratio
and lists any gaps.

**Guardrail types** (recognized by the check):
- New or modified test files
- Changes to `scripts/ci-*.ts` (CI guard)
- Changes to `docs/specs/` (spec update)
- Changes to `CLAUDE.md` or `.github/` (process guard)

## Phases

### Phase 1 -- Template and CI enforcement

- Add guardrail section to PR template.
- Implement `scripts/ci-guardrail-check.ts`.
- Add as a CI step on every PR (advisory warning, not blocking).

### Phase 2 -- Tracking and enforcement

- Promote the guardrail check from advisory to required.
- Implement `scripts/guardrail-ratio.ts` for weekly tracking.
- Add guardrail ratio to the project health dashboard or weekly
  summary.

## Validation criteria

- A bug-fix PR without any guardrail checkbox gets a CI warning
  (Phase 1) or failure (Phase 2).
- A bug-fix PR with a regression test passes the guardrail check.
- The weekly ratio report correctly identifies bug-fix PRs and their
  guardrail status.
- Non-bug-fix PRs (feat, chore, refactor) are not affected by the
  check.

## Open decisions

1. Should the guardrail check be blocking from day one, or start as
   advisory for a ramp-up period?

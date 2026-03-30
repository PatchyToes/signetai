---
title: "CI Flaky Test Quarantine and Retry Policy"
id: ci-flaky-test-quarantine
status: planning
informed_by: []
section: "DevEx"
depends_on:
  - "ci-contract-invariants-lane"
success_criteria:
  - "Flaky tests are detected, tracked, and quarantined with threshold-based enforcement"
scope_boundary: "CI workflow changes, a quarantine manifest file, and a bun test wrapper script. No changes to the test runner itself."
draft_quality: "auto-generated, needs user validation before implementation"
---

# CI Flaky Test Quarantine and Retry Policy

## Problem

There is no mechanism to detect or manage flaky tests. A test that
intermittently fails on the same code blocks unrelated PRs, erodes
trust in CI, and causes developers to ignore or retry blindly.
Currently, the only option is manual investigation or disabling the
test entirely.

## Goals

1. Auto-detect flaky tests by identifying pass/fail variance on
   identical code.
2. Quarantine flaky tests so they do not block unrelated PRs.
3. Track quarantine count and alert when it exceeds a threshold.

## Non-goals

- Root-cause analysis of flakiness (that is manual follow-up work).
- Replacing bun's test runner with a custom framework.

## Proposed approach

**Retry on failure**: When a test file fails in CI, retry it once.
If it passes on retry, mark it as flaky (passed-on-retry). If it
fails both times, it is a real failure.

**Quarantine manifest** (`tests/quarantine.json`): A checked-in JSON
file listing test file paths that are known flaky. Format:
`{ "path": string, "since": ISO date, "reason": string }[]`.

**CI behavior**: Tests in the quarantine list run but their results
are reported as warnings, not failures. The quarantine job posts a
PR comment summarizing quarantined test results.

**Threshold enforcement**: A CI step counts quarantine entries. If
the count exceeds a configurable limit (default: 5), the CI lane
fails with a message requiring cleanup before new quarantines are
added.

**Detection flow**: A wrapper script (`scripts/ci-test-retry.ts`)
runs `bun test` for each affected package. On failure, retries the
failing files. Files that flip from fail to pass are candidates for
quarantine and flagged in CI output.

## Phases

### Phase 1 -- Retry and quarantine infrastructure

- Implement `scripts/ci-test-retry.ts` with single-retry logic.
- Create `tests/quarantine.json` schema and initial empty manifest.
- Update CI workflow to use the retry wrapper instead of raw `bun test`.
- Quarantined tests run but do not fail the build.

### Phase 2 -- Tracking and enforcement

- Add threshold check (fail CI if quarantine count > limit).
- Add weekly scheduled job that re-runs quarantined tests and
  auto-removes entries that pass 3 consecutive times.
- Post quarantine summary as PR comment via `gh pr comment`.

## Validation criteria

- A test that fails then passes on retry is flagged as flaky in CI
  output.
- A quarantined test failure does not block PR merge.
- Quarantine count exceeding 5 causes CI to fail with a clear message.
- Tests removed from quarantine resume blocking on failure.

## Open decisions

1. Should quarantine entries auto-expire after a time limit (e.g., 14
   days) even if not manually resolved?

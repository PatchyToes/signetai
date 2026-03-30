---
title: "Release Train Cadence"
id: release-train-cadence
status: planning
informed_by: []
section: "Release"
depends_on:
  - "memory-pipeline-v2"
success_criteria:
  - "Predictable release windows reduce merge pressure and batch risk"
scope_boundary: "GitHub Actions release workflows, changelog generation script, and version-sync updates. No changes to package source code."
draft_quality: "auto-generated, needs user validation before implementation"
---

# Release Train Cadence

## Problem

Releases happen ad-hoc whenever someone runs `bun run version:sync`
and publishes. This creates unpredictable release timing, no
changelog, and merge pressure (developers rush to land features
before an unscheduled release). Version bumps are manual and
error-prone across 15+ packages.

## Goals

1. Establish a predictable release cadence: weekly patches, biweekly
   minors.
2. Auto-generate changelogs from conventional commit messages.
3. Automate the version bump and npm publish workflow.

## Non-goals

- Canary or pre-release channels (covered by post-merge-canary-suite).
- Breaking change management (major versions are manual decisions).

## Proposed approach

**Release cadence**:
- **Patch train** (weekly, Tuesday): Includes all merged bug fixes
  and chores since last release. Auto-triggered by a scheduled GitHub
  Actions workflow.
- **Minor train** (biweekly, Tuesday of even weeks): Includes all
  merged `feat:` commits. Requires manual approval gate in the
  workflow before publish.

**Changelog generation** (`scripts/changelog.ts`): Parse
`git log --format` since the last tag. Group commits by conventional
commit type (feat, fix, chore, refactor, perf). Output markdown
grouped by category. Exclude `chore(release):` commits.

**Release workflow** (`.github/workflows/release.yml`):
1. Run `bun run build` and `bun test` on main.
2. Determine version bump type from commit history (patch if only
   fix/chore, minor if any feat).
3. Run `bun run version:sync` with the computed version.
4. Generate changelog and prepend to CHANGELOG.md.
5. Commit version bump and changelog.
6. Create git tag and GitHub release with changelog body.
7. Run `bun run build:publish` and `npm publish` for public packages.

**Manual override**: Any release can be triggered manually via
`workflow_dispatch` with an explicit version input, bypassing the
schedule.

**Version sync**: The existing `bun run version:sync` script ensures
all workspace packages share the same version. The release workflow
calls it rather than bumping packages individually.

## Phases

### Phase 1 -- Changelog and manual release workflow

- Implement `scripts/changelog.ts` from conventional commits.
- Create release workflow with manual trigger and approval gate.
- Add CHANGELOG.md to the repository root.

### Phase 2 -- Scheduled trains

- Add cron triggers for weekly patch and biweekly minor trains.
- Add Slack/Discord notification on successful publish.
- Add release-failed alert if the workflow errors.

## Validation criteria

- `scripts/changelog.ts` groups commits correctly by type.
- Manual workflow trigger produces a tagged release with changelog.
- Weekly cron produces a patch release if fix commits exist since
  last tag.
- No release is created if there are no new commits since last tag.

## Open decisions

1. Should the minor train require a manual approval step, or should
   it auto-publish like patches?
2. Should changelog entries link to PR numbers or just commit hashes?

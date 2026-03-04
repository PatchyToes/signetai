---
name: openclaw-migration
description: "Systematic migration from OpenClaw's native memory/config to Signet. Maps directories, compares files 1-by-1, implements, tests, self-heals, and reports — with human review at the end."
user_invocable: true
arg_hint: "[check|migrate|audit]"
builtin: true
---

# /openclaw-migration

Migrate an OpenClaw installation to use Signet as the primary identity
and memory layer. This skill walks through a structured, self-healing
process that compares OpenClaw and Signet file-by-file, migrates each
one, tests the result, and consolidates a report for human review.

## Philosophy

OpenClaw has its own memory system, rules files, and configuration.
Signet replaces the memory layer and identity files with a portable,
platform-agnostic system. The goal is NOT to delete OpenClaw — it's
to redirect deeper context and persistent memory to Signet so you
aren't duplicating state across two systems and bloating your context
window with redundant tokens.

After migration:
- **OpenClaw** handles the harness (tool routing, session management,
  MCP servers, extensions)
- **Signet** handles identity (who you are), memory (what you
  remember), and personality (how you communicate)

## When to Run

- User says `/openclaw-migration` or "migrate to signet"
- User says "set up signet with openclaw" or "switch from openclaw memory"
- After installing Signet on an existing OpenClaw setup
- When OpenClaw's native memory and Signet are both active (causing
  duplication or context bloat)

## Prerequisites

Before starting, verify:

```bash
# Signet is installed and running
signet status

# OpenClaw is installed
which openclaw 2>/dev/null || which claude 2>/dev/null

# Signet daemon is healthy
curl -s http://localhost:3850/health
```

If Signet isn't set up yet, run `/onboarding` first — it handles
initial Signet setup including the `--non-interactive` bootstrap.

---

## Phase 1: Directory Mapping

List both directory structures side by side so the user can see
exactly what maps to what.

### OpenClaw Directories

Scan for OpenClaw's configuration and memory files:

```bash
# Common OpenClaw locations
ls -la ~/.openclaw/ 2>/dev/null
ls -la ~/.claude/ 2>/dev/null
ls -la .openclaw/ 2>/dev/null

# OpenClaw memory files
find ~/.openclaw -name "*.md" -o -name "*.yaml" -o -name "*.json" 2>/dev/null
find ~/.claude -name "*.md" -o -name "*.yaml" -o -name "*.json" 2>/dev/null

# Project-level OpenClaw files
find . -maxdepth 2 -name "CLAUDE.md" -o -name "rules.md" -o -name ".openclaw*" 2>/dev/null
```

### Signet Directories

```bash
ls -la ~/.agents/
ls -la ~/.agents/memory/
ls -la ~/.agents/skills/
```

### Mapping Table

Present a clear mapping to the user:

```
DIRECTORY COMPARISON
====================

OpenClaw                          Signet                      Status
--------                          ------                      ------
~/.openclaw/rules.md         →    ~/.agents/AGENTS.md         [pending]
~/.openclaw/memory.md        →    ~/.agents/MEMORY.md         [pending]
~/.openclaw/personality.md   →    ~/.agents/SOUL.md           [pending]
~/.openclaw/user.md          →    ~/.agents/USER.md           [pending]
~/.openclaw/identity/        →    ~/.agents/IDENTITY.md       [pending]
~/.openclaw/tools.md         →    ~/.agents/TOOLS.md          [pending]
~/.claude/CLAUDE.md          →    ~/.agents/AGENTS.md         [pending]
project/CLAUDE.md            →    (keep as project-level)     [skip]
```

Adapt this table based on what actually exists. Not all OpenClaw
installs have the same structure — some use `~/.claude/`, some use
`~/.openclaw/`, some have project-level files only.

**Ask the user to confirm the mapping before proceeding.**

---

## Phase 2: File-by-File Migration

Process each mapped file one at a time. For each file:

### 2a. Read & Compare

```
FILE: rules.md → AGENTS.md
=============================

OPENCLAW CONTENT:
[show relevant sections of the OpenClaw file]

SIGNET CURRENT:
[show current Signet file, or "empty/template"]

OVERLAP:
[identify content that exists in both]

UNIQUE TO OPENCLAW:
[content only in OpenClaw that needs migration]

UNIQUE TO SIGNET:
[content only in Signet that should be preserved]
```

### 2b. Implement Migration

Merge the content following these rules:

1. **Signet structure wins** — Use Signet's file format and section
   organization. Don't port OpenClaw's structure verbatim.
2. **Unique content migrates** — Anything meaningful in OpenClaw that
   isn't in Signet gets added to the correct Signet file.
3. **Duplicates are removed** — If the same info exists in both,
   keep the Signet version (it's likely more current if the user
   has been using Signet at all).
4. **Cross-contamination is fixed** — If OpenClaw's rules.md has
   personality info, it goes to SOUL.md, not AGENTS.md. If memory
   items are in rules.md, they go to the database via
   `signet remember`, not into a flat file.
5. **The Signet block in AGENTS.md is preserved** — This block
   (between `<!-- SIGNET:START -->` and `<!-- SIGNET:END -->`) is
   required for harnesses that don't support MCP. Never remove it.

Write the merged file:

```bash
# Write the merged content
write ~/.agents/AGENTS.md "<merged content>"
```

### 2c. Test

After each file migration, run a verification:

```bash
# Verify the file was written correctly
read ~/.agents/AGENTS.md

# Check for obvious issues
# - File is not empty
# - Signet block is intact
# - No duplicate sections
# - Content is in the right file (not cross-contaminated)
```

### 2d. Self-Heal

If the test reveals issues:

1. **Identify the problem** — What exactly is wrong?
2. **Diagnose the cause** — Why did it happen? (merge conflict,
   wrong file, formatting issue)
3. **Fix it** — Apply the correction
4. **Re-test** — Verify the fix worked

```
SELF-HEAL REPORT:
- Issue: Personality content ended up in AGENTS.md
- Cause: OpenClaw's rules.md mixed operational and personality rules
- Fix: Moved personality section to SOUL.md
- Re-test: ✓ AGENTS.md clean, SOUL.md updated
```

### 2e. Verify Again

After self-heal, do one more pass:

```bash
# Final verification of this file
read ~/.agents/AGENTS.md
# Confirm structure, no duplicates, correct content placement
```

Log the result and move to the next file.

---

## Phase 3: Memory Migration

OpenClaw's memory system stores context differently than Signet.
This phase migrates persistent memories.

### Identify OpenClaw Memories

```bash
# Find OpenClaw memory files
find ~/.openclaw -name "*memory*" -o -name "*context*" 2>/dev/null
find ~/.claude -name "*memory*" 2>/dev/null

# Check for inline memories in rules files
grep -n "remember\|context\|note:" ~/.openclaw/rules.md 2>/dev/null
```

### Migrate to Signet Database

For each meaningful memory item found:

```bash
# Store in Signet's database (auto-embeds, auto-categorizes)
signet remember "User prefers dark mode" -w openclaw-migration
signet remember "Project X uses React + TypeScript" -w openclaw-migration

# For critical/permanent memories
signet remember --critical "Never delete production database" -w openclaw-migration
```

Tag all migrated memories with `-t openclaw-migration` so they can
be identified later if needed.

### Disable OpenClaw Native Memory

This is critical — having both systems active causes duplication
and context bloat.

```bash
# Check if OpenClaw memory is still active
# (location varies by OpenClaw version)
cat ~/.openclaw/config.yaml 2>/dev/null | grep -i memory
```

Signet setup should have disabled this automatically, but verify.
If it's still active, disable it:

- In OpenClaw's config, set memory to disabled/external
- Or rename/move the OpenClaw memory files so they're not loaded

**Always confirm with the user before disabling anything.**

---

## Phase 4: Consolidated Report (HITL Review)

After all files are processed, generate a full report for human
review. This is the Human-In-The-Loop checkpoint — nothing is
"done" until the user signs off.

```
MIGRATION REPORT
================

Date: [timestamp]
OpenClaw version: [version]
Signet version: [version]

FILES MIGRATED
--------------

1. rules.md → AGENTS.md
   - Status: ✓ Complete
   - Content moved: [summary]
   - Self-heals: [0 or description]

2. personality.md → SOUL.md
   - Status: ✓ Complete
   - Content moved: [summary]
   - Self-heals: [0 or description]

3. memory.md → Signet database
   - Status: ✓ Complete
   - Memories imported: [count]
   - Duplicates skipped: [count]

4. user.md → USER.md
   - Status: ✓ Complete
   - Content moved: [summary]

5. [etc.]

MEMORY MIGRATION
----------------
- Total memories found in OpenClaw: [count]
- Migrated to Signet database: [count]
- Skipped (duplicates): [count]
- Skipped (stale/irrelevant): [count]
- OpenClaw native memory: [disabled/still active]

SELF-HEAL LOG
-------------
[list every self-heal that occurred during migration]

POTENTIAL ISSUES
----------------
[anything that needs human judgment]

RECOMMENDATIONS
---------------
- [post-migration suggestions]
- Run /onboarding audit (Step 6) in a week to verify stability
- Monitor for any missing context in conversations
- If something feels off, check: signet recall "topic"

NEXT STEPS
----------
1. Review the files above and confirm they look right
2. Run a test conversation to verify behavior
3. If satisfied, you can archive/delete the old OpenClaw memory files
```

**Wait for the user to review and confirm before considering the
migration complete.**

---

## Subcommands

### `/openclaw-migration check`

Quick check — just show the directory mapping and identify what
needs migration without changing anything. Good for scoping the work.

### `/openclaw-migration migrate`

Full migration flow (all 4 phases). This is the default if no
subcommand is given.

### `/openclaw-migration audit`

Post-migration audit — re-run the comparison to verify everything
migrated correctly and no content was lost. Run this a few days
after migration to catch anything that slipped through.

---

## Important Notes

### Don't Break OpenClaw

This migration redirects memory and identity to Signet. It does NOT
uninstall, break, or fundamentally alter OpenClaw. OpenClaw continues
to function as the harness — it just stops being the memory system.

### Project-Level Files Stay

`CLAUDE.md` files in project directories are project-specific
instructions and should NOT be migrated to Signet. They stay where
they are. Signet handles global identity; project files handle
project context.

### Rollback

If something goes wrong, the original OpenClaw files are not
deleted during migration (only read). The user can always revert by:

1. Re-enabling OpenClaw's native memory
2. Restoring any files from their original locations
3. The Signet content can be cleared with `signet` CLI

### Context Bloat Prevention

The whole point of this migration is to reduce context bloat. After
migration, verify:

- OpenClaw is not loading its own memory files into context
- Signet's MEMORY.md is the only memory summary in context
- No duplicate identity files are being loaded
- Total context overhead is reduced, not increased

```bash
# Quick token check — see what's being loaded
wc -c ~/.agents/*.md
wc -c ~/.openclaw/*.md 2>/dev/null
wc -c ~/.claude/CLAUDE.md 2>/dev/null
```

---

## Credit

Migration flow designed by Mike (Advertising Report Card) from the
OpenClaw community. The systematic compare → implement → test →
self-heal → verify → report approach ensures nothing falls through
the cracks and gives humans final say on every change.

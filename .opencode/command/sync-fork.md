---
category: git
description: Analyze upstream-only commits and generate prioritized sync recommendations.
argument-hint: "[--filter all|fix|perf|security|feat] [--since <date>] [--limit <n>] [--output json|markdown] [--scaffold] [--reset-state] [--dry-run]"
---

# Sync Fork

## Overview

Compare your fork against `upstream/<branch>` and generate AI-analyzed recommendations for syncing upstream changes. Uses state tracking to remember previously reviewed commits.

**Workflow**:
1. Discovery: Fetch upstream, find new commits since last review
2. Analysis: Classify commits by type, priority (P0-P3), and risk level
3. Recommendations: Group by scope/PR, generate Linear-ready issue descriptions
4. Execution: Cherry-pick, push, create PR (or generate scaffold script)

## User Input

```text
$ARGUMENTS
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--filter TYPE` | Filter by: all, fix, perf, security, feat | all |
| `--since DATE` | Only commits since date (ISO-8601) | - |
| `--limit N` | Max commits to analyze | 50 |
| `--output FORMAT` | Output: json, markdown | markdown |
| `--scaffold` | Generate script without executing | false |
| `--reset-state` | Clear state file, start fresh | false |
| `--dry-run` | Analyze only, no execution | false |

## Examples

```text
# Basic usage - shows new commits and recommendations
/sync-fork

# Filter by security commits only (auto-flagged as P0)
/sync-fork --filter security

# Analyze commits from last month
/sync-fork --since 2025-12-01 --limit 100

# Get JSON output for programmatic use
/sync-fork --output json

# Generate cherry-pick script without executing
/sync-fork --scaffold

# Reset state and re-analyze all commits
/sync-fork --reset-state

# Dry run - analyze without modifying state
/sync-fork --dry-run
```

## Priority Levels

| Priority | Description | Action |
|----------|-------------|--------|
| P0 | CRITICAL - Security fixes, CVEs | Sync immediately |
| P1 | HIGH - Bug fixes affecting core functionality | Sync soon |
| P2 | MEDIUM - Performance improvements, features | Queue for batch |
| P3 | LOW - Docs, tests, chores | Nice to have |

## State Tracking

State is saved to `.opencode/state/sync-fork.json`:
- Tracks which commits have been reviewed, synced, or skipped
- Running `/sync-fork` again shows only NEW commits
- Use `--reset-state` to start fresh

## Requirements

- Git CLI installed
- `gh` CLI installed (for PR creation)
- Upstream remote configured: `git remote add upstream <URL>`

## Current Limitations

**AI Analysis (Phase 2)**: The tool currently uses heuristic-based priority classification based on commit type, file patterns, and security keywords. Full AI-driven analysis using background agents is scaffolded but not yet integrated. See `analysis.ts` for the prepared AI prompt templates.

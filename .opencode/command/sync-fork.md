---
category: git
description: Analyze upstream-only commits and generate prioritized sync recommendations.
argument-hint: "[--filter all|fix|perf|security|feat] [--since <date>] [--limit <n>] [--output json|markdown] [--scaffold]"
---

# Sync Fork

## Overview

Compare your fork against `upstream/<branch>` and generate:
- agent-consumable JSON recommendations (default)
- optional human-readable markdown report

## User Input

```text
$ARGUMENTS
```

## Examples

```text
/sync-fork
/sync-fork --filter security
/sync-fork --since 2025-12-01 --limit 50
/sync-fork --output markdown
/sync-fork --scaffold
```

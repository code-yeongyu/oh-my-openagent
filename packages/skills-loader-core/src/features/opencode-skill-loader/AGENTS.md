# src/features/opencode-skill-loader/ — Multi-Source Skill Discovery

**Generated:** 2026-08-24 (f3642fcda)

## OVERVIEW

55 files (~6.2k LOC). Discovers, parses, merges, and resolves SKILL.md files
from 7 `discover*` sources (5 scope families) with priority deduplication by
name. Maintains both sync and async loader implementations (async uses
bounded concurrency and lazy content loading).

## DISCOVERY SOURCES

`discoverSkills()` / `discoverAllSkills()` combine:

1. OpenCode project (`.opencode/skills/` — scope `opencode-project`)
2. Claude project + Agents project dirs (scope `project`)
3. OpenCode config/global (scope `opencode`)
4. Claude user + Agents global dirs (scope `user`)
5. Shared skills root (scope `shared`)

## MERGE PRIORITY (highest → lowest)

`merger/scope-priority.ts` — higher number wins on same name:

```
opencode-project (6) > project (5) > opencode (4) > user (3) > config (2) > builtin = shared (1)
```

Same-named skill at higher priority replaces the lower; disabled names never load.

## KEY FILES

| File | Purpose |
|------|---------|
| `loader.ts` | `discoverSkills()` / `discoverAllSkills()` / scope-specific `discover*` — orchestrates discovery → parse → merge |
| `async-loader.ts` | Async traversal, bounded concurrency, lazy content loading |
| `merger.ts` + `merger/scope-priority.ts` | Priority-based deduplication across sources |
| `skill-content.ts` | YAML frontmatter parsing from SKILL.md |
| `skill-discovery.ts` | Find SKILL.md files in directory trees |
| `skill-directory-loader.ts` | Load all skills from a single directory |
| `config-source-discovery.ts` | Discover scope directories from config |
| `skill-template-resolver.ts` | Variable substitution in skill templates (incl. disabled watermark options) |
| `skill-mcp-config.ts` | Extract MCP configs from skill YAML |
| `git-master-template-injection.ts` | Git-master prompt template injection |
| `skill-deduplication.ts` | Name-dedup rules across sources |
| `types.ts` | `LoadedSkill`, `SkillScope`, `SkillDiscoveryResult` |

## SKILL FORMAT (SKILL.md)

```markdown
---
name: my-skill
description: What this skill does
tools: [Bash, Read, Write]
mcp:
  - name: my-mcp
    type: stdio
    command: npx
    args: [-y, my-mcp-server]
---

Skill content (instructions for the agent)...
```

## MERGER SUBDIRECTORY

Handles complex merge logic when skills from multiple scopes have overlapping names or MCP configs.

## TEMPLATE RESOLUTION

Variables like `{{directory}}`, `{{agent}}` in skill content get resolved at load time based on current context.

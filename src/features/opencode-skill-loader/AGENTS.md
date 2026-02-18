# src/features/opencode-skill-loader/ — 4-Scope Skill Discovery

**Generated:** 2026-02-18

## OVERVIEW

28 files (~3.2k LOC). Discovers, parses, merges, and resolves SKILL.md files from 4 scopes with priority deduplication.

## 4-SCOPE PRIORITY (highest → lowest)

```
1. Project (.opencode/skills/)
2. OpenCode config (~/.config/opencode/skills/)
3. User (~/.config/opencode/oh-my-opencode/skills/)
4. Global (built-in skills)
```

Same-named skill at higher scope overrides lower.

## KEY FILES

| File | Purpose |
|------|---------|
| `loader.ts` | Main `loadSkills()` — orchestrates discovery → parse → merge |
| `async-loader.ts` | Async variant for non-blocking skill loading |
| `blocking.ts` | Sync variant for initial load |
| `merger.ts` | Priority-based deduplication across scopes |
| `skill-content.ts` | YAML frontmatter parsing from SKILL.md |
| `skill-discovery.ts` | Find SKILL.md files in directory trees |
| `skill-directory-loader.ts` | Load all skills from a single directory |
| `config-source-discovery.ts` | Discover scope directories from config |
| `skill-template-resolver.ts` | Variable substitution in skill templates |
| `skill-mcp-config.ts` | Extract MCP configs from skill YAML |
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

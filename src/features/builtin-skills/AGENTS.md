# src/features/builtin-skills/ — 10 Built-in Skill Files

**Generated:** 2026-05-08

## OVERVIEW

Skills shipped inside the plugin (always available, no install). Registered via `createBuiltinSkills()`. Each skill implements the `BuiltinSkill` interface with name, description, content, and optional MCP config. Loaded by `opencode-skill-loader` with priority: project > opencode > user > **builtin**. User-installed skills with the same name override built-ins.

## STRUCTURE

```
builtin-skills/
├── index.ts              # Barrel exports
├── skills.ts             # createBuiltinSkills() factory — registers all 10 below
├── types.ts              # BuiltinSkill interface
├── skills/
│   ├── git-master.ts                  # 1111 LOC
│   ├── git-master-skill-metadata.ts   # Companion to git-master
│   ├── playwright.ts                  # MCP variant + agent-browser
│   ├── playwright-cli.ts              # CLI variant
│   ├── dev-browser.ts                 # Persistent page state
│   ├── frontend-ui-ux.ts              # Design-first UI guidance
│   ├── review-work.ts                 # 5-agent post-implementation review
│   ├── ai-slop-remover.ts             # Remove AI-generated code patterns
│   ├── team-mode.ts                   # 12 team_* tool documentation (gated)
│   ├── git-master-sections/           # Git-master prompt sub-sections
│   └── index.ts                       # skill barrel
├── git-master/                        # Resources for git-master skill
├── frontend-ui-ux/                    # Resources for frontend-ui-ux skill
├── agent-browser/                     # Resources for agent-browser variant
└── dev-browser/                       # Resources for dev-browser
```

## SKILL CATALOG

| Skill | Approx LOC | MCP | Notes |
|-------|------------|-----|-------|
| `git-master` | 1111 | — | Atomic commits, rebase, history search; included by default for delegate-task `git` category |
| `playwright` | 312 | `@playwright/mcp` | Browser automation via MCP |
| `playwright-cli` | 268 | — | Browser automation via shell CLI (no MCP) |
| `agent-browser` | (in playwright.ts) | — | Browser via `agent-browser:*` Bash commands |
| `dev-browser` | 221 | — | Persistent page state browser for dev work |
| `frontend-ui-ux` | 79 | — | Design-first UI development guidance |
| `review-work` | ~500 | — | Post-implementation review orchestrator (5 parallel agents) |
| `ai-slop-remover` | ~300 | — | Remove AI-generated code smells |
| `team-mode` | — | — | **Conditional** — only loaded when `team_mode.enabled`; documents the 12 `team_*` tools and lifecycle |

## BROWSER VARIANT SELECTION

Config `browser_automation_engine` selects which browser skill loads:

| Value | Skill Loaded |
|-------|-------------|
| `"playwright"` (default) | playwright (MCP-backed) |
| `"playwright-cli"` | playwright-cli (CLI-backed) |
| `"agent-browser"` | agent-browser (in playwright.ts) |

Only one browser skill is active per session — non-selected variants are skipped.

## TEAM-MODE SKILL GATING

The `team-mode` skill is registered unconditionally but only **rendered** when `team_mode.enabled: true`:

```typescript
// skills/team-mode.ts (paraphrase)
const teamModeSkill: BuiltinSkill = {
  name: "team-mode",
  shouldLoad: (config) => config.team_mode?.enabled === true,
  // ...
}
```

When disabled, the skill is filtered out before agent prompt assembly so agents do not see `team_*` tool docs they cannot use.

## ADDING A NEW BUILT-IN SKILL

1. Create `skills/{name}.ts` exporting a `BuiltinSkill` object
2. Register in `skills.ts` `createBuiltinSkills()` factory
3. Add resources (if any) under a sibling directory: `{name}/SKILL.md`, prompt sections, etc.
4. If the skill is conditional, set `shouldLoad: (config) => …`
5. Optionally declare an MCP server in the skill (loaded by `skill-mcp-manager` per session)

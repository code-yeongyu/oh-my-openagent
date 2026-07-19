# src/features/builtin-skills/ — 12 Built-in Skill Files

**Generated:** 2026-05-15

## OVERVIEW

Skills shipped inside the plugin (always available, no install). Registered via `createBuiltinSkills()`. Each skill implements the `BuiltinSkill` interface with name, description, content, and optional MCP config. Loaded by `opencode-skill-loader` with priority: project > opencode > user > **builtin**. User-installed skills with the same name override built-ins.

## STRUCTURE

```
builtin-skills/
├── index.ts              # Barrel exports
├── skills.ts             # createBuiltinSkills() factory — registers all 12 below
├── types.ts              # BuiltinSkill interface
├── skills/
│   ├── git-master.ts                  # 1111 LOC
│   ├── git-master-skill-metadata.ts   # Companion to git-master
│   ├── playwright.ts                  # MCP variant + agent-browser
│   ├── playwright-cli.ts              # CLI variant
│   ├── dev-browser.ts                 # Persistent page state
│   ├── frontend.ts              # Design-first UI guidance
│   ├── review-work.ts                 # 5-agent post-implementation review
│   ├── remove-ai-slops.ts             # Shared skill loader for remove-ai-slops
│   ├── init-deep.ts                   # Shared skill loader for init-deep
│   ├── team-mode.ts                   # 12 team_* tool documentation (gated)
│   ├── security-research.ts           # Team Mode exploitability-driven security research
│   ├── security-review.ts             # Alias for security-research
│   ├── git-master-sections/           # Git-master prompt sub-sections
│   └── index.ts                       # skill barrel
├── git-master/                        # Resources for git-master skill
├── frontend/                    # Byte-equal compatibility artifact; canonical source is shared-skills
├── agent-browser/                     # Resources for agent-browser variant
├── dev-browser/                       # Resources for dev-browser
└── security-research/                 # Resources for security-research
```

## SKILL CATALOG

| Skill | Approx LOC | MCP | Notes |
|-------|------------|-----|-------|
| `git-master` | 1111 | — | Atomic commits, rebase, history search; included by default for delegate-task `git` category |
| `playwright` | 312 | `@playwright/mcp` | Browser automation via MCP |
| `playwright-cli` | 268 | — | Browser automation via shell CLI (no MCP) |
| `agent-browser` | (in playwright.ts) | — | Browser via `agent-browser:*` Bash commands |
| `dev-browser` | 221 | — | Persistent page state browser for dev work |
| `frontend` | shared source | none | Loads canonical OMO frontend content; checked-in artifact stays byte-equal |
| `review-work` | ~500 | — | Post-implementation review orchestrator (5 parallel agents) |
| `$omo:remove-ai-slops` | — | — | Remove AI-generated code smells |
| `init-deep` | — | — | Hierarchical AGENTS.md generation |
| `security-research` | SKILL.md | — | Team Mode exploitability-driven security research |
| `security-review` | wrapper | — | Alias for `security-research` |
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
3. Put cross-runtime instruction content under `packages/shared-skills/skills/{name}`; keep a sibling artifact here only when a compatibility contract requires it.
4. If the skill is conditional, set `shouldLoad: (config) => …`
5. Optionally declare an MCP server in the skill (loaded by `skill-mcp-manager` per session)

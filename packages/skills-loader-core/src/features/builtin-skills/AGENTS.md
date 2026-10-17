# src/features/builtin-skills/ — Built-in Skill Catalog

**Generated:** 2026-08-24 (f3642fcda; prior 2026-07-17 7d664b96b)

## OVERVIEW

Skills shipped inside the plugin (always available, no install). Registered via `createBuiltinSkills()`. Each skill implements the `BuiltinSkill` interface with name, description, content, and optional MCP config. Loaded by `opencode-skill-loader` with scope priority `opencode-project > project > opencode > user > config > builtin = shared` (`merger/scope-priority.ts`). User-installed skills with the same name override built-ins.

## STRUCTURE

Selected modules and resources:

```
builtin-skills/
├── index.ts              # Barrel exports
├── skills.ts             # createBuiltinSkills() factory + resolveActiveBuiltinSkills()
├── types.ts              # BuiltinSkill interface
├── skills/
│   ├── git-master.ts                  # Wraps git-master/ SKILL.md + section constants
│   ├── git-master-sections/           # Prompt sub-sections (history-search, rebase, atomic-planning…)
│   ├── git-master-skill-metadata.ts   # Companion to git-master
│   ├── playwright.ts                  # Facade over browser provider variants
│   ├── playwright-mcp-skill.ts        # createPlaywrightSkill() factory (mcp_args)
│   ├── playwright-cli.ts              # CLI variant
│   ├── dev-browser.ts                 # Persistent page state
│   ├── debugging.ts                   # Debugging methodology
│   ├── visual-qa.ts                   # Visual QA
│   ├── frontend.ts              # Design-first UI guidance
│   ├── review-work.ts                 # Gate-review post-implementation review (manual QA + one reviewer)
│   ├── remove-ai-slops.ts             # Shared skill loader for remove-ai-slops
│   ├── init-deep.ts                   # Shared skill loader for init-deep
│   ├── team-mode.ts                   # 12 team_* tool documentation (gated)
│   ├── security-research.ts           # Team Mode exploitability-driven security research
│   ├── security-review.ts             # Reuses security-research
│   └── index.ts                       # skill barrel
├── git-master/                        # Resources for git-master skill
├── frontend/                    # Resources for frontend skill
├── dev-browser/                       # Resources for dev-browser
└── security-research/                 # Resources for security-research
```

## SKILL CATALOG

Selected skills; the provider registry is defined in `skills.ts`.

| Skill | MCP | Notes |
|-------|-----|-------|
| `git-master` | — | 1107-LOC SKILL.md; atomic commits, rebase, history search; included by default for delegate-task `git` category |
| `playwright` | `@playwright/mcp` | Browser automation via MCP |
| `playwright-cli` | — | Browser automation via shell CLI (no MCP) |
| `dev-browser` | — | Persistent page state browser for dev work |
| `frontend` | — | Design-first UI development guidance |
| `review-work` | — | Post-implementation gate review (orchestrator manual QA + one gate reviewer) |
| `debugging` | — | Debugging methodology |
| `visual-qa` | — | Visual QA |
| `$omo:remove-ai-slops` | — | Remove AI-generated code smells |
| `init-deep` | — | Hierarchical AGENTS.md generation |
| `security-research` | — | Team Mode exploitability-driven security research |
| `security-review` | — | Reuses security-research |
| `team-mode` | — | **Conditional** — only rendered when `team_mode.enabled`; documents the 12 `team_*` tools and lifecycle |

## BROWSER VARIANT SELECTION

Config `browser_automation_engine` selects which browser skill loads. Selected values:

| Value | Skill Loaded |
|-------|-------------|
| `"playwright"` (default) | playwright (MCP-backed) |
| `"playwright-cli"` | playwright-cli (CLI-backed) |

Only one browser skill is active per session; non-selected variants are skipped.
`resolveActiveBuiltinSkills({ systemMcpNames })` additionally filters out builtin
skills whose declared MCP names collide with system MCP names.

For the `playwright` (MCP) variant, `browser_automation_engine.playwright_mcp_args` (string array) appends extra CLI flags after the default `npx @playwright/mcp@latest` invocation, e.g. `--executable-path` or `--no-sandbox` for sandboxed envs lacking a system Chrome. Threaded via `createBuiltinSkills({ playwrightMcpArgs })` into `createPlaywrightSkill({ mcp_args })` (`skills/playwright-mcp-skill.ts`); absent or empty leaves the default singleton byte-identical.

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

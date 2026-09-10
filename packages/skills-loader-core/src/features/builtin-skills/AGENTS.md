# src/features/builtin-skills/ — Built-in Skill Catalog

**Generated:** 2026-09-10 (bee8c2ba4; prior 2026-07-17 7d664b96b)

## OVERVIEW

Skills shipped inside the plugin (always available, no install). Registered via `createBuiltinSkills()`. Each skill implements the `BuiltinSkill` interface (`types.ts`): `name`, `description`, `template` (the rendered prompt body), plus optional `resolvedPath`, `license`, `compatibility`, `metadata`, `allowedTools`, `agent`, `model`, `subtask`, `argumentHint`, and `mcpConfig`. Loaded by `opencode-skill-loader` with scope priority `opencode-project > project > opencode > user > config > builtin = shared` (`merger/scope-priority.ts`). User-installed skills with the same name override built-ins.

## STRUCTURE

```
builtin-skills/
├── index.ts              # Barrel exports
├── skills.ts             # createBuiltinSkills() factory + resolveActiveBuiltinSkills()
├── types.ts              # BuiltinSkill interface
├── skills/
│   ├── git-master.ts                  # Wraps git-master/ SKILL.md + section constants
│   ├── git-master-sections/           # Prompt sub-sections (history-search, rebase, atomic-planning…)
│   ├── git-master-skill-metadata.ts   # Companion to git-master
│   ├── playwright.ts                  # Facade over MCP + agent-browser variants
│   ├── playwright-mcp-skill.ts        # createPlaywrightSkill() factory (mcp_args)
│   ├── playwright-cli.ts              # CLI variant
│   ├── dev-browser.ts                 # Persistent page state
│   ├── agent-browser-skill.ts         # agent-browser variant (`agent-browser:*` Bash)
│   ├── agent-browser-template.ts      # Shared template/factory for agent-browser
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
├── agent-browser/                     # Resources for agent-browser variant
├── dev-browser/                       # Resources for dev-browser
└── security-research/                 # Resources for security-research
```

## SKILL CATALOG

| Skill | MCP | Notes |
|-------|-----|-------|
| `git-master` | — | 1107-LOC SKILL.md; atomic commits, rebase, history search; included by default for delegate-task `git` category |
| `playwright` | `@playwright/mcp` | Browser automation via MCP |
| `playwright-cli` | — | Browser automation via shell CLI (no MCP) |
| `agent-browser` | — | Browser via `agent-browser:*` Bash commands (own module now) |
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

Config `browser_automation_engine` selects which browser skill loads:

| Value | Skill Loaded |
|-------|-------------|
| `"playwright"` (default) | playwright (MCP-backed) |
| `"playwright-cli"` | playwright-cli (CLI-backed) |
| `"agent-browser"` | agent-browser (`agent-browser-skill.ts`) |
| `"dev-browser"` | dev-browser (`dev-browser.ts`) |

Only one browser skill is active per session; non-selected variants are skipped.
`resolveActiveBuiltinSkills({ systemMcpNames })` additionally filters out builtin
skills whose declared MCP names collide with system MCP names.

For the `playwright` (MCP) variant, `browser_automation_engine.playwright_mcp_args` (string array) appends extra CLI flags after the default `npx @playwright/mcp@latest` invocation, e.g. `--executable-path` or `--no-sandbox` for sandboxed envs lacking a system Chrome. Threaded via `createBuiltinSkills({ playwrightMcpArgs })` into `createPlaywrightSkill({ mcp_args })` (`skills/playwright-mcp-skill.ts`); absent or empty leaves the default singleton byte-identical.

## TEAM-MODE SKILL GATING

Gating lives in the factory, not on the skill object: `createBuiltinSkills({ teamModeEnabled })` appends `teamModeSkill` only when `teamModeEnabled` is true and `"team-mode"` is not in `disabledSkills`. The `BuiltinSkill` interface has no `shouldLoad` field. When disabled, the skill never enters the returned array, so agents do not see `team_*` tool docs they cannot use.

## ADDING A NEW BUILT-IN SKILL

1. Create `skills/{name}.ts` exporting a `BuiltinSkill` object
2. Register in `skills.ts` `createBuiltinSkills()` factory
3. Add resources (if any) under a sibling directory: `{name}/SKILL.md`, prompt sections, etc.
4. If the skill is conditional, gate it inside `createBuiltinSkills()` from an explicit option (as `teamModeEnabled` does) — conditions are factory logic, not skill fields
5. Optionally declare an MCP server in the skill (loaded by `skill-mcp-manager` per session)

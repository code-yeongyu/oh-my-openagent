# src/features/builtin-skills/ -- 8 Built-in Skills

**Generated:** 2026-04-11

## OVERVIEW

24 files. 8 built-in skills registered via `createBuiltinSkills()`. Each skill implements `BuiltinSkill` interface with name, description, content, and optional MCP config.

## STRUCTURE

```
builtin-skills/
├── index.ts              # Barrel exports
├── skills.ts             # createBuiltinSkills() factory
├── types.ts              # BuiltinSkill interface
├── git-master/           # SKILL.md + resources
├── frontend-ui-ux/       # SKILL.md
├── agent-browser/        # SKILL.md
├── dev-browser/          # SKILL.md
└── skills/               # Skill implementations as .ts files
    ├── git-master-sections/  # Git master prompt sections
    ├── playwright.ts         # Playwright + agent-browser + playwright-cli + dev-browser
    ├── frontend-ui-ux.ts     # Frontend UI/UX skill
    ├── review-work.ts        # 5-agent parallel review orchestrator
    └── ai-slop-remover.ts    # AI code smell remover
```

## SKILL CATALOG

| Skill | LOC | MCP | Purpose |
|-------|-----|-----|---------|
| **git-master** | 1111 | -- | Atomic commits, rebase, history search |
| **playwright** | 312 | @playwright/mcp | Browser automation via MCP |
| **playwright-cli** | 268 | -- | Browser automation via CLI |
| **agent-browser** | (in playwright.ts) | -- | Browser via agent-browser tool |
| **dev-browser** | 221 | -- | Persistent page state browser |
| **frontend-ui-ux** | 79 | -- | Design-first UI development |
| **review-work** | ~500 | -- | 5-agent post-implementation review |
| **ai-slop-remover** | ~300 | -- | Remove AI code patterns |

## BROWSER VARIANT SELECTION

Config `browser_automation_engine` selects which browser skill loads:
- `"playwright"` (default) -> playwright with @playwright/mcp
- `"playwright-cli"` -> CLI-based playwright
- `"agent-browser"` -> agent-browser tool

## SKILL LOADING

Skills loaded by `opencode-skill-loader` with priority: project > opencode > user > builtin. User-installed skills with same name override built-ins.

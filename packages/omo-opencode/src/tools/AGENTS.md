# src/tools/ — 12–31 Native Tools Across 13 Tool Directories (+ shared utilities)

**Generated:** 2026-05-15

## OVERVIEW

Tools registered via [`createToolRegistry()`](../plugin/tool-registry.ts) in `src/plugin/`. Native tools are factory-based (`createXXXTool`) except `interactive_bash` (`ToolDefinition`). LSP tools are served by the Tier-1 built-in MCP `lsp`; structural search and rewrite is handled by the `ast-grep` skill.

## TOOL CATALOG

### Always On (12 native tools)

| Group | Tools |
|-------|-------|
| **Search** (2) | `grep`, `glob` |
| **Sessions** (4) | `session_list`, `session_read`, `session_search`, `session_info` |
| **Background tasks** (2) | `background_output`, `background_cancel` |
| **Delegation** (2) | `task` (delegate, full skill+category support), `call_omo_agent` (named agent only: explore, librarian) |
| **Skills/MCP** (2) | `skill` (load skill or invoke command), `skill_mcp` (call skill-embedded MCP tool/resource/prompt) |

> LSP tools are provided by the built-in `lsp` MCP (Tier-1 stdio), backed by `packages/lsp-tools-mcp/`. AST-aware code search and rewrite is available through the `ast-grep` skill using `sg`.

### Conditional (up to +19 native tools)

| Tool(s) | Gate | Source |
|---------|------|--------|
| `look_at` | not in `disabled_agents` for `multimodal-looker` | `look-at/` |
| `interactive_bash` | `isInteractiveBashEnabled(config)` (tmux config) | `interactive-bash/` |
| `task_create`, `task_get`, `task_list`, `task_update` | `experimental.task_system` | `task/` |
| `edit` (hashline-edit) | `hashline_edit: true` | `hashline-edit/` |
| 12 `team_*` tools | `team_mode.enabled: true` | `../features/team-mode/tools/` |

### 12 team_* Tools (when team_mode enabled)

| Tool | Purpose |
|------|---------|
| `team_create` | Spawn team + member sessions from a TeamSpec (named or inline) |
| `team_delete` | Tear down — removes mailbox, tasklist, worktrees, optional tmux layout |
| `team_shutdown_request` | Member or lead requests its own shutdown |
| `team_approve_shutdown` | Lead acks a pending shutdown |
| `team_reject_shutdown` | Lead rejects a shutdown with reason |
| `team_send_message` | Async message to specific member or `*` broadcast |
| `team_task_create` | Create task on shared list |
| `team_task_list` | List tasks (filter by status, owner) |
| `team_task_update` | Claim/complete/delete (atomic file lock) |
| `team_task_get` | Fetch single task |
| `team_status` | Full team run status (members, tasks, mailbox) |
| `team_list` | List declared + active teams |

## DELEGATION CATEGORIES (built-in 8)

`task` (delegate) selects model by category. Default category models live in provider-specific files under `src/tools/delegate-task/` and aggregate via `BUILTIN_CATEGORIES` in `builtin-categories.ts`. Authoritative fallback chains live in [`packages/model-core/src/category-model-requirements.ts`](../../../model-core/src/category-model-requirements.ts) `CATEGORY_MODEL_REQUIREMENTS`.

| Category | Default Model | Source File | Domain |
|----------|---------------|-------------|--------|
| `visual-engineering` | google/gemini-3.1-pro (variant: high) | google-categories.ts | Frontend, UI/UX |
| `ultrabrain` | openai/gpt-5.6-sol (variant: xhigh) | openai-categories.ts | Hard logic / heavy reasoning |
| `deep` | openai/gpt-5.6-terra (variant: xhigh) | openai-categories.ts | Autonomous multi-step problem-solving |
| `artistry` | google/gemini-3.1-pro (variant: high) | google-categories.ts | Creative / unconventional approaches |
| `quick` | openai/gpt-5.4-mini | openai-categories.ts | Trivial single-file changes |
| `unspecified-low` | openai/gpt-5.6-luna (variant: xhigh) | openai-categories.ts | Moderate effort fallback |
| `unspecified-high` | anthropic/claude-opus-4-7 (variant: max) | anthropic-categories.ts | High effort fallback |
| `writing` | kimi-for-coding/k2p5 (default) → gemini-3.6-flash (first fallback) | kimi-categories.ts | Documentation, prose |

User-defined categories declared in `categories: { ... }` config override and extend this set.

## TOOL DIR LAYOUT

```
tools/
├── background-task/      # background_output, background_cancel (LLM interface; engine in features/background-agent)
├── call-omo-agent/       # call_omo_agent (explore + librarian only)
├── delegate-task/        # task — full delegation with categories + skills
├── glob/                 # glob (60s timeout, 100 file limit)
├── grep/                 # grep (60s timeout, 10MB limit)
├── hashline-edit/        # edit — hash-anchored line edits with LINE#ID validation
├── interactive-bash/     # interactive_bash — tmux session control
├── look-at/              # look_at — image/PDF analysis
├── session-manager/      # 4 session_* tools
├── skill/                # skill — load skill or run command
├── skill-mcp/            # skill_mcp — call skill-embedded MCP servers
├── slashcommand/         # discoverCommandsSync — feeds skill tool with /-command list
├── task/                 # 4 task_* tools (Sisyphus task system)
└── index.ts              # barrel exports
```

## ADDING A NEW TOOL

1. Create `src/tools/{name}/index.ts` with factory `createXXXTool`
2. Add `types.ts` for parameter Zod schemas
3. Add `tools.ts` (or single index.ts) for implementation
4. Export factory from `src/tools/index.ts`
5. Register in `src/plugin/tool-registry.ts`:
   - Always-on: spread into `allTools` directly
   - Conditional: build a `Record<string, ToolDefinition>` and gate-spread
6. If the tool needs disabling, ensure it appears in `filterDisabledTools` allow-list (its name will be matched against `disabled_tools`)

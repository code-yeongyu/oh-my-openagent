# src/features/builtin-commands/ -- Built-in Slash Commands

**Generated:** 2026-05-18

## OVERVIEW

Registry of built-in commands shipped inside the plugin. Each command is a template literal with title, description, and instructions. Registered via `createBuiltinCommandDefinitions()` factory in `commands.ts`. Loaded by `claude-code-command-loader`.

## FILE CATALOG

| File | Purpose |
|------|---------|
| `commands.ts` | `createBuiltinCommandDefinitions()` factory + `loadBuiltinCommands()` filter |
| `index.ts` | Barrel exports |
| `types.ts` | `BuiltinCommandName` union type + `BuiltinCommandConfig` |
| `templates/` | One `.ts` file per command |

## TEMPLATES

| Command | Source File | Notes |
|---------|-------------|-------|
| `init-deep` | `templates/init-deep.ts` | Hierarchical AGENTS.md generator |
| `ralph-loop` | `templates/ralph-loop.ts` | Self-referential dev loop |
| `ulw-loop` | `templates/ralph-loop.ts` | Ultrawork loop variant |
| `cancel-ralph` | `templates/ralph-loop.ts` | Loop cancellation |
| `refactor` | `templates/refactor.ts` | LSP + AST-grep refactoring |
| `start-work` | `templates/start-work.ts` | Prometheus plan executor |
| `stop-continuation` | `templates/stop-continuation.ts` | Kill all continuations |
| `handoff` | `templates/handoff.ts` | Session context summary |
| `remove-ai-slops` | `templates/remove-ai-slops.ts` | AI code smell cleanup |
| `hyperplan` | `templates/hyperplan.ts` | Adversarial team-mode planning |

## STRUCTURE

Each template exports a string constant containing the command's system prompt. `commands.ts` wraps it in `<command-instruction>` XML and injects `$ARGUMENTS`, `$SESSION_ID`, and `$TIMESTAMP` where needed. Some commands append a team-mode addendum when `teamModeEnabled` is true.

## LOADING

Phase 6 of config loading (`command-config-handler.ts`) merges built-ins with user-installed commands from `.opencode/commands/` and Claude Code plugins. `disabled_commands` in config filters out specific built-ins by name. The `autoSlashCommand` hook in `src/hooks/` executes these on user input.

## TESTS

Co-located `.test.ts` files in `templates/` cover `ralph-loop` and `stop-continuation` logic.

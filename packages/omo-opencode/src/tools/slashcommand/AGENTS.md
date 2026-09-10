# src/tools/slashcommand/ -- Command Discovery for the skill Tool

**Generated:** 2026-09-10

**Score:** 10 (10 files, ~0.9k LOC, module boundary; distinct domain: multi-scope command discovery, no tool of its own)

## OVERVIEW

Not a registered tool. `discoverCommandsSync()` collects slash commands from every scope and feeds them to the `skill` tool description and loader; `formatLoadedCommand` renders one command when it is invoked.

## SCOPE ORDER

Discovery concatenates sources and then deduplicates by name, so the first occurrence wins:

```
project (.claude/commands)
  -> user (<claude config dir>/commands)
  -> opencode-project (project .opencode command dirs)
  -> opencode (global OpenCode command dirs)
  -> builtin (features/builtin-commands)
  -> plugin (Claude Code plugin definitions)
```

Directory recursion builds nested names with `/` (a file at `git/sync.md` becomes `git/sync`); `EXCLUDED_DIRS` and dot-directories are skipped.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Discovery walk, scope order, dedupe | `command-discovery.ts` |
| Shared parsing/path helpers | `command-discovery-deps.ts` (re-exports frontmatter, model sanitizer, command dirs, plugin discovery) |
| Rendered command output | `command-output-formatter.ts` (`formatLoadedCommand`, `formatCommandList`) |
| `CommandInfo` / `CommandMetadata` / `CommandScope` | `types.ts` |

## CONVENTIONS

- `sanitizeModelField` is called with `"opencode"` for OpenCode-sourced commands and `"claude-code"` otherwise; do not pass a raw frontmatter model through.
- Discovery is synchronous and failure-tolerant: an unreadable command file is skipped, never thrown.
- `formatLoadedCommand` resolves `@file` references and nested command references, then substitutes `${user_message}` and `$ARGUMENTS`; content may arrive through `lazyContentLoader`.

## ANTI-PATTERNS

- Do not re-import discovery helpers from `../../shared` directly here; `command-discovery-deps.ts` is the seam tests swap.
- Do not reorder the source list without updating the dedupe expectation: order is the override policy.

# src/hooks/claude-code-hooks/ — Claude Code Compatibility

**Generated:** 2026-02-17

## OVERVIEW

~2110 LOC across 19 files. Provides Claude Code settings.json compatibility layer. Parses CC permission rules and maps CC hooks (PreToolUse, PostToolUse) to OpenCode hooks.

## WHAT IT DOES

1. Parses Claude Code `settings.json` permission format
2. Maps CC hook types to OpenCode event types
3. Enforces CC permission rules (allow/deny per tool)
4. Supports CC `.claude/settings.json` and `.claude/settings.local.json`

## CC → OPENCODE HOOK MAPPING

| CC Hook | OpenCode Event |
|---------|---------------|
| PreToolUse | tool.execute.before |
| PostToolUse | tool.execute.after |
| Notification | event (session.idle) |
| Stop | event (session.idle) |

## PERMISSION SYSTEM

CC permissions format:
```json
{
  "permissions": {
    "allow": ["Edit", "Write"],
    "deny": ["Bash(rm:*)"]
  }
}
```

Translated to OpenCode tool restrictions via permission-compat in shared/.

## FILES

Key files: `settings-loader.ts` (parse CC settings), `hook-mapper.ts` (CC→OC mapping), `permission-handler.ts` (rule enforcement), `types.ts` (CC type definitions).

# CLAUDE CODE HOOKS COMPATIBILITY

## OVERVIEW

Full Claude Code settings.json hook compatibility. 5 lifecycle events: PreToolUse, PostToolUse, UserPromptSubmit, Stop, PreCompact.

## STRUCTURE

```
claude-code-hooks/
├── index.ts              # Main factory (401 lines)
├── config.ts             # Loads ~/.claude/settings.json
├── config-loader.ts      # Extended config
├── pre-tool-use.ts       # PreToolUse executor
├── post-tool-use.ts      # PostToolUse executor
├── user-prompt-submit.ts # UserPromptSubmit executor
├── stop.ts               # Stop hook executor
├── pre-compact.ts        # PreCompact executor
├── transcript.ts         # Tool use recording
├── tool-input-cache.ts   # Pre→post caching
├── types.ts              # Hook types
└── todo.ts               # Todo JSON fix
```

## HOOK LIFECYCLE

| Event | When | Can Block | Context |
|-------|------|-----------|---------|
| PreToolUse | Before tool | Yes | sessionId, toolName, toolInput |
| PostToolUse | After tool | Warn | + toolOutput, transcriptPath |
| UserPromptSubmit | On message | Yes | sessionId, prompt, parts |
| Stop | Session idle | inject | sessionId, parentSessionId |
| PreCompact | Before summarize | No | sessionId |

## CONFIG SOURCES

Priority (highest first):
1. `.claude/settings.json` (project)
2. `~/.claude/settings.json` (user)

## HOOK EXECUTION

1. Hooks loaded from settings.json
2. Matchers filter by tool name
3. Commands via subprocess with `$SESSION_ID`, `$TOOL_NAME`
4. Exit codes: 0=pass, 1=warn, 2=block

## ANTI-PATTERNS

- **Heavy PreToolUse**: Runs before EVERY tool call
- **Blocking non-critical**: Use PostToolUse warnings

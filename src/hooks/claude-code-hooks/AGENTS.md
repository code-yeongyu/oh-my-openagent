# CLAUDE CODE HOOKS COMPATIBILITY LAYER

## OVERVIEW

Full Claude Code settings.json hook compatibility. Executes user-defined hooks at 5 lifecycle events: PreToolUse, PostToolUse, UserPromptSubmit, Stop, PreCompact.

## STRUCTURE

```
claude-code-hooks/
├── index.ts              # Main factory (401 lines) - createClaudeCodeHooksHook()
├── config.ts             # Loads ~/.claude/settings.json
├── config-loader.ts      # Extended config from multiple sources
├── pre-tool-use.ts       # PreToolUse hook executor (172 lines)
├── post-tool-use.ts      # PostToolUse hook executor (199 lines)
├── user-prompt-submit.ts # UserPromptSubmit hook executor
├── stop.ts               # Stop hook executor (session idle)
├── pre-compact.ts        # PreCompact hook executor (context compaction)
├── transcript.ts         # Tool use recording (252 lines)
├── tool-input-cache.ts   # Caches tool inputs between pre/post
├── types.ts              # Hook types, context interfaces
├── todo.ts               # Todo JSON parsing fix
└── plugin-config.ts      # Plugin config access
```

## HOOK LIFECYCLE

| Event | When | Can Block | Context Fields |
|-------|------|-----------|----------------|
| **PreToolUse** | Before tool | Yes | sessionId, toolName, toolInput, cwd |
| **PostToolUse** | After tool | Warn only | + toolOutput, transcriptPath |
| **UserPromptSubmit** | On user message | Yes | sessionId, prompt, parts, cwd |
| **Stop** | Session idle | inject_prompt | sessionId, parentSessionId |
| **PreCompact** | Before summarize | No | sessionId, cwd |

## CONFIG SOURCES

Priority (highest first):
1. `.claude/settings.json` (project)
2. `~/.claude/settings.json` (user)

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Edit", "command": "./check.sh" }],
    "PostToolUse": [{ "command": "post-hook.sh $TOOL_NAME" }]
  }
}
```

## HOOK EXECUTION

1. User-defined hooks loaded from settings.json
2. Matchers filter by tool name (supports wildcards)
3. Commands executed via subprocess with environment:
   - `$SESSION_ID`, `$TOOL_NAME`, `$TOOL_INPUT`, `$CWD`
4. Exit codes: 0=pass, 1=warn, 2=block

## KEY PATTERNS

- **Session tracking**: `Map<sessionID, state>` for first-message, error, interrupt
- **Input caching**: Tool inputs cached pre→post via `tool-input-cache.ts`
- **Transcript recording**: All tool uses logged for debugging
- **Todowrite fix**: Parses string todos to array (line 174-196)

## ANTI-PATTERNS

- **Heavy PreToolUse logic**: Runs before EVERY tool call
- **Blocking non-critical**: Use warnings in PostToolUse instead
- **Missing error handling**: Always wrap subprocess calls

# CLAUDE CODE HOOKS COMPATIBILITY

## OVERVIEW

Full Claude Code `settings.json` hook compatibility layer. Intercepts OpenCode events to execute external scripts/commands.

**Config Sources** (priority): `.claude/settings.local.json` > `.claude/settings.json` (project) > `~/.claude/settings.json` (global)

## STRUCTURE
```
claude-code-hooks/
├── index.ts              # Barrel export
├── claude-code-hooks-hook.ts  # Main factory
├── config.ts             # Claude settings.json loader
├── config-loader.ts      # Extended plugin config
├── pre-tool-use.ts       # PreToolUse hook executor
├── post-tool-use.ts      # PostToolUse hook executor
├── user-prompt-submit.ts # UserPromptSubmit executor
├── stop.ts               # Stop hook executor
├── pre-compact.ts        # PreCompact executor
├── transcript.ts         # Tool use recording
├── tool-input-cache.ts   # Pre→post input caching
├── todo.ts               # Todo integration
├── session-hook-state.ts # Active state tracking
├── types.ts              # Hook & IO type definitions
├── plugin-config.ts      # Default config constants
└── handlers/             # Event handlers (5 files)
```

## HOOK LIFECYCLE
| Event | Timing | Can Block | Context Provided |
|-------|--------|-----------|------------------|
| PreToolUse | Before tool exec | Yes | sessionId, toolName, toolInput, cwd |
| PostToolUse | After tool exec | Warn | + toolOutput, transcriptPath |
| UserPromptSubmit | On message send | Yes | sessionId, prompt, parts, cwd |
| Stop | Session idle/end | Inject | sessionId, parentSessionId, cwd |
| PreCompact | Before summarize | No | sessionId, cwd |

## HOOK EXECUTION
- **Matchers**: Hooks filter by tool name or event type via regex/glob
- **Commands**: Executed via subprocess with env vars (`$SESSION_ID`, `$TOOL_NAME`)
- **Exit Codes**:
  - `0`: Pass (Success)
  - `1`: Warn (Continue with system message)
  - `2`: Block (Abort operation/prompt)

## ANTI-PATTERNS
- **Heavy PreToolUse**: Runs before EVERY tool; keep logic light to avoid latency
- **Blocking non-critical**: Prefer PostToolUse warnings for non-fatal issues
- **Direct state mutation**: Use `updatedInput` in PreToolUse instead of side effects
- **Ignoring Exit Codes**: Ensure scripts return `2` to properly block sensitive tools
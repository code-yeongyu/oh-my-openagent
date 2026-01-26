# CLAUDE CODE HOOKS COMPATIBILITY

## OVERVIEW
Full Claude Code `settings.json` hook compatibility layer. Intercepts OpenCode events to execute external scripts/commands defined in Claude Code configuration.

## STRUCTURE
```
claude-code-hooks/
├── index.ts              # Main factory (401 lines)
├── config.ts             # Loads ~/.claude/settings.json
├── config-loader.ts      # Extended config (disabledHooks)
├── pre-tool-use.ts       # PreToolUse executor
├── post-tool-use.ts      # PostToolUse executor
├── user-prompt-submit.ts # UserPromptSubmit executor
├── stop.ts               # Stop hook executor (with active state tracking)
├── pre-compact.ts        # PreCompact executor
├── transcript.ts         # Tool use recording
├── tool-input-cache.ts   # Pre→post input caching
└── types.ts              # Hook & IO type definitions
```

## HOOK LIFECYCLE
| Event | Timing | Can Block | Context Provided |
|-------|--------|-----------|------------------|
| PreToolUse | Before tool exec | Yes | sessionId, toolName, toolInput, cwd |
| PostToolUse | After tool exec | Warn | + toolOutput, transcriptPath |
| UserPromptSubmit | On message send | Yes | sessionId, prompt, parts, cwd |
| Stop | Session idle/end | Inject | sessionId, parentSessionId, cwd |
| PreCompact | Before summarize | No | sessionId, cwd |

## CONFIG SOURCES
Priority (highest first):
1. `.claude/settings.json` (Project-local)
2. `~/.claude/settings.json` (Global user)

## HOOK EXECUTION
- **Matchers**: Hooks filter by tool name or event type via regex/glob.
- **Commands**: Executed via subprocess with env vars (`$SESSION_ID`, `$TOOL_NAME`).
- **Exit Codes**:
  - `0`: Pass (Success)
  - `1`: Warn (Continue with system message)
  - `2`: Block (Abort operation/prompt)

## ANTI-PATTERNS
- **Heavy PreToolUse**: Runs before EVERY tool; keep logic light to avoid latency.
- **Blocking non-critical**: Prefer PostToolUse warnings for non-fatal issues.
- **Direct state mutation**: Use `updatedInput` in PreToolUse instead of side effects.
- **Ignoring Exit Codes**: Ensure scripts return `2` to properly block sensitive tools.

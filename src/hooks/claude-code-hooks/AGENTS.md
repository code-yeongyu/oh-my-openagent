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
| PreToolUse | Before exec | Yes (exit 2) | sessionId, toolName, toolInput, cwd |
| PostToolUse | After exec | Warn (exit 1) | + toolOutput, transcriptPath |
| UserPromptSubmit | On message | Yes (exit 2) | sessionId, prompt, parts, cwd |
| Stop | Session end | Inject | sessionId, parentSessionId, cwd |
| PreCompact | Before summarize | No | sessionId, cwd |

## EXIT CODES

- `0`: Pass (continue)
- `1`: Warn (continue + system message)
- `2`: Block (abort operation)

## ANTI-PATTERNS

- **Heavy PreToolUse**: Runs before EVERY tool — keep scripts fast
- **Blocking non-critical**: Prefer PostToolUse warnings
- **Ignoring exit codes**: Return `2` to block sensitive tools

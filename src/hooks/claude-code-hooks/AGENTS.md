# CLAUDE CODE HOOKS COMPATIBILITY

## OVERVIEW

Full Claude Code `settings.json` hook compatibility layer. Intercepts OpenCode events to execute external scripts/commands defined in settings.json.

**Config Sources** (priority): `.claude/settings.local.json` > `.claude/settings.json` (project) > `~/.claude/settings.json` (global)

## STRUCTURE
```
claude-code-hooks/
├── index.ts              # Barrel export
├── claude-code-hooks-hook.ts  # Main factory (22 lines)
├── config.ts             # Claude settings.json loader (105 lines)
├── config-loader.ts      # Extended plugin config (107 lines)
├── pre-tool-use.ts       # PreToolUse hook executor (173 lines)
├── post-tool-use.ts      # PostToolUse hook executor (200 lines)
├── user-prompt-submit.ts # UserPromptSubmit executor (125 lines)
├── stop.ts               # Stop hook executor (122 lines)
├── pre-compact.ts        # PreCompact executor (110 lines)
├── transcript.ts         # Tool use recording (235 lines)
├── tool-input-cache.ts   # Pre→post input caching (51 lines)
├── todo.ts               # Todo integration
├── session-hook-state.ts # Active state tracking (11 lines)
├── types.ts              # Hook & IO type definitions (204 lines)
├── plugin-config.ts      # Default config constants (12 lines)
└── handlers/             # Event handlers (5 files)
    ├── pre-compact-handler.ts
    ├── tool-execute-before-handler.ts
    ├── tool-execute-after-handler.ts
    ├── chat-message-handler.ts
    └── session-event-handler.ts
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

# HOOKS KNOWLEDGE BASE

## OVERVIEW

22+ lifecycle hooks intercepting/modifying agent behavior. Context injection, error recovery, output control, notifications.

## STRUCTURE

```
hooks/
├── anthropic-context-window-limit-recovery/  # Auto-compact at token limit (556 lines)
├── auto-slash-command/         # Detect and execute /command patterns
├── auto-update-checker/        # Version notifications, startup toast
├── background-notification/    # OS notify on task complete
├── claude-code-hooks/          # settings.json PreToolUse/PostToolUse/etc (408 lines)
├── comment-checker/            # Prevent excessive AI comments
│   ├── filters/                # docstring, directive, bdd, shebang
│   └── output/                 # XML builder, formatter
├── compaction-context-injector/ # Preserve context during compaction
├── directory-agents-injector/  # Auto-inject AGENTS.md
├── directory-readme-injector/  # Auto-inject README.md
├── edit-error-recovery/        # Recover from edit failures
├── empty-message-sanitizer/    # Sanitize empty messages
├── interactive-bash-session/   # Tmux session management
├── keyword-detector/           # ultrawork/search keyword activation
├── non-interactive-env/        # CI/headless handling
├── preemptive-compaction/      # Pre-emptive at 85% usage
├── prometheus-md-only/         # Restrict prometheus to read-only
├── ralph-loop/                 # Self-referential dev loop
├── rules-injector/             # Conditional rules from .claude/rules/
├── session-recovery/           # Recover from errors (432 lines)
├── sisyphus-orchestrator/      # Main orchestration hook (660 lines)
├── start-work/                 # Initialize Sisyphus work session
├── task-resume-info/           # Track task resume state
├── think-mode/                 # Auto-detect thinking triggers
├── thinking-block-validator/   # Validate thinking block format
├── agent-usage-reminder/       # Remind to use specialists
├── context-window-monitor.ts   # Monitor usage (standalone)
├── session-notification.ts     # OS notify on idle
├── todo-continuation-enforcer.ts # Force TODO completion (413 lines)
└── tool-output-truncator.ts    # Truncate verbose outputs
```

## HOOK EVENTS

| Event | Timing | Can Block | Use Case |
|-------|--------|-----------|----------|
| PreToolUse | Before tool | Yes | Validate, modify input |
| PostToolUse | After tool | No | Add context, warnings |
| UserPromptSubmit | On prompt | Yes | Inject messages, block |
| Stop | Session idle | No | Inject follow-ups |
| onSummarize | Compaction | No | Preserve context |

## HOW TO ADD

1. Create `src/hooks/my-hook/`
2. Files: `index.ts` (createMyHook), `constants.ts`, `types.ts` (optional)
3. Return: `{ PreToolUse?, PostToolUse?, UserPromptSubmit?, Stop?, onSummarize? }`
4. Export from `src/hooks/index.ts`

## PATTERNS

- **Storage**: JSON file for persistent state across sessions
- **Once-per-session**: Track injected paths in Set
- **Message injection**: Return `{ messages: [...] }`
- **Blocking**: Return `{ blocked: true, message: "..." }` from PreToolUse

## ANTI-PATTERNS

- Heavy computation in PreToolUse (slows every tool call)
- Blocking without actionable message
- Duplicate injection (track what's injected)
- Missing try/catch (don't crash session)

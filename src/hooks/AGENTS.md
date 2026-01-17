# HOOKS KNOWLEDGE BASE

## OVERVIEW
22+ lifecycle hooks intercepting/modifying agent behavior via PreToolUse, PostToolUse, UserPromptSubmit, and more.

## STRUCTURE
```
hooks/
├── sisyphus-orchestrator/      # Main orchestration & agent delegation (771 lines)
├── anthropic-context-window-limit-recovery/  # Auto-summarize at token limit (14 files)
├── todo-continuation-enforcer.ts # Force completion of [ ] items
├── ralph-loop/                 # Self-referential dev loop (7 files)
├── claude-code-hooks/          # settings.json hook compatibility layer (13 files)
├── comment-checker/            # Prevents AI slop/excessive comments (13 files)
├── auto-slash-command/         # Detects and executes /command patterns
├── rules-injector/             # Conditional rules from .claude/rules/
├── directory-agents-injector/  # Auto-injects local AGENTS.md files
├── directory-readme-injector/  # Auto-injects local README.md files
├── preemptive-compaction/      # Triggers summary at 85% usage
├── edit-error-recovery/        # Recovers from tool execution failures
├── thinking-block-validator/   # Ensures valid <thinking> format
├── context-window-monitor.ts   # Reminds agents of remaining headroom
├── session-recovery/           # Auto-recovers from session crashes
├── think-mode/                 # Dynamic thinking budget adjustment
├── background-notification/    # OS notification on task completion
└── tool-output-truncator.ts    # Prevents context bloat from verbose tools
```

## HOOK EVENTS
| Event | Timing | Can Block | Description |
|-------|--------|-----------|-------------|
| PreToolUse | Before tool | Yes | Validate/modify inputs (e.g., directory-agents-injector) |
| PostToolUse | After tool | No | Append context/warnings (e.g., edit-error-recovery) |
| UserPromptSubmit | On prompt | Yes | Filter/modify user input (e.g., keyword-detector) |
| Stop | Session idle | No | Auto-continue tasks (e.g., todo-continuation-enforcer) |
| onSummarize | Compaction | No | State preservation (e.g., compaction-context-injector) |

## HOW TO ADD
1. Create `src/hooks/name/` with `index.ts` factory (e.g., `createMyHook`).
2. Implement `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, or `onSummarize`.
3. Register in `src/hooks/index.ts`.

## PATTERNS
- **Context Injection**: Use `PreToolUse` to prepend instructions to tool inputs.
- **Resilience**: Implement `edit-error-recovery` style logic to retry failed tools.
- **Telegraphic UI**: Use `PostToolUse` to add brief warnings without bloating transcript.
- **Statelessness**: Prefer local file storage for state that must persist across sessions.

## ANTI-PATTERNS
- **Blocking**: Avoid blocking tools unless critical (use warnings in `PostToolUse` instead).
- **Latency**: No heavy computation in `PreToolUse`; it slows every interaction.
- **Redundancy**: Don't inject the same file multiple times; track state in session storage.
- **Prose**: Never use verbose prose in hook outputs; keep it technical and brief.

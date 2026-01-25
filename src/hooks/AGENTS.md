# HOOKS KNOWLEDGE BASE

## OVERVIEW

31 lifecycle hooks intercepting/modifying agent behavior. Events: PreToolUse, PostToolUse, UserPromptSubmit, Stop, onSummarize.

## STRUCTURE

```
hooks/
├── atlas/                      # Main orchestration (773 lines)
├── anthropic-context-window-limit-recovery/  # Auto-summarize
├── todo-continuation-enforcer.ts # Force TODO completion (489 lines)
├── ralph-loop/                 # Self-referential dev loop
├── claude-code-hooks/          # settings.json compat layer - see AGENTS.md
├── comment-checker/            # Prevents AI slop
├── auto-slash-command/         # Detects /command patterns
├── rules-injector/             # Conditional rules
├── directory-agents-injector/  # Auto-injects AGENTS.md
├── directory-readme-injector/  # Auto-injects README.md
├── edit-error-recovery/        # Recovers from failures
├── thinking-block-validator/   # Ensures valid <thinking>
├── context-window-monitor.ts   # Reminds of headroom
├── session-recovery/           # Auto-recovers from crashes
├── think-mode/                 # Dynamic thinking budget
├── keyword-detector/           # ultrawork/search/analyze modes
├── background-notification/    # OS notification
├── prometheus-md-only/         # Planner read-only mode
├── agent-usage-reminder/       # Specialized agent hints
├── auto-update-checker/        # Plugin update check
├── tool-output-truncator.ts    # Prevents context bloat
├── compaction-context-injector/ # Injects context on compaction
├── delegate-task-retry/        # Retries failed delegations
├── interactive-bash-session/   # Tmux session management
├── non-interactive-env/        # Non-TTY environment handling
├── start-work/                 # Sisyphus work session starter
├── task-resume-info/           # Resume info for cancelled tasks
├── question-label-truncator/   # Auto-truncates question labels >30 chars
└── index.ts                    # Hook aggregation + registration
```

## HOOK EVENTS

| Event | Timing | Can Block | Use Case |
|-------|--------|-----------|----------|
| PreToolUse | Before tool | Yes | Validate/modify inputs |
| PostToolUse | After tool | No | Append warnings, truncate |
| UserPromptSubmit | On prompt | Yes | Keyword detection |
| Stop | Session idle | No | Auto-continue |
| onSummarize | Compaction | No | Preserve state |

## EXECUTION ORDER

**chat.message**: keywordDetector → claudeCodeHooks → autoSlashCommand → startWork → ralphLoop

**tool.execute.before**: claudeCodeHooks → nonInteractiveEnv → commentChecker → directoryAgentsInjector → rulesInjector

**tool.execute.after**: editErrorRecovery → delegateTaskRetry → commentChecker → toolOutputTruncator → claudeCodeHooks

## HOW TO ADD

1. Create `src/hooks/name/` with `index.ts` exporting `createMyHook(ctx)`
2. Add hook name to `HookNameSchema` in `src/config/schema.ts`
3. Register in `src/index.ts`:
   ```typescript
   const myHook = isHookEnabled("my-hook") ? createMyHook(ctx) : null
   ```

## PATTERNS

- **Session-scoped state**: `Map<sessionID, Set<string>>`
- **Conditional execution**: Check `input.tool` before processing
- **Output modification**: `output.output += "\n${REMINDER}"`

## ANTI-PATTERNS

- **Blocking non-critical**: Use PostToolUse warnings instead
- **Heavy computation**: Keep PreToolUse light
- **Redundant injection**: Track injected files

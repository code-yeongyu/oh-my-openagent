# HOOKS KNOWLEDGE BASE

## OVERVIEW

31 lifecycle hooks intercepting/modifying agent behavior. Events: PreToolUse, PostToolUse, UserPromptSubmit, Stop, onSummarize.

## STRUCTURE

```
hooks/
├── atlas/                      # Main orchestration & delegation (771 lines)
├── anthropic-context-window-limit-recovery/  # Auto-summarize at token limit
├── todo-continuation-enforcer.ts # Force TODO completion
├── ralph-loop/                 # Self-referential dev loop until done
├── claude-code-hooks/          # settings.json hook compat layer (14 files) - see AGENTS.md
├── comment-checker/            # Prevents AI slop/excessive comments
├── auto-slash-command/         # Detects /command patterns
├── rules-injector/             # Conditional rules from .claude/rules/
├── directory-agents-injector/  # Auto-injects AGENTS.md files
├── directory-readme-injector/  # Auto-injects README.md files
├── preemptive-compaction/      # Triggers summary at 85% context
├── edit-error-recovery/        # Recovers from tool failures
├── thinking-block-validator/   # Ensures valid <thinking> format
├── context-window-monitor.ts   # Reminds agents of remaining headroom
├── session-recovery/           # Auto-recovers from crashes
├── think-mode/                 # Dynamic thinking budget
├── keyword-detector/           # ultrawork/search/analyze modes
├── background-notification/    # OS notification on task completion
├── prometheus-md-only/         # Enforces planner read-only mode
├── agent-usage-reminder/       # Reminds to use specialized agents
├── auto-update-checker/        # Checks for plugin updates
└── tool-output-truncator.ts    # Prevents context bloat
```

## HOOK EVENTS

| Event | Timing | Can Block | Use Case |
|-------|--------|-----------|----------|
| PreToolUse | Before tool | Yes | Validate/modify inputs, inject context |
| PostToolUse | After tool | No | Append warnings, truncate output |
| UserPromptSubmit | On prompt | Yes | Keyword detection, mode switching |
| Stop | Session idle | No | Auto-continue (todo-continuation, ralph-loop) |
| onSummarize | Compaction | No | Preserve critical state |

## EXECUTION ORDER

**chat.message**: keywordDetector → claudeCodeHooks → autoSlashCommand → startWork → ralphLoop

**tool.execute.before**: claudeCodeHooks → nonInteractiveEnv → commentChecker → directoryAgentsInjector → directoryReadmeInjector → rulesInjector

**tool.execute.after**: editErrorRecovery → delegateTaskRetry → commentChecker → toolOutputTruncator → emptyTaskResponseDetector → claudeCodeHooks

## HOW TO ADD

1. Create `src/hooks/name/` with `index.ts` exporting `createMyHook(ctx)`
2. Implement event handlers: `"tool.execute.before"`, `"tool.execute.after"`, etc.
3. Add hook name to `HookNameSchema` in `src/config/schema.ts`
4. Register in `src/index.ts`:
   ```typescript
   const myHook = isHookEnabled("my-hook") ? createMyHook(ctx) : null
   // Add to event handlers
   ```

## PATTERNS

- **Session-scoped state**: `Map<sessionID, Set<string>>` for tracking per-session
- **Conditional execution**: Check `input.tool` before processing
- **Output modification**: `output.output += "\n${REMINDER}"` to append context
- **Async state**: Use promises for CLI path resolution, cache results

## ANTI-PATTERNS

- **Blocking non-critical**: Use PostToolUse warnings instead of PreToolUse blocks
- **Heavy computation**: Keep PreToolUse light - slows every tool call
- **Redundant injection**: Track injected files to prevent duplicates
- **Verbose output**: Keep hook messages technical, brief

# HOOKS KNOWLEDGE BASE

## OVERVIEW

40+ lifecycle hooks intercepting/modifying agent behavior across 5 events.

**Event Types**:
- `UserPromptSubmit` (`chat.message`) - Can block
- `PreToolUse` (`tool.execute.before`) - Can block
- `PostToolUse` (`tool.execute.after`) - Cannot block
- `Stop` (`event: session.stop`) - Cannot block
- `onSummarize` (Compaction) - Cannot block

## STRUCTURE
```
hooks/
├── atlas/                      # Main orchestration (770 lines)
├── anthropic-context-window-limit-recovery/ # Auto-summarize
├── todo-continuation-enforcer.ts # Force TODO completion (517 lines)
├── ralph-loop/                 # Self-referential dev loop (428 lines)
├── claude-code-hooks/          # settings.json compat layer - see AGENTS.md
├── comment-checker/            # Prevents AI slop
├── auto-slash-command/         # Detects /command patterns
├── rules-injector/             # Conditional rules
├── directory-agents-injector/  # Auto-injects AGENTS.md
├── directory-readme-injector/  # Auto-injects README.md
├── edit-error-recovery/        # Recovers from failures
├── thinking-block-validator/   # Ensures valid <thinking>
├── context-window-monitor.ts   # Reminds of headroom
├── session-recovery/           # Auto-recovers from crashes (436 lines)
├── session-notification.ts     # Session event notifications (337 lines)
├── think-mode/                 # Dynamic thinking budget
├── keyword-detector/           # ultrawork/search/analyze modes
├── background-notification/    # OS notification
├── prometheus-md-only/         # Planner read-only mode
├── agent-usage-reminder/       # Specialized agent hints
├── auto-update-checker/        # Plugin update check (304 lines)
├── tool-output-truncator.ts    # Prevents context bloat
├── compaction-context-injector/ # Injects context on compaction
├── delegate-task-retry/        # Retries failed delegations
├── interactive-bash-session/   # Tmux session management
├── non-interactive-env/        # Non-TTY environment handling
├── start-work/                 # Sisyphus work session starter
├── task-resume-info/           # Resume info for cancelled tasks
├── question-label-truncator/   # Auto-truncates question labels
├── category-skill-reminder/    # Reminds of category skills
├── empty-task-response-detector.ts # Detects empty responses
├── sisyphus-junior-notepad/    # Sisyphus Junior notepad
├── stop-continuation-guard/    # Guards stop continuation
├── subagent-question-blocker/  # Blocks subagent questions
├── task-reminder/              # Task progress reminders
├── tasks-todowrite-disabler/   # Disables TodoWrite when task system active
├── unstable-agent-babysitter/  # Monitors unstable agent behavior
├── write-existing-file-guard/  # Guards against overwriting existing files
├── preemptive-compaction.ts    # Preemptive context compaction
└── index.ts                    # Hook aggregation + registration
```

## HOOK EVENTS
| Event | Timing | Can Block | Use Case |
|-------|--------|-----------|----------|
| UserPromptSubmit | `chat.message` | Yes | Keyword detection, slash commands |
| PreToolUse | `tool.execute.before` | Yes | Validate/modify inputs, inject context |
| PostToolUse | `tool.execute.after` | No | Truncate output, error recovery |
| Stop | `event` (session.stop) | No | Auto-continue, notifications |
| onSummarize | Compaction | No | Preserve state, inject summary context |

## EXECUTION ORDER
- **UserPromptSubmit**: keywordDetector → claudeCodeHooks → autoSlashCommand → startWork
- **PreToolUse**: subagentQuestionBlocker → questionLabelTruncator → claudeCodeHooks → nonInteractiveEnv → commentChecker → directoryAgentsInjector → directoryReadmeInjector → rulesInjector → prometheusMdOnly → sisyphusJuniorNotepad → writeExistingFileGuard → atlasHook
- **PostToolUse**: claudeCodeHooks → toolOutputTruncator → contextWindowMonitor → commentChecker → directoryAgentsInjector → directoryReadmeInjector → rulesInjector → emptyTaskResponseDetector → agentUsageReminder → interactiveBashSession → editErrorRecovery → delegateTaskRetry → atlasHook → taskResumeInfo → taskReminder

## HOW TO ADD
1. Create `src/hooks/name/` with `index.ts` exporting `createMyHook(ctx)`
2. Add hook name to `HookNameSchema` in `src/config/schema.ts`
3. Register in `src/index.ts` and add to relevant lifecycle methods

## HOOK PATTERNS

**Simple Single-Event**:
```typescript
export function createToolOutputTruncatorHook(ctx) {
  return { "tool.execute.after": async (input, output) => { ... } }
}
```

**Multi-Event with State**:
```typescript
export function createThinkModeHook() {
  const state = new Map<string, ThinkModeState>()
  return {
    "chat.params": async (output, sessionID) => { ... },
    "event": async ({ event }) => { /* cleanup */ }
  }
}
```

## ANTI-PATTERNS
- **Blocking non-critical**: Use PostToolUse warnings instead
- **Heavy computation**: Keep PreToolUse light to avoid latency
- **Redundant injection**: Track injected files to avoid context bloat
- **Direct state mutation**: Use `output.output +=` instead of replacing

# HOOKS KNOWLEDGE BASE

## OVERVIEW

163 lifecycle hooks intercepting/modifying agent behavior across 5 events.

**Event Types**:
- `UserPromptSubmit` (`chat.message`) - Can block
- `PreToolUse` (`tool.execute.before`) - Can block
- `PostToolUse` (`tool.execute.after`) - Cannot block
- `Stop` (`event: session.stop`) - Cannot block
- `onSummarize` (Compaction) - Cannot block

## STRUCTURE
```
hooks/
├── agent-usage-reminder/         # Specialized agent hints (212 lines)
├── anthropic-context-window-limit-recovery/ # Auto-summarize on limit (2232 lines)
├── anthropic-effort/             # Anthropic effort level management (272 lines)
├── atlas/                        # Main orchestration hook (1976 lines)
├── auto-slash-command/           # Detects /command patterns (1134 lines)
├── auto-update-checker/          # Plugin update check (1140 lines)
├── background-notification/      # OS notifications (33 lines)
├── category-skill-reminder/      # Reminds of category skills (597 lines)
├── claude-code-hooks/            # settings.json compat - see AGENTS.md (2110 lines)
├── comment-checker/              # Prevents AI slop comments (710 lines)
├── compaction-context-injector/  # Injects context on compaction (128 lines)
├── compaction-todo-preserver/    # Preserves todos during compaction (203 lines)
├── context-window-monitor.ts     # Reminds of headroom (99 lines)
├── delegate-task-retry/          # Retries failed delegations (266 lines)
├── directory-agents-injector/    # Auto-injects AGENTS.md (195 lines)
├── directory-readme-injector/    # Auto-injects README.md (190 lines)
├── edit-error-recovery/          # Recovers from edit failures (188 lines)
├── empty-task-response-detector.ts # Detects empty responses (27 lines)
├── index.ts                      # Hook aggregation + registration (46 lines)
├── interactive-bash-session/     # Tmux session management (695 lines)
├── keyword-detector/             # ultrawork/search/analyze modes (1665 lines)
├── non-interactive-env/          # Non-TTY environment handling (483 lines)
├── preemptive-compaction.ts      # Preemptive context compaction (108 lines)
├── prometheus-md-only/           # Planner read-only mode (955 lines)
├── question-label-truncator/     # Auto-truncates question labels (199 lines)
├── ralph-loop/                   # Self-referential dev loop (1687 lines)
├── rules-injector/               # Conditional rules injection (1604 lines)
├── session-notification.ts       # Session event notifications (108 lines)
├── session-recovery/             # Auto-recovers from crashes (1279 lines)
├── sisyphus-junior-notepad/      # Sisyphus Junior notepad (76 lines)
├── start-work/                   # Sisyphus work session starter (648 lines)
├── stop-continuation-guard/      # Guards stop continuation (214 lines)
├── subagent-question-blocker/    # Blocks subagent questions (112 lines)
├── task-reminder/                # Task progress reminders (210 lines)
├── task-resume-info/             # Resume info for cancelled tasks (39 lines)
├── tasks-todowrite-disabler/     # Disables TodoWrite when tasks active (202 lines)
├── think-mode/                   # Dynamic thinking budget (1365 lines)
├── thinking-block-validator/     # Ensures valid <thinking> blocks (169 lines)
├── todo-continuation-enforcer/   # Force TODO completion (2061 lines)
├── tool-output-truncator.ts      # Prevents context bloat (62 lines)
├── unstable-agent-babysitter/    # Monitors unstable agent behavior (451 lines)
└── write-existing-file-guard/    # Guards against overwriting files (356 lines)
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

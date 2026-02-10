# HOOKS KNOWLEDGE BASE

## OVERVIEW

41 lifecycle hooks intercepting/modifying agent behavior across 7 event types. Three-tier registration: Core (32) → Continuation (7) → Skill (2).

## STRUCTURE
```
hooks/
├── agent-usage-reminder/         # Specialized agent hints (109 lines)
├── anthropic-context-window-limit-recovery/ # Auto-summarize on limit (2232 lines)
├── anthropic-effort/             # Effort=max for Opus max variant (56 lines)
├── atlas/                        # Main orchestration hook (1976 lines)
├── auto-slash-command/           # Detects /command patterns (1134 lines)
├── auto-update-checker/          # Plugin update check (1140 lines)
├── background-notification/      # OS notifications (33 lines)
├── category-skill-reminder/      # Category+skill delegation reminders (597 lines)
├── claude-code-hooks/            # settings.json compat (2110 lines) - see AGENTS.md
├── comment-checker/              # Prevents AI slop comments (710 lines)
├── compaction-context-injector/  # Injects context on compaction (128 lines)
├── compaction-todo-preserver/    # Preserves todos during compaction (203 lines)
├── context-window-monitor.ts     # Reminds of headroom at 70% (99 lines)
├── delegate-task-retry/          # Retries failed delegations (266 lines)
├── directory-agents-injector/    # Auto-injects AGENTS.md (195 lines)
├── directory-readme-injector/    # Auto-injects README.md (190 lines)
├── edit-error-recovery/          # Recovers from edit failures (188 lines)
├── empty-task-response-detector.ts # Detects empty responses (27 lines)
├── interactive-bash-session/     # Tmux session management (695 lines)
├── keyword-detector/             # ultrawork/search/analyze modes (1665 lines)
├── non-interactive-env/          # Non-TTY handling (483 lines)
├── preemptive-compaction.ts      # Auto-compact at 78% usage (108 lines)
├── prometheus-md-only/           # Planner read-only mode (955 lines)
├── question-label-truncator/     # Truncates labels to 30 chars (199 lines)
├── ralph-loop/                   # Self-referential dev loop (1687 lines)
├── rules-injector/               # Conditional .sisyphus/rules injection (1604 lines)
├── session-notification.ts       # OS idle notifications (108 lines)
├── session-recovery/             # Auto-recovers from crashes (1279 lines)
├── sisyphus-junior-notepad/      # Junior notepad directive (76 lines)
├── start-work/                   # Sisyphus work session starter (648 lines)
├── stop-continuation-guard/      # Guards stop continuation (214 lines)
├── subagent-question-blocker/    # Blocks subagent questions (112 lines)
├── task-reminder/                # Task progress reminders (210 lines)
├── task-resume-info/             # Resume info for cancelled tasks (39 lines)
├── tasks-todowrite-disabler/     # Disables TodoWrite when tasks active (202 lines)
├── think-mode/                   # Dynamic thinking budget (1365 lines)
├── thinking-block-validator/     # Validates thinking blocks (169 lines)
├── todo-continuation-enforcer/   # Force TODO completion — boulder mechanism (2061 lines)
├── tool-output-truncator.ts      # Prevents context bloat (62 lines)
├── unstable-agent-babysitter/    # Monitors unstable behavior (451 lines)
└── write-existing-file-guard/    # Guards against file overwrite (356 lines)
```

## EVENT TYPES

| Event | Hook Method | Can Block | Count |
|-------|-------------|-----------|-------|
| UserPromptSubmit | `chat.message` | Yes | 4 |
| ChatParams | `chat.params` | No | 2 |
| PreToolUse | `tool.execute.before` | Yes | 13 |
| PostToolUse | `tool.execute.after` | No | 18 |
| SessionEvent | `event` | No | 17 |
| MessagesTransform | `experimental.chat.messages.transform` | No | 1 |
| Compaction | `onSummarize` | No | 1 |

## BLOCKING HOOKS (8)

| Hook | Event | Blocks When |
|------|-------|-------------|
| auto-slash-command | chat.message | Command execution fails |
| keyword-detector | chat.message | Keyword injection fails |
| non-interactive-env | tool.execute.before | Interactive command in non-TTY |
| prometheus-md-only | tool.execute.before | Write outside .sisyphus/*.md |
| subagent-question-blocker | tool.execute.before | Question tool in subagent |
| tasks-todowrite-disabler | tool.execute.before | TodoWrite with task system |
| write-existing-file-guard | tool.execute.before | Write to existing file |
| claude-code-hooks | tool.execute.before | Exit code 2 from settings.json hook |

## EXECUTION ORDER

**UserPromptSubmit**: keywordDetector → claudeCodeHooks → autoSlashCommand → startWork
**PreToolUse**: subagentQuestionBlocker → questionLabelTruncator → claudeCodeHooks → nonInteractiveEnv → commentChecker → directoryAgentsInjector → directoryReadmeInjector → rulesInjector → prometheusMdOnly → sisyphusJuniorNotepad → writeExistingFileGuard → atlasHook
**PostToolUse**: claudeCodeHooks → toolOutputTruncator → contextWindowMonitor → commentChecker → directoryAgentsInjector → directoryReadmeInjector → rulesInjector → emptyTaskResponseDetector → agentUsageReminder → interactiveBashSession → editErrorRecovery → delegateTaskRetry → atlasHook → taskResumeInfo → taskReminder

## HOW TO ADD

1. Create `src/hooks/name/` with `index.ts` exporting `createMyHook(ctx)`
2. Add hook name to `HookNameSchema` in `src/config/schema/hooks.ts`
3. Register in appropriate `src/plugin/hooks/create-*-hooks.ts`

## ANTI-PATTERNS

- **Heavy PreToolUse**: Runs before EVERY tool — keep light
- **Blocking non-critical**: Use PostToolUse warnings instead
- **Redundant injection**: Track injected files to avoid context bloat
- **Direct state mutation**: Use `output.output +=` instead of replacing

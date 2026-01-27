# HOOKS KNOWLEDGE BASE

## OVERVIEW
38 lifecycle hooks intercepting/modifying agent behavior. Events: PreToolUse, PostToolUse, UserPromptSubmit, Stop, onSummarize.

## STRUCTURE
```
hooks/
├── atlas/                      # Main orchestration (752 lines)
├── anthropic-context-window-limit-recovery/ # Auto-summarize
├── todo-continuation-enforcer.ts # Force TODO completion (16k lines)
├── ralph-loop/                 # Self-referential dev loop
├── claude-code-hooks/          # settings.json compat layer - see AGENTS.md
├── comment-checker/            # Prevents AI slop
├── auto-slash-command/         # Detects /command patterns
├── rules-injector/             # Conditional rules from .claude/rules/
├── directory-agents-injector/  # Auto-injects AGENTS.md files
├── directory-readme-injector/  # Auto-injects README.md files
├── edit-error-recovery/        # Recovers from tool failures
├── thinking-block-validator/   # Ensures valid <thinking> format
├── context-window-monitor.ts   # Reminds agents of remaining headroom
├── session-recovery/           # Auto-recovers from crashes
├── think-mode/                 # Dynamic thinking budget
├── keyword-detector/           # ultrawork/search/analyze modes
├── background-notification/    # OS notification on task completion
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
├── question-label-truncator/   # Auto-truncates question labels
├── category-skill-reminder/    # Reminds of category skills
├── empty-task-response-detector.ts # Detects empty responses
├── sisyphus-junior-notepad/    # Sisyphus Junior notepad
├── planning-flow-guide/        # Guides planning workflow phases
├── tdd-guard/                  # Enforces test-driven development (opt-in)
├── subagent-verification/      # Verifies subagent task completion
├── background-compaction/      # Compacts background agent sessions
├── codebase-assessment/        # Assesses codebase patterns (opt-in)
├── lsp-diagnostics-enforcer/   # Enforces LSP diagnostics checks (opt-in)
├── phase-flow-enforcer/        # Enforces phase-based workflow (opt-in)
├── plan-reorganizer/           # Moves completed phases to bottom of tasks.md
├── plan-update-reminder/       # Reminds to update tasks.md after code changes
├── plan-attention-refresher/   # Refreshes tasks.md into attention window
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
- **chat.message**: keywordDetector → agentSkillReminder → tddGuard → claudeCodeHooks → autoSlashCommand → startWork → ralphLoop
- **tool.execute.before**: questionLabelTruncator → claudeCodeHooks → nonInteractiveEnv → commentChecker → directoryAgentsInjector → directoryReadmeInjector → rulesInjector → prometheusMdOnly → tddGuard → codebaseAssessment → sisyphusJuniorNotepad → atlasHook
- **tool.execute.after**: claudeCodeHooks → toolOutputTruncator → contextWindowMonitor → commentChecker → directoryAgentsInjector → directoryReadmeInjector → rulesInjector → emptyTaskResponseDetector → agentUsageReminder → categorySkillReminder → interactiveBashSession → editErrorRecovery → delegateTaskRetry → atlasHook → taskResumeInfo → planUpdateReminder → tddGuard → planningFlowGuide → subagentVerification → lspDiagnosticsEnforcer → phaseFlowEnforcer

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

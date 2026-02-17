# src/hooks/ — 44 Lifecycle Hooks

**Generated:** 2026-02-18

## OVERVIEW

44 hooks across 39 directories + 6 standalone files. Three-tier composition: Core(35) + Continuation(7) + Skill(2). All hooks follow `createXXXHook(deps) → HookFunction` factory pattern.

## HOOK TIERS

### Tier 1: Session Hooks (22) — `create-session-hooks.ts`

| Hook | Event | Purpose |
|------|-------|---------|
| contextWindowMonitor | session.idle | Track context window usage |
| preemptiveCompaction | session.idle | Trigger compaction before limit |
| sessionRecovery | session.error | Auto-retry on recoverable errors |
| sessionNotification | session.idle | OS notifications on completion |
| thinkMode | chat.params | Model variant switching (extended thinking) |
| anthropicContextWindowLimitRecovery | session.error | Multi-strategy context recovery (truncation, compaction) |
| autoUpdateChecker | session.created | Check npm for plugin updates |
| agentUsageReminder | chat.message | Remind about available agents |
| nonInteractiveEnv | chat.message | Adjust behavior for `run` command |
| interactiveBashSession | tool.execute | Tmux session for interactive tools |
| ralphLoop | event | Self-referential dev loop (boulder continuation) |
| editErrorRecovery | tool.execute.after | Retry failed file edits |
| delegateTaskRetry | tool.execute.after | Retry failed task delegations |
| startWork | chat.message | `/start-work` command handler |
| prometheusMdOnly | tool.execute.before | Enforce .md-only writes for Prometheus |
| sisyphusJuniorNotepad | chat.message | Notepad injection for subagents |
| questionLabelTruncator | tool.execute.before | Truncate long question labels |
| taskResumeInfo | chat.message | Inject task context on resume |
| anthropicEffort | chat.params | Adjust reasoning effort level |
| jsonErrorRecovery | tool.execute.after | Detect JSON parse errors, inject correction reminder |
| sisyphusGptHephaestusReminder | chat.message | Toast warning when Sisyphus uses GPT model |
| taskReminder | tool.execute.after | Remind about task tools after 10 turns without usage |

### Tier 2: Tool Guard Hooks (9) — `create-tool-guard-hooks.ts`

| Hook | Event | Purpose |
|------|-------|---------|
| commentChecker | tool.execute.after | Block AI-generated comment patterns |
| toolOutputTruncator | tool.execute.after | Truncate oversized tool output |
| directoryAgentsInjector | tool.execute.before | Inject dir AGENTS.md into context |
| directoryReadmeInjector | tool.execute.before | Inject dir README.md into context |
| emptyTaskResponseDetector | tool.execute.after | Detect empty task responses |
| rulesInjector | tool.execute.before | Conditional rules injection (AGENTS.md, config) |
| tasksTodowriteDisabler | tool.execute.before | Disable TodoWrite when task system active |
| writeExistingFileGuard | tool.execute.before | Require Read before Write on existing files |
| hashlineReadEnhancer | tool.execute.after | Enhance Read output with line hashes |

### Tier 3: Transform Hooks (4) — `create-transform-hooks.ts`

| Hook | Event | Purpose |
|------|-------|---------|
| claudeCodeHooks | messages.transform | Claude Code settings.json compatibility |
| keywordDetector | messages.transform | Detect ultrawork/search/analyze modes |
| contextInjectorMessagesTransform | messages.transform | Inject AGENTS.md/README.md into context |
| thinkingBlockValidator | messages.transform | Validate thinking block structure |

### Tier 4: Continuation Hooks (7) — `create-continuation-hooks.ts`

| Hook | Event | Purpose |
|------|-------|---------|
| stopContinuationGuard | chat.message | `/stop-continuation` command handler |
| compactionContextInjector | session.compacted | Re-inject context after compaction |
| compactionTodoPreserver | session.compacted | Preserve todos through compaction |
| todoContinuationEnforcer | session.idle | **Boulder**: force continuation on incomplete todos |
| unstableAgentBabysitter | session.idle | Monitor unstable agent behavior |
| backgroundNotificationHook | event | Background task completion notifications |
| atlasHook | event | Master orchestrator for boulder/background sessions |

### Tier 5: Skill Hooks (2) — `create-skill-hooks.ts`

| Hook | Event | Purpose |
|------|-------|---------|
| categorySkillReminder | chat.message | Remind about category+skill delegation |
| autoSlashCommand | chat.message | Auto-detect `/command` in user input |

## KEY HOOKS (COMPLEX)

### anthropic-context-window-limit-recovery (31 files, ~2232 LOC)
Multi-strategy recovery when hitting context limits. Strategies: truncation, compaction, summarization.

### atlas (17 files, ~1976 LOC)
Master orchestrator for boulder sessions. Decision gates: session type → abort check → failure count → background tasks → agent match → plan completeness → cooldown (5s). Injects continuation prompts on session.idle.

### ralph-loop (14 files, ~1687 LOC)
Self-referential dev loop via `/ralph-loop` command. State persisted in `.sisyphus/ralph-loop.local.md`. Detects `<promise>DONE</promise>` in AI output. Max 100 iterations default.

### todo-continuation-enforcer (13 files, ~2061 LOC)
"Boulder" mechanism. Forces agent to continue when todos remain incomplete. 2s countdown toast → continuation injection. Exponential backoff: 30s base, ×2 per failure, max 5 consecutive failures then 5min pause.

### keyword-detector (~1665 LOC)
Detects modes from user input: ultrawork, search, analyze, prove-yourself. Injects mode-specific system prompts.

### rules-injector (19 files, ~1604 LOC)
Conditional rules injection from AGENTS.md, config, skill rules. Evaluates conditions to determine which rules apply.

## STANDALONE HOOKS (in src/hooks/ root)

| File | Purpose |
|------|---------|
| context-window-monitor.ts | Track context window percentage |
| preemptive-compaction.ts | Trigger compaction before hard limit |
| tool-output-truncator.ts | Truncate tool output by token count |
| session-notification.ts + 4 helpers | OS notification on session completion |
| empty-task-response-detector.ts | Detect empty/failed task responses |
| session-todo-status.ts | Todo completion status tracking |

## HOW TO ADD A HOOK

1. Create `src/hooks/{name}/index.ts` with `createXXXHook(deps)` factory
2. Register in appropriate tier file (`src/plugin/hooks/create-{tier}-hooks.ts`)
3. Add hook name to `src/config/schema/hooks.ts` HookNameSchema
4. Hook receives `(event, ctx)` — return value depends on event type

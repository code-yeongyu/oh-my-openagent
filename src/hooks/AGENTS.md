# src/hooks/ — ~50 Lifecycle Hooks Across 57 Dirs

**Generated:** 2026-05-08

## OVERVIEW

50 hooks (7 of the 57 dirs are `zauc-mocks-*` test scaffolds + 1 `shared/`). 5-tier composition wired in `src/plugin/hooks/`. All hooks follow `createXXXHook(deps) → HookFunction` factory pattern.

## TIER COMPOSITION

| Tier | Composer | Count | When |
|------|----------|-------|------|
| **Session** | `create-session-hooks.ts` | 24 | OpenCode session lifecycle (created/idle/error/status) + chat.params + chat.message |
| **Tool Guard** | `create-tool-guard-hooks.ts` | 14 | Pre/post tool execution |
| **Transform** | `create-transform-hooks.ts` | 5 | `experimental.chat.messages.transform` |
| **Continuation** | `create-continuation-hooks.ts` | 7 | Boulder/atlas/compaction/notification |
| **Skill** | `create-skill-hooks.ts` | 2 | Skill awareness (categorySkillReminder, autoSlashCommand) |
| **Team-mode** | conditional in registries | 4 | When `team_mode.enabled`: team-mailbox-injector, team-mode-status-injector, team-session-events, team-tool-gating |

### Tier 1: Session Hooks (24)

| Hook | Event | Purpose |
|------|-------|---------|
| `contextWindowMonitor` | session.idle | Track context usage |
| `preemptiveCompaction` | session.idle | Trigger compaction before limit |
| `sessionRecovery` | session.error | Recover from structural errors (tool_result_missing, thinking_block_order) |
| `sessionNotification` | session.idle | OS notifications on completion |
| `thinkMode` | chat.params | Model variant switching for extended thinking |
| `anthropicContextWindowLimitRecovery` | session.error | Multi-strategy context recovery (truncation, compaction, dedup) |
| `autoUpdateChecker` | session.created | Check npm for plugin updates |
| `agentUsageReminder` | chat.message | Remind about available agents |
| `nonInteractiveEnv` | chat.message | Adjust behavior for `run` command |
| `interactiveBashSession` | tool.execute | Tmux session lifecycle for interactive_bash tool |
| `ralphLoop` | event | Self-referential dev loop (boulder continuation) |
| `editErrorRecovery` | tool.execute.after | Retry failed file edits |
| `delegateTaskRetry` | tool.execute.after | Retry failed task delegations |
| `startWork` | chat.message | `/start-work` command handler |
| `prometheusMdOnly` | tool.execute.before | Enforce .md-only writes for Prometheus |
| `sisyphusJuniorNotepad` | chat.message | Notepad injection for subagents |
| `questionLabelTruncator` | tool.execute.before | Truncate long Question tool labels |
| `taskResumeInfo` | chat.message | Inject task context on resume |
| `anthropicEffort` | chat.params | Adjust reasoning effort level |
| `modelFallback` | chat.params | Provider-level proactive model fallback |
| `noSisyphusGpt` | chat.message | Block Sisyphus from non-GPT providers (with warning toast) |
| `noHephaestusNonGpt` | chat.message | Block Hephaestus from non-GPT models |
| `runtimeFallback` | event | Reactive auto-switch on API provider errors |
| `legacyPluginToast` | chat.message | Show toast when legacy plugin name detected |

### Tier 2: Tool Guard Hooks (14)

| Hook | Event | Purpose |
|------|-------|---------|
| `commentChecker` | tool.execute.after | Block AI-slop comment patterns (binary: `@code-yeongyu/comment-checker`) |
| `toolOutputTruncator` | tool.execute.after | Truncate oversized tool output |
| `directoryAgentsInjector` | tool.execute.before | Inject dir-local AGENTS.md into context |
| `directoryReadmeInjector` | tool.execute.before | Inject dir-local README.md into context |
| `emptyTaskResponseDetector` | tool.execute.after | Detect empty task results |
| `rulesInjector` | tool.execute.before | Conditional rules injection (AGENTS.md, .rules) |
| `tasksTodowriteDisabler` | tool.execute.before | Disable TodoWrite when Sisyphus task system active |
| `writeExistingFileGuard` | tool.execute.before | Require Read before Write/Edit on existing files |
| `bashFileReadGuard` | tool.execute.before | Guard bash commands that read files (cat/head/tail) |
| `readImageResizer` | tool.execute.after | Resize large images for context efficiency |
| `todoDescriptionOverride` | tool.execute.before | Override todo item descriptions |
| `webfetchRedirectGuard` | tool.execute.before | Guard webfetch redirect behavior |
| `hashlineReadEnhancer` | tool.execute.after | Tag every Read output with `LINE#ID` content hashes |
| `jsonErrorRecovery` | tool.execute.after | Detect JSON parse errors, inject correction reminder |

### Tier 3: Transform Hooks (5)

| Hook | Event | Purpose |
|------|-------|---------|
| `claudeCodeHooks` | messages.transform | Claude Code settings.json compatibility |
| `keywordDetector` | messages.transform | Detect ultrawork/search/analyze/team modes; inject mode-specific prompt |
| `contextInjectorMessagesTransform` | messages.transform | Inject AGENTS.md/README.md into context |
| `thinkingBlockValidator` | messages.transform | Validate thinking block structure |
| `toolPairValidator` | messages.transform | Validate tool call/result pairing |

### Tier 4: Continuation Hooks (7)

| Hook | Event | Purpose |
|------|-------|---------|
| `stopContinuationGuard` | chat.message | `/stop-continuation` command handler |
| `compactionContextInjector` | session.compacted | Re-inject context after compaction |
| `compactionTodoPreserver` | session.compacted | Preserve todos through compaction |
| `todoContinuationEnforcer` | session.idle | **Boulder** — force continuation on incomplete todos |
| `unstableAgentBabysitter` | session.idle | Monitor unstable agent behavior |
| `backgroundNotificationHook` | event | Background task completion notifications |
| `atlasHook` | event | Master orchestrator for boulder/background sessions |

### Tier 5: Skill Hooks (2)

| Hook | Event | Purpose |
|------|-------|---------|
| `categorySkillReminder` | chat.message | Hint to load skills before invoking categories |
| `autoSlashCommand` | chat.message | Auto-execute matching `/command` from user message |

### Team-mode Hooks (4, conditional)

Activated only when `team_mode.enabled: true`:

| Hook | Tier | Purpose |
|------|------|---------|
| `team-mode-status-injector` | Transform | Inject `<team_mode_status>` block into messages |
| `team-mailbox-injector` | Transform | Pull pending team mailbox messages into agent context |
| `team-session-events` | Continuation | React to member session lifecycle (created/idle/deleted) |
| `team-tool-gating` | Tool Guard | Restrict `team_*` tools based on member role + permissions |

## STRUCTURE

```
hooks/
├── shared/                                  # Cross-hook helpers (timing, prompt builders, etc.)
├── (50 hook directories — see tier tables above)
├── zauc-mocks-bg, zauc-mocks-cache, …       # Test mocks (NOT hooks; named for sort-order isolation)
└── (each hook dir)/
    ├── index.ts        # createXXXHook factory + barrel
    ├── *.ts            # implementation
    └── *.test.ts       # bun:test
```

## ADDING A NEW HOOK

1. `mkdir src/hooks/{name}` + `index.ts` exporting `createXXXHook(deps)`
2. Pick the right tier:
   - Session lifecycle? → `create-session-hooks.ts`
   - Pre/post tool? → `create-tool-guard-hooks.ts`
   - Message transform? → `create-transform-hooks.ts`
   - Continuation/idle? → `create-continuation-hooks.ts`
   - Skill awareness? → `create-skill-hooks.ts`
   - Team-mode-only? → register inside the team-mode conditional block
3. Add hook name to [`config/schema/hooks.ts`](file:///Users/yeongyu/local-workspaces/omo/src/config/schema/hooks.ts) `HookNameSchema`
4. Cover with co-located `*.test.ts` (given/when/then style)

## NOTES

- **Tier order matters within a phase:** within Session tier the registration order in `create-session-hooks.ts` determines invocation order — earlier hooks see un-mutated input, later hooks see accumulated output.
- **Mock files** (`zauc-mocks-*`, `zauc-sync-mocks`) are NOT hooks. They are placed inside `src/hooks/` purely so `bun:test` discovers them in the right order — auto-isolated by `script/run-ci-tests.ts` because they use `mock.module()`.
- **`atlasHook` vs `todoContinuationEnforcer`:** atlas handles boulder/ralph/subagent sessions, todoContinuationEnforcer handles the main Sisyphus session. Both fire on `session.idle` but check session type first.
- **`runtime-fallback` vs `model-fallback`:** runtime-fallback is reactive (after error); model-fallback is proactive (chat.params). They operate independently.

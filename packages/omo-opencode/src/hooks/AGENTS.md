# src/hooks/ -- ~54 Lifecycle Hooks Across 62 Dirs

**Generated:** 2026-07-17

## OVERVIEW

54 base registered hooks on default config (61 with team-mode; `monitor-status-injector` adds 1 more with `monitor.enabled` → 62 max), composed from 54 `index.ts` hook dirs (52 wired; `task-reminder/` and `ralph-loop/` unwired) plus 5 standalone hook `.ts` files at the `src/hooks/` top level (bash-file-read-guard, empty-task-response-detector, preemptive-compaction, session-notification, tool-output-truncator). The 62 directories = 54 with `index.ts` + 8 without (`shared/`, `team-session-events/`, `hashline-edit-diff-enhancer/` unwired, and 5 `zauc-mocks-*`/`zauc-sync-mocks`). 5-tier composition wired in `src/plugin/hooks/`. All hooks follow `createXXXHook(deps) -> HookFunction` factory pattern.

**Unwired WIP (do not modify casually):** `task-reminder/` (has `index.ts` + `createTaskReminderHook` but NOT exported from barrel, NOT imported by any composer), `ralph-loop/` (exported from barrel but NOT imported by any composer; retained for migration, superseded by `goal/`), and `hashline-edit-diff-enhancer/` (has only `hook.ts`, NOT registered). Treat as orphaned until wired in.

## TIER COMPOSITION

| Tier | Composer | Base | With team-mode | Where |
|------|----------|------|----------------|-------|
| **Session** | `create-session-hooks.ts` | 24 | 24 | OpenCode session lifecycle + chat.params + chat.message |
| **Tool Guard** | `create-tool-guard-hooks.ts` | 17 | 18 | Pre/post tool execution (+1: `team-tool-gating`) |
| **Transform** | `create-transform-hooks.ts` | 4 | 6 | `experimental.chat.messages.transform` (+2: `team-mode-status-injector`, `team-mailbox-injector`; `monitor-status-injector` is a further +1 gated on `monitor.enabled`, not team-mode) |
| **Continuation** | `create-continuation-hooks.ts` | 7 | 7 | Boulder/atlas/compaction/notification |
| **Skill** | `create-skill-hooks.ts` | 2 | 2 | Skill awareness (categorySkillReminder, autoSlashCommand) |
| **Direct event handlers** | `src/plugin/event.ts` | 0 | +4 | `team-session-events/` sub-files: `team-idle-wake-hint`, `team-lead-orphan-handler`, `team-member-error-handler`, `team-member-status-handler` |

Total exposed hooks: **54 base, 61 with team-mode, 62 with team-mode + monitor** (counts the 4 team-session-events handlers individually).

Hook name allowlist for `disabled_hooks`: all configurable hook names enumerated in [`src/config/schema/hooks.ts`](../config/schema/hooks.ts) `HookNameSchema`. Team-session-event sub-hooks are not individually listed in the schema -- they activate together with `team_mode.enabled`.

### Tier 1: Session Hooks (24)

| Hook | Event | Purpose |
|------|-------|---------|
| `preemptiveCompaction` | session.idle | Trigger compaction before limit |
| `sessionNotification` | session.idle | OS notifications on completion |
| `thinkMode` | chat.params | Model variant switching for extended thinking |
| `anthropicContextWindowLimitRecovery` | session.error | Multi-strategy context recovery (truncation, compaction, dedup) |
| `autoUpdateChecker` | session.created | Check npm for plugin updates |
| `codegraphBootstrap` | session.created | Bootstrap CodeGraph indexing for the project (pairs with the built-in `codegraph` MCP) |
| `astGrepSgProvision` | session.created | Provision the ast-grep `sg` binary for the bundled skill |
| `agentUsageReminder` | chat.message | Remind about available agents |
| `nonInteractiveEnv` | chat.message | Adjust behavior for `run` command |
| `interactiveBashSession` | tool.execute | Tmux session lifecycle for interactive_bash tool |
| `goal` | event | Persistent per-session objective; idle continuation + usage accounting. Replaces `ralphLoop` (see [`goal/AGENTS.md`](goal/AGENTS.md)) |
| `editErrorRecovery` | tool.execute.after | Retry failed file edits |
| `delegateTaskRetry` | tool.execute.after | Retry failed task delegations |
| `startWork` | chat.message | `/start-work` command handler |
| `prometheusMdOnly` | tool.execute.before | Enforce .md-only writes for Prometheus |
| `sisyphusJuniorNotepad` | chat.message | Notepad injection for subagents |
| `questionLabelTruncator` | tool.execute.before | Truncate long Question tool labels |
| `taskResumeInfo` | chat.message | Inject task context on resume |
| `modelFallback` | chat.params | Provider-level proactive model fallback |
| `noSisyphusGpt` | chat.message | Block Sisyphus from non-GPT providers (with warning toast) |
| `noHephaestusNonGpt` | chat.message | Block Hephaestus from non-GPT models |
| `hephaestusAgentsMdInjector` | chat.message | Inject walk-up AGENTS.md context for Hephaestus deep-work sessions |
| `runtimeFallback` | event | Reactive auto-switch on API provider errors |
| `legacyPluginToast` | chat.message | Show toast when legacy plugin name detected |

### Tier 2: Tool Guard Hooks (17)

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
| `fsyncSkipWarning` | tool.execute.after | Warn when fsync is skipped for atomic writes |
| `notepadWriteGuard` | tool.execute.before | Block `Write` to append-only notepad paths (`.omo/notepads`, `.sisyphus/notepads`) |
| `planFormatValidator` | tool.execute.before | Validate plan/todo checkbox format on `Write`/`Edit` of boulder plans |

### Tier 3: Transform Hooks (4 base + 1 monitor-gated)

| Hook | Event | Purpose |
|------|-------|---------|
| `claudeCodeHooks` | messages.transform | Claude Code settings.json compatibility |
| `keywordDetector` | messages.transform | Detect ultrawork/search/analyze/team modes; inject mode-specific prompt |
| `contextInjectorMessagesTransform` | messages.transform | Inject AGENTS.md/README.md into context |
| `toolPairValidator` | messages.transform | Validate tool call/result pairing |
| `monitorStatusInjector` | messages.transform | Inject running Monitor watch status into context (`monitor.enabled`) |

### Tier 4: Continuation Hooks (7)

| Hook | Event | Purpose |
|------|-------|---------|
| `stopContinuationGuard` | chat.message | `/stop-continuation` command handler |
| `compactionContextInjector` | session.compacted | Re-inject context after compaction |
| `compactionTodoPreserver` | session.compacted | Preserve todos through compaction |
| `todoContinuationEnforcer` | session.idle | **Boulder** -- force continuation on incomplete todos |
| `unstableAgentBabysitter` | session.idle | Monitor unstable agent behavior |
| `backgroundNotificationHook` | event | Background task completion notifications |
| `atlasHook` | event | Master orchestrator for boulder/background sessions |

### Tier 5: Skill Hooks (2)

| Hook | Event | Purpose |
|------|-------|---------|
| `categorySkillReminder` | chat.message | Hint to load skills before invoking categories |
| `autoSlashCommand` | chat.message | Auto-execute matching `/command` from user message |

### Team-mode Hooks (conditional, only when `team_mode.enabled: true`)

| Hook | Tier | Registered In | Purpose |
|------|------|---------------|---------|
| `team-mode-status-injector` | Transform | [`create-transform-hooks.ts`](../plugin/hooks/create-transform-hooks.ts) | Inject `<team_mode_status>` block into messages |
| `team-mailbox-injector` | Transform | [`create-transform-hooks.ts`](../plugin/hooks/create-transform-hooks.ts) | Pull pending team mailbox messages into agent context |
| `team-tool-gating` | Tool Guard | [`create-tool-guard-hooks.ts`](../plugin/hooks/create-tool-guard-hooks.ts) | Restrict `team_*` tools based on member role + permissions |
| `team-idle-wake-hint` | event handler | [`src/plugin/event.ts`](../plugin/event.ts) | Nudge idle team members back to work |
| `team-lead-orphan-handler` | event handler | [`src/plugin/event.ts`](../plugin/event.ts) | Detect lead departure → orphan members |
| `team-member-error-handler` | event handler | [`src/plugin/event.ts`](../plugin/event.ts) | React to member session errors |
| `team-member-status-handler` | event handler | [`src/plugin/event.ts`](../plugin/event.ts) | Track member status transitions |

The 4 `team-session-events/` handlers live in `src/hooks/team-session-events/` (separate files: `team-idle-wake-hint.ts`, `team-lead-orphan-handler.ts`, `team-member-error-handler.ts`, `team-member-status-handler.ts`) and are wired into `src/plugin/event.ts` directly, not through a tier composer.

## STRUCTURE

```
hooks/
├── shared/                                  # Cross-hook helpers (timing, prompt builders, etc.)
├── team-session-events/                     # 4 team event handlers (wired via src/plugin/event.ts)
├── (54 index.ts hook directories incl. `task-reminder/` and `ralph-loop/` unwired -- see tier tables above)
├── zauc-mocks-{bg,cache,hook,ws}, zauc-sync-mocks  # 5 test mocks (NOT hooks; named for sort-order isolation)
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
3. Add hook name to [`config/schema/hooks.ts`](../config/schema/hooks.ts) `HookNameSchema`
4. Cover with co-located `*.test.ts` (given/when/then style)

## NOTES

- **Tier order matters within a phase:** within Session tier the registration order in `create-session-hooks.ts` determines invocation order -- earlier hooks see un-mutated input, later hooks see accumulated output.
- **Mock files** (`zauc-mocks-*`, `zauc-sync-mocks`) are NOT hooks. They are placed inside `src/hooks/` purely so `bun:test` discovers them with the hook test fixtures.
- **`atlasHook` vs `todoContinuationEnforcer`:** atlas handles boulder/ralph/subagent sessions, todoContinuationEnforcer handles the main Sisyphus session. Both fire on `session.idle` but check session type first.
- **`runtime-fallback` vs `model-fallback`:** runtime-fallback is reactive (after error); model-fallback is proactive (chat.params). They operate independently.
- **`goal` replaces `ralphLoop` (PR #6184):** `ralphLoop` was removed from `HookNameSchema` and `create-session-hooks.ts`; the `/ralph-loop`, `/ulw-loop`, `/cancel-ralph` builtin commands were removed. The `ralph-loop/` dir + `createRalphLoopHook` factory remain for migration (barrel export kept); `ralph_loop` config is a deprecated passthrough. See [`goal/AGENTS.md`](goal/AGENTS.md).

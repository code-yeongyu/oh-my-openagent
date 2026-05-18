# Fix Delegate-Task Subagent Permissions

## TL;DR
> Summary:      Fix OMO `task` so delegated subagents can use repo exploration tools in their child sessions without permission prompts or denials. Match OpenCode native Task semantics by deriving child-session permissions and prompt tools from the delegated agent instead of only denying `question`.
> Deliverables:
> - Shared subagent permission/tool builder with unit coverage
> - Sync delegate-task child-session permission fix
> - Background and unstable delegate-task permission fix
> - Regression coverage for `read`/`bash`/search access and write/tool delegation denial
> - Module QA plus real tmux/non-interactive QA evidence
> Effort:       Medium
> Risk:         Medium — permission rules affect delegated child-session execution and can accidentally over-allow tools if not scoped.

## Scope
### Must have
- Subagents launched through OMO `task` can call repo exploration tools such as `read`, `bash`, `grep`, and `glob` in child sessions.
- Sync child sessions are created with `parentID`, OpenCode-compatible title, model fields, directory route, and a derived permission ruleset.
- Background child sessions receive the same derived permission ruleset through `LaunchInput.sessionPermission`.
- Prompt bodies for sync, background launch, background resume, and fallback-agent retry use the same derived prompt tool map so `session.prompt` does not overwrite useful child-session permissions with deny-only rules.
- `question` remains denied for delegated child sessions.
- Read-only subagents still cannot write or recursively delegate: `write`, `edit`, `apply_patch`, `task`, and `call_omo_agent` remain denied where the delegated agent restrictions deny them.
- Existing task metadata contract remains intact: `sessionId` is published and visible task metadata still includes `session_id`.
- Regression tests prove both sync and background paths include explicit `allow` rules for exploration tools and explicit `deny` rules for restricted tools.
- Real tmux/manual QA proves an `explore` subagent launched by `task` can inspect files and run a harmless shell command without `"Permission required"` output.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- Do not disable OpenCode permission checks globally.
- Do not add `permission: "*", action: "allow"` or any broad wildcard allow.
- Do not grant write/edit/apply_patch to `explore`, `librarian`, or `oracle`.
- Do not refactor background polling, concurrency, wake gating, model fallback, or tmux layout.
- Do not change agent prompts, category model selection, metadata formatting, or task output text except where tests require permission metadata.
- Do not remove `getAgentToolRestrictions`; centralize the new derived session permission behavior around it or a closely related shared helper.
- Do not change the native OpenCode source under `../opencode`.

## Verification strategy
> Zero human intervention — all verification is agent-executed.
- Test decision: TDD + Bun test
- QA policy: every task has agent-executed scenarios
- Evidence: `evidence/task-<N>-<slug>.<ext>`

## Execution strategy
### Parallel execution waves
> Target 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks to maximize parallelism.

Wave 1 (no dependencies):
- Task 1: Add shared subagent permission/tool builder and focused unit tests
- Task 2: Add native-reference contract tests around existing permission fixtures

Wave 2 (after Wave 1):
- Task 3: depends [1, 2] - Wire sync delegate-task session creation and prompt body
- Task 4: depends [1, 2] - Wire background and unstable delegate-task launch path
- Task 5: depends [1] - Wire background resume and fallback-agent prompt bodies

Wave 3 (after Wave 2):
- Task 6: depends [3, 4, 5] - Run module QA and lock regression output
- Task 7: depends [3, 4, 5] - Run real tmux/manual QA for delegated exploration

Critical path: Task 1 -> Task 3 -> Task 6

### Dependency matrix
| Task | Depends on | Blocks | Can parallelize with |
|------|------------|--------|----------------------|
| 1    | none       | 3, 4, 5, 6, 7 | 2 |
| 2    | none       | 3, 4, 6, 7 | 1 |
| 3    | 1, 2       | 6, 7 | 4, 5 |
| 4    | 1, 2       | 6, 7 | 3, 5 |
| 5    | 1          | 6, 7 | 3, 4 |
| 6    | 3, 4, 5    | none | 7 |
| 7    | 3, 4, 5    | none | 6 |

## Todos
> Implementation + Test = ONE task. Never separate.
> Every task MUST have: References + Acceptance Criteria + QA Scenarios + Commit.

- [ ] 1. Add shared subagent permission/tool builder

  What to do: Create one focused helper, preferably `src/shared/subagent-session-permission.ts`, plus `src/shared/subagent-session-permission.test.ts`. The helper must produce both:
  - `buildSubagentSessionPermission(agentName, options): SessionPermissionRule[]`
  - `buildSubagentPromptTools(agentName, options): Record<string, boolean>`

  Required behavior:
  - Convert OMO permission-map values (`"allow" | "deny" | "ask"`) into OpenCode session rules (`{ permission, action, pattern: "*" }`).
  - Always include `{ permission: "question", action: "deny", pattern: "*" }`.
  - Add explicit `allow` rules for repo exploration tools when not denied by the agent: `read`, `bash`, `grep`, `glob`, `lsp_symbols`, `lsp_goto_definition`, `lsp_find_references`, `lsp_diagnostics`, `ast_grep_search`.
  - Apply agent/tool deny rules last so read-only restrictions win over defaults.
  - Preserve team-tool denylist behavior when `includeTeamToolDenylist` is true.
  - Do not add wildcard allow rules.

  Must NOT do: Do not change any call sites yet. Do not change agent definitions. Do not add a generic `utils.ts` or `helpers.ts`.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [3, 4, 5, 6, 7] | Blocked by: []

  References (executor has NO interview context — be exhaustive):
  - Pattern:  `src/shared/agent-tool-restrictions.ts:24` — current read-only denylist omits explicit `read`/`bash` allows, which leaves child sessions in ask/permission-required state.
  - Pattern:  `src/shared/agent-tool-restrictions.ts:66` — current `getAgentToolRestrictions()` is the source of prompt-body deny rules and team-tool deny rules.
  - Pattern:  `src/shared/question-denied-session-permission.ts:1` — current ruleset shape and `QUESTION_DENIED_SESSION_PERMISSION`.
  - Pattern:  `src/shared/permission-compat.ts:6` — OMO agent permission map value type.
  - Pattern:  `src/agents/explore.ts:27` — `explore` denies write/edit/apply_patch/task/call_omo_agent and explicitly allows some LSP/AST tools.
  - Pattern:  `src/agents/librarian.ts:24` — `librarian` denies write/edit/apply_patch/task/call_omo_agent.
  - External: `../opencode/packages/opencode/src/agent/subagent-permissions.ts:17` — native Task derives child-session permissions from parent and subagent rules.
  - External: `../opencode/packages/opencode/src/permission/evaluate.ts:9` — missing rule defaults to `ask`, which is the source of permission prompts/denials.
  - Test:     `src/agents/tool-restrictions.test.ts` — existing assertions around agent permission maps.

  Acceptance criteria (agent-executable only):
  - [ ] `bun test src/shared/subagent-session-permission.test.ts --bail` passes.
  - [ ] Test asserts `buildSubagentSessionPermission("explore")` contains `allow` for `read`, `bash`, `grep`, and `glob`.
  - [ ] Test asserts `buildSubagentSessionPermission("explore")` contains `deny` for `write`, `edit`, `apply_patch`, `task`, `call_omo_agent`, and `question`.
  - [ ] Test asserts no generated rule is `{ permission: "*", action: "allow", pattern: "*" }`.
  - [ ] Test asserts prompt tools mirror the permission intent: exploration tools `true`, restricted tools `false`.

  QA scenarios (MANDATORY — task incomplete without these):
  ```
  Scenario: explore permission builder allows read-only repo exploration
    Tool:     bash
    Steps:    mkdir -p evidence && bun test src/shared/subagent-session-permission.test.ts --bail > evidence/task-1-permission-builder.txt
    Expected: Exit 0, and test names mention read/bash exploration allow plus write/edit denial.
    Evidence: evidence/task-1-permission-builder.txt

  Scenario: builder rejects overbroad wildcard allow
    Tool:     bash
    Steps:    rg -n 'permission: "\\*", action: "allow"|\\["\\*", true\\]' src/shared/subagent-session-permission.ts src/shared/subagent-session-permission.test.ts > evidence/task-1-wildcard-scan.txt; test ! -s evidence/task-1-wildcard-scan.txt
    Expected: Exit 0 and evidence file is empty.
    Evidence: evidence/task-1-wildcard-scan.txt
  ```

  Commit: YES | Message: `fix(task): derive subagent exploration permissions` | Files: [`src/shared/subagent-session-permission.ts`, `src/shared/subagent-session-permission.test.ts`]

- [ ] 2. Add native-reference contract tests around current fixtures

  What to do: Update current permission tests so they describe the native-compatible contract before wiring code:
  - `src/tools/delegate-task/sync-session-creator.test.ts`
  - `src/tools/delegate-task/background-task.test.ts`
  - `src/features/background-agent/manager-session-permission.test.ts`

  The tests must assert that child session creation receives a permission ruleset with explicit exploration allows and restricted-tool denies. Keep existing title, `parentID`, and directory assertions.

  Must NOT do: Do not make broad behavior changes in this task except the minimal helper import needed if Task 1 already exists. Do not delete the old `question` denial assertion; update it into the larger ruleset.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [3, 4, 6, 7] | Blocked by: []

  References (executor has NO interview context — be exhaustive):
  - Pattern:  `src/tools/delegate-task/sync-session-creator.test.ts:5` — current sync child-session test only expects `question` deny.
  - Pattern:  `src/tools/delegate-task/background-task.test.ts:209` — current delegate background launch test only expects `question` deny in `sessionPermission`.
  - Pattern:  `src/features/background-agent/manager-session-permission.test.ts:84` — manager-level test asserts explicit session permission rules are passed into `session.create`.
  - External: `../opencode/packages/opencode/src/tool/task.ts:152` — native Task creates child session with `parentID`, title, and derived permission.
  - External: `../opencode/packages/opencode/src/tool/task.ts:178` — native Task metadata includes child `sessionId`.

  Acceptance criteria (agent-executable only):
  - [ ] `bun test src/tools/delegate-task/sync-session-creator.test.ts src/tools/delegate-task/background-task.test.ts src/features/background-agent/manager-session-permission.test.ts --bail` initially fails before Tasks 3 and 4 if run after only test edits.
  - [ ] Tests assert `parentID` and title stay unchanged.
  - [ ] Tests assert permission arrays contain `allow` for `read` and `bash`.
  - [ ] Tests assert permission arrays contain `deny` for `question`, `write`, `edit`, `apply_patch`, and `task`.

  QA scenarios (MANDATORY — task incomplete without these):
  ```
  Scenario: contract tests capture the regression
    Tool:     bash
    Steps:    mkdir -p evidence && bun test src/tools/delegate-task/sync-session-creator.test.ts src/tools/delegate-task/background-task.test.ts src/features/background-agent/manager-session-permission.test.ts --bail > evidence/task-2-contract-tests.txt || true
    Expected: Evidence shows the new expectations before implementation, or passes if Task 3/4 are already applied by parallel execution.
    Evidence: evidence/task-2-contract-tests.txt

  Scenario: existing metadata contract remains present
    Tool:     bash
    Steps:    rg -n 'session_id|sessionId|parentID|@\\$\\{.*subagent|@explore subagent' src/tools/delegate-task/sync-session-creator.test.ts src/tools/delegate-task/background-task.test.ts src/features/background-agent/manager-session-permission.test.ts > evidence/task-2-metadata-contract.txt
    Expected: Evidence includes session lineage/title assertions, not only permission assertions.
    Evidence: evidence/task-2-metadata-contract.txt
  ```

  Commit: YES | Message: `test(task): pin subagent session permission contract` | Files: [`src/tools/delegate-task/sync-session-creator.test.ts`, `src/tools/delegate-task/background-task.test.ts`, `src/features/background-agent/manager-session-permission.test.ts`]

- [ ] 3. Wire sync delegate-task session creation and prompt body

  What to do:
  - Update `createSyncSession()` to accept an optional `sessionPermission` argument and use it instead of hardcoded `QUESTION_DENIED_SESSION_PERMISSION`.
  - Update `executeSyncTask()` to pass `buildSubagentSessionPermission(agentToUse, ...)` on initial child session creation and retry child session creation.
  - Update `sendSyncPrompt()` to use `buildSubagentPromptTools(agentToUse, { allowTask })` rather than assembling a deny-only map inline.
  - Keep `setSessionTools()` and `applySessionPromptParams()` behavior.
  - Keep `routePromptRetry()` and `routePromptSyncRetry()` behavior unchanged.

  Must NOT do: Do not alter polling, fetch result, fallback selection, metadata formatting, or `promptAsync` gate behavior.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [6, 7] | Blocked by: [1, 2]

  References (executor has NO interview context — be exhaustive):
  - Pattern:  `src/tools/delegate-task/sync-session-creator.ts:20` — current sync child session creation hardcodes `QUESTION_DENIED_SESSION_PERMISSION`.
  - Pattern:  `src/tools/delegate-task/sync-task.ts:88` — initial sync child session is created here.
  - Pattern:  `src/tools/delegate-task/sync-task.ts:264` — fallback retry creates another sync child session and must receive the same derived permission rules.
  - Pattern:  `src/tools/delegate-task/sync-prompt-sender.ts:70` — prompt body currently builds tools from `getAgentToolRestrictions()` only.
  - Pattern:  `src/tools/delegate-task/sync-prompt-route.test.ts:16` — existing route tests must keep passing.
  - External: `../opencode/packages/opencode/src/tool/task.ts:194` — native Task prompts `nextSession.id`, not parent session.
  - External: `../opencode/packages/opencode/src/session/prompt.ts:1622` — prompt `tools` are converted into session permission rules, so prompt body must not erase exploration allows.

  Acceptance criteria (agent-executable only):
  - [ ] `bun test src/tools/delegate-task/sync-session-creator.test.ts src/tools/delegate-task/sync-prompt-sender.test.ts src/tools/delegate-task/sync-prompt-route.test.ts src/tools/delegate-task/sync-task.test.ts --bail` passes.
  - [ ] `createSyncSession()` tests prove sync child session body includes `allow` rules for `read` and `bash`.
  - [ ] `sendSyncPrompt()` tests prove prompt body tools include `read: true`, `bash: true`, `grep: true`, `glob: true`, `question: false`, and `write/edit/apply_patch/task` false for `explore`.
  - [ ] Sync route tests still prove prompts are routed to the child session directory.
  - [ ] Retry path tests prove fallback child sessions also receive derived permission rules.

  QA scenarios (MANDATORY — task incomplete without these):
  ```
  Scenario: sync task creates an exploration-capable child session
    Tool:     bash
    Steps:    mkdir -p evidence && bun test src/tools/delegate-task/sync-session-creator.test.ts src/tools/delegate-task/sync-prompt-sender.test.ts src/tools/delegate-task/sync-prompt-route.test.ts src/tools/delegate-task/sync-task.test.ts --bail > evidence/task-3-sync-permissions.txt
    Expected: Exit 0; evidence contains passing sync permission and prompt-body tests.
    Evidence: evidence/task-3-sync-permissions.txt

  Scenario: sync prompt still denies recursive delegation and writes
    Tool:     bash
    Steps:    bun test src/tools/delegate-task/sync-prompt-sender.test.ts --bail > evidence/task-3-sync-denies.txt
    Expected: Exit 0; tests assert `task`, `call_omo_agent`, `write`, `edit`, and `apply_patch` are false for read-only subagents.
    Evidence: evidence/task-3-sync-denies.txt
  ```

  Commit: YES | Message: `fix(task): pass derived permissions to sync subagents` | Files: [`src/tools/delegate-task/sync-session-creator.ts`, `src/tools/delegate-task/sync-task.ts`, `src/tools/delegate-task/sync-prompt-sender.ts`, related tests]

- [ ] 4. Wire background and unstable delegate-task launch path

  What to do:
  - Update `executeBackgroundTask()` to pass `buildSubagentSessionPermission(normalizedAgent, ...)` into `manager.launch()`.
  - Update `executeUnstableAgentTask()` to pass the same derived permission builder into `manager.launch()`.
  - Update `BackgroundManager`/`startTask()` permission tests to expect derived session permissions.
  - Keep `LaunchInput.sessionPermission` optional for other callers.
  - Keep background metadata and `buildTaskMetadataBlock()` output unchanged.

  Must NOT do: Do not change background task concurrency, polling, idle detection, parent wake notification, or cancellation behavior.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [6, 7] | Blocked by: [1, 2]

  References (executor has NO interview context — be exhaustive):
  - Pattern:  `src/tools/delegate-task/background-task.ts:116` — background delegate-task launch currently passes only `QUESTION_DENIED_SESSION_PERMISSION`.
  - Pattern:  `src/tools/delegate-task/unstable-agent-task.ts:32` — unstable-agent path also passes only `QUESTION_DENIED_SESSION_PERMISSION`.
  - Pattern:  `src/features/background-agent/types.ts:102` — `LaunchInput.sessionPermission` type is already the correct extension point.
  - Pattern:  `src/features/background-agent/spawner.ts:100` — `startTask()` passes `input.sessionPermission` into `client.session.create`.
  - Test:     `src/tools/delegate-task/background-task.test.ts:209` — update this existing background permission assertion.
  - Test:     `src/tools/delegate-task/unstable-agent-permission.test.ts` — update unstable path assertion.
  - Test:     `src/features/background-agent/manager-session-permission.test.ts:84` — manager-level permission passthrough coverage.

  Acceptance criteria (agent-executable only):
  - [ ] `bun test src/tools/delegate-task/background-task.test.ts src/tools/delegate-task/unstable-agent-permission.test.ts src/features/background-agent/manager-session-permission.test.ts --bail` passes.
  - [ ] Background launch tests assert `manager.launch().sessionPermission` includes `read`/`bash` allows for `explore`.
  - [ ] Background launch tests assert write/edit/apply_patch/task/call_omo_agent/question denies remain.
  - [ ] Manager passthrough test proves `client.session.create().body.permission` receives the derived ruleset exactly.

  QA scenarios (MANDATORY — task incomplete without these):
  ```
  Scenario: background launch passes derived permissions through manager
    Tool:     bash
    Steps:    mkdir -p evidence && bun test src/tools/delegate-task/background-task.test.ts src/tools/delegate-task/unstable-agent-permission.test.ts src/features/background-agent/manager-session-permission.test.ts --bail > evidence/task-4-background-permissions.txt
    Expected: Exit 0; evidence shows background and unstable permission tests pass.
    Evidence: evidence/task-4-background-permissions.txt

  Scenario: background metadata remains OpenCode-compatible
    Tool:     bash
    Steps:    bun test src/tools/delegate-task/background-task.test.ts --bail > evidence/task-4-background-metadata.txt
    Expected: Exit 0; existing metadata tests still pass and visible output contains `session_id`.
    Evidence: evidence/task-4-background-metadata.txt
  ```

  Commit: YES | Message: `fix(task): pass derived permissions to background subagents` | Files: [`src/tools/delegate-task/background-task.ts`, `src/tools/delegate-task/unstable-agent-task.ts`, `src/features/background-agent/manager-session-permission.test.ts`, related tests]

- [ ] 5. Wire background resume and fallback prompt bodies

  What to do:
  - Update `src/features/background-agent/spawner.ts` initial prompt body, resume prompt body, and fallback-agent prompt body to use `buildSubagentPromptTools()`.
  - Keep `includeTeamToolDenylist: input.teamRunId === undefined` behavior.
  - Keep fallback agent behavior, `releasePromptAsyncReservation()`, and `task.agent = FALLBACK_AGENT` unchanged.
  - Add tests that `promptAsync` body for launch and resume includes `read: true`, `bash: true`, and restricted-tool denies for `explore`.

  Must NOT do: Do not change session creation, concurrency release, tmux callback timing, or fallback-agent selection.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [6, 7] | Blocked by: [1]

  References (executor has NO interview context — be exhaustive):
  - Pattern:  `src/features/background-agent/spawner.ts:158` — initial background prompt body currently builds tool map inline.
  - Pattern:  `src/features/background-agent/spawner.ts:29` — fallback prompt body currently builds a second inline tool map.
  - Pattern:  `src/features/background-agent/spawner.ts:299` — resume prompt body currently builds another inline tool map.
  - Test:     `src/features/background-agent/manager-session-permission.test.ts:9` — already captures prompt route and can be extended or paired with a new focused test.
  - External: `../opencode/packages/opencode/src/session/prompt.ts:1622` — prompt body tools become session permission rules.

  Acceptance criteria (agent-executable only):
  - [ ] `bun test src/features/background-agent/manager-session-permission.test.ts src/features/background-agent/manager.test.ts src/features/background-agent/spawner.test.ts --bail` passes, or if `manager.test.ts` is too broad/slow, record the narrower replacement command in evidence.
  - [ ] A launch prompt test asserts exploration tools are explicitly true and restricted tools false.
  - [ ] A resume prompt test asserts the same tool map contract.
  - [ ] Existing fallback-agent retry tests still pass.

  QA scenarios (MANDATORY — task incomplete without these):
  ```
  Scenario: background launch prompt keeps exploration tools enabled
    Tool:     bash
    Steps:    mkdir -p evidence && bun test src/features/background-agent/manager-session-permission.test.ts --bail > evidence/task-5-background-prompt-tools.txt
    Expected: Exit 0; evidence includes prompt body assertions for read/bash and restricted-tool denies.
    Evidence: evidence/task-5-background-prompt-tools.txt

  Scenario: no prompt gate or fallback routing regression
    Tool:     bash
    Steps:    bun test src/features/background-agent/manager.test.ts src/features/background-agent/spawner.test.ts --bail > evidence/task-5-background-manager.txt
    Expected: Exit 0, or if pre-existing unrelated failures occur, evidence includes exact failing test names and a narrower passing command that covers spawner prompt behavior.
    Evidence: evidence/task-5-background-manager.txt
  ```

  Commit: YES | Message: `fix(background-agent): keep exploration tools enabled in subagent prompts` | Files: [`src/features/background-agent/spawner.ts`, `src/features/background-agent/manager-session-permission.test.ts`, related tests]

- [ ] 6. Run module QA and lock regression evidence

  What to do:
  - Run focused delegate-task/background-agent tests.
  - Run typecheck.
  - Run the full root test suite if focused tests and typecheck pass.
  - Capture evidence files and summarize failures only if unrelated/pre-existing.

  Must NOT do: Do not fix unrelated failures. Do not weaken tests to pass. Do not skip typecheck.

  Parallelization: Can parallel: YES | Wave 3 | Blocks: [] | Blocked by: [3, 4, 5]

  References (executor has NO interview context — be exhaustive):
  - Command:  `bun test src/tools/delegate-task/sync-session-creator.test.ts src/tools/delegate-task/sync-prompt-sender.test.ts src/tools/delegate-task/sync-prompt-route.test.ts src/tools/delegate-task/sync-task.test.ts src/tools/delegate-task/background-task.test.ts src/tools/delegate-task/unstable-agent-permission.test.ts src/features/background-agent/manager-session-permission.test.ts --bail`
  - Command:  `bun run typecheck`
  - Command:  `bun test`
  - Pattern:  `package.json` — scripts use Bun only; no npm/yarn/pnpm.

  Acceptance criteria (agent-executable only):
  - [ ] Focused delegate-task/background-agent test command exits 0.
  - [ ] `bun run typecheck` exits 0.
  - [ ] `bun test` exits 0, or evidence documents exact unrelated pre-existing failures with focused command still green.
  - [ ] No `as any`, `@ts-ignore`, or `@ts-expect-error` introduced.

  QA scenarios (MANDATORY — task incomplete without these):
  ```
  Scenario: focused module regression suite
    Tool:     bash
    Steps:    mkdir -p evidence && bun test src/tools/delegate-task/sync-session-creator.test.ts src/tools/delegate-task/sync-prompt-sender.test.ts src/tools/delegate-task/sync-prompt-route.test.ts src/tools/delegate-task/sync-task.test.ts src/tools/delegate-task/background-task.test.ts src/tools/delegate-task/unstable-agent-permission.test.ts src/features/background-agent/manager-session-permission.test.ts --bail > evidence/task-6-focused-tests.txt
    Expected: Exit 0.
    Evidence: evidence/task-6-focused-tests.txt

  Scenario: typecheck and anti-suppression scan
    Tool:     bash
    Steps:    bun run typecheck > evidence/task-6-typecheck.txt && rg -n 'as any|@ts-ignore|@ts-expect-error' src/shared/subagent-session-permission.ts src/tools/delegate-task src/features/background-agent > evidence/task-6-suppression-scan.txt || true
    Expected: Typecheck exits 0; suppression scan contains no new suppressions in changed files.
    Evidence: evidence/task-6-typecheck.txt
  ```

  Commit: NO | Message: `test(task): verify delegate-task permission regression` | Files: [`evidence/task-6-focused-tests.txt`, `evidence/task-6-typecheck.txt`, `evidence/task-6-suppression-scan.txt`]

- [ ] 7. Run real tmux/manual QA for delegated exploration

  What to do:
  - Build the local plugin.
  - Run a real OMO non-interactive session inside tmux from this repo that forces `task(subagent_type="explore", run_in_background=false or true)` to inspect a known file and run a harmless shell command.
  - Confirm output contains the expected file fact and does not contain `"Permission required"`, `"missing permission"`, or `"permission denied"` for `read`/`bash`.
  - Repeat with background mode and collect `background_output` after system completion.
  - Capture tmux pane output and `/tmp/oh-my-opencode.log` excerpts.

  Must NOT do: Do not run destructive shell commands. Do not use `sleep`; use tmux capture/polling loops with bounded attempts.

  Parallelization: Can parallel: YES | Wave 3 | Blocks: [] | Blocked by: [3, 4, 5]

  References (executor has NO interview context — be exhaustive):
  - Command:  `bun run build` — local plugin build.
  - Command:  `bun src/cli/index.ts run --agent Sisyphus --directory /Users/yeongyu/local-workspaces/omo --json "<message>"`
  - Pattern:  `src/cli/cli-program.ts:74` — local CLI supports `run <message>`.
  - Pattern:  `src/cli/run/AGENTS.md` — run command waits for todos/background tasks.
  - Pattern:  `src/tools/delegate-task/tools.ts:21` — `run_in_background` controls sync/background delegation.
  - Pattern:  `/tmp/oh-my-opencode.log` — project logger destination.

  Acceptance criteria (agent-executable only):
  - [ ] `bun run build` exits 0.
  - [ ] tmux sync QA output includes an `explore` result referencing `src/tools/delegate-task/sync-session-creator.ts`.
  - [ ] tmux sync QA output has no case-insensitive match for `Permission required|missing permission|permission denied`.
  - [ ] tmux background QA output includes a background task ID and collected result.
  - [ ] `/tmp/oh-my-opencode.log` has no child-session permission rejection for the QA session.

  QA scenarios (MANDATORY — task incomplete without these):
  ```
  Scenario: sync delegated explore can read and run harmless bash
    Tool:     tmux
    Steps:    mkdir -p evidence && bun run build > evidence/task-7-build.txt && tmux new-session -d -s omo-delegate-sync-qa 'cd /Users/yeongyu/local-workspaces/omo && bun src/cli/index.ts run --agent Sisyphus --directory /Users/yeongyu/local-workspaces/omo --json "Use task with subagent_type=explore, run_in_background=false, load_skills=[] to inspect src/tools/delegate-task/sync-session-creator.ts and run pwd. Report the permission field behavior and the cwd."' ; poll `tmux capture-pane -pt omo-delegate-sync-qa` until the command exits or the pane shows JSON; save final capture.
    Expected: Capture includes a useful exploration result and no permission-required text.
    Evidence: evidence/task-7-sync-tmux.txt

  Scenario: background delegated explore can read and run harmless bash
    Tool:     tmux
    Steps:    tmux new-session -d -s omo-delegate-bg-qa 'cd /Users/yeongyu/local-workspaces/omo && bun src/cli/index.ts run --agent Sisyphus --directory /Users/yeongyu/local-workspaces/omo --json "Launch task subagent_type=explore with run_in_background=true and load_skills=[] to inspect src/shared/agent-tool-restrictions.ts. Wait for completion notification, collect background_output, and report whether read/bash were usable."' ; poll `tmux capture-pane -pt omo-delegate-bg-qa` until JSON or completion; save final capture and relevant log excerpt.
    Expected: Capture includes background result and no permission-required text.
    Evidence: evidence/task-7-background-tmux.txt
  ```

  Commit: NO | Message: `test(task): capture real delegate-task permission QA` | Files: [`evidence/task-7-build.txt`, `evidence/task-7-sync-tmux.txt`, `evidence/task-7-background-tmux.txt`]

## Final verification wave (MANDATORY — after all implementation tasks)
> Runs in PARALLEL. ALL must APPROVE. Surface results to the caller and wait for an explicit "okay" before declaring complete.
- [ ] F1. Plan compliance audit — every task done, every acceptance criterion met
- [ ] F2. Code quality review — diagnostics clean, idioms match, no dead code
- [ ] F3. Real manual QA — every QA scenario executed with evidence captured
- [ ] F4. Scope fidelity — nothing extra shipped beyond Must-Have, nothing Must-NOT-Have introduced

## Commit strategy
- One logical change per commit. Conventional Commits (`<type>(<scope>): <subject>` body + footer).
- Atomic: every commit builds and passes tests on its own.
- No "WIP" / "fix typo squash later" commits on the final branch — clean up before merge.
- Reference the plan file path in the final commit footer: `Plan: plans/fix-delegate-task-subagent-permissions.md`.

## Success criteria
- All Must-Have shipped; all QA scenarios pass with captured evidence; F1–F4 approved; commit history clean.

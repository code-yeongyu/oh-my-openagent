
## 2026-09-13 — Preserve layout when sanitizing recorded reports

`stripTerminalControls` is exported with an opt-in `preserveWhitespace` option
for multiline recorded reports. Tabs, line endings and ordinary spacing survive
while terminal escape/control sequences are removed. Existing single-line
normalizers retain their default behavior.

## 2026-09-12 — Remove the retired curated agent-name alias

`agents/legacy-agent-names.ts` and its exports (`LEGACY_AGENT_NAME_ALIASES`, `canonicalAgentName`, `legacyAgentNameNotice`, `CanonicalAgentName`) are deleted: the one-release window opened at 5.0.0-beta.51 and the package has since shipped through 5.0.0-beta.56. Every input boundary takes the submitted agent name verbatim — `resolveAgent`, `interactionPolicyForAgent`, `mapOmoConfigAgents` (including `allowed_subagents`), `dag/graph.ts` route compilation, `team/member-validator.ts`, the task tool's `validateTaskTarget` / `resolveSpawnItems`, and the spawn policy / invocation gate. The in-memory `legacySubagentType` → `legacyAlias` → `legacy_subagent_type` plumbing (validation, execute, execute-single, result-details, start-presentation) is removed with it, so a start text carries no deprecation line and `TaskToolDetails` never gains the extra field. `legacyOmoConfigAgentKeys` is gone; its only consumer was the omo-senpi startup notice. `resolve-agent.ts`'s `legacyFallbackChain` read-alias is deleted as dead code — `AGENT_FALLBACK_CHAINS` has been keyed by the canonical ids since the rename.

## 2026-09-10 — Retire myth agent names from test fixtures and update package documentation

The builtin curated agents `metis` and `momus` are renamed to `plan-consultant` and `plan-reviewer` in
the codebase; the alias handles legacy task records. All non-alias test fixtures in `packages/senpi-task/src/`
are updated to use the canonical names, and the team member name `atlas` in control-tool tests becomes `builder`.
`packages/senpi-task/AGENTS.md` and `packages/senpi-task/AGENTS.md` are updated to reflect the new curated agent
identities. Legacy ids (`metis` and `momus`) are only used in tests that explicitly exercise the alias table
(todos 1, 3, 5) or in persisted task records demonstrating backward compatibility.

## 2026-09-10 — Keep the user question tools out of child sessions

RPC children now receive `--no-ask-user` immediately after `--no-extensions` so the detached process cannot register `request_user_input` / `ask_user_question`. Headless auto-answer treats `method: "question"` as cancelled (structural request type until the pinned senpi unions include it). Catalog argv is unchanged.

## 2026-09-10 — Team tool failures are tool errors and the family renders as team rows

`tools/control/tool-result.ts` gains `toolErrorResult` (and the `ToolExecutionResult` shape carrying senpi's inline `isError`). Every failure kind of the lead team family returns through it — `team_create` `invalid_arguments` / `spec_error` / `runtime_error`, `team_delete` `invalid_state`, `task_get` `not_found`, `task_update` `already_claimed` / `blocked_by` / `invalid_transition` / `cross_owner`, the team mailbox error kinds, and both shutdown error views — while success kinds are untouched. `task_send` propagates the flag when it wraps a failed team message. The result keeps its typed `details`, so the model still branches on `kind`. The row background, the RPC `tool_execution_end.isError` the desktop maps to `failed`, and the `toolResult.isError` the model sees are derived by the senpi engine, which honors the inline flag from senpi#1549 onward; until the `@code-yeongyu/senpi` pin moves to a release containing it (#8082) those surfaces still show the old success state and only the compact rows below are live.

New `tools/team/renderers.ts` gives the six lead tools their own `renderCall` / `renderResult` in the shared renderer-text grammar (`team create name:<n> members:<N>` / `spec:<name>`, `team delete run:<id> [force]`, `team task <op> ...`), lists every member with its own `statusThemeColor`, and renders every failure as one error-colored line carrying the kind, code, and a bounded reason excerpt — replacing senpi's bold-name + raw-JSON fallback. The factories are now generically typed so those renderers keep their argument and details types, `buildLeadTeamTools` publishes the family as a `LeadTeamTool` union, and `filterSharedParentTools` / `mergeChildCustomTools` take a generic tool element (they only read `name` and `exposure`).

`team/spawn-members.ts` describes a `plan_unresolved` member start with the same recoverable target lists the task tool offers, so a member that cannot be routed names the valid categories instead of only the planner message.
## 2026-09-10 — Survive a Windows EPERM on the task-record rename and never strand a terminal outcome

On Windows a task-record rename under `tasks/` can be refused with `EPERM` (a sharing violation from Defender,
an indexer, or another senpi process). When that hit the terminal transition the record stayed `running`,
`waitFor` never settled, and a mass-ulw / DAG run stopped dequeuing dependents (#8050). Two layers now hold:

- `store/record-write.ts` (extracted from `record-store.ts`) retries `renameSync` on `EPERM`/`EBUSY`/`EACCES`
  on win32 only - 8 attempts with a 5 ms synchronous backoff, matching `dag/store.ts` - and rethrows every
  other platform, errno, or the final attempt unchanged. The temp file carries a random segment and is removed
  in a `finally`. `createTaskRecordStore(config, { platform })` is the test seam for the win32 branch.
- `manager/manager-outcome.ts` no longer lets a throwing terminal `store.transition` skip settlement. It logs
  the failure once with `taskId`, `code`, `syscall`, and `path`, calls `forget(taskId)` so the residency slot
  is released, and settles the waiters with a synthesized `error` record naming the persistence failure.
  `#settleWaiters(taskId, terminal?)` accepts that record instead of re-reading the store, which is guaranteed
  stale in this scenario. The DAG node folds as failed and `retry` can re-run it.
## 2026-09-08 — Persist child_session_id on spawned task records

`#recordSpawnFacts` now writes the spawned child's own session id from the handle onto `st_*.json` as `child_session_id`, for both in-process and process children. Reattach rewrites keep or refresh the field from the live handle so resume paths cannot drop it. The parser already treated the field as optional; a legacy record without it still loads. External readers (omo-desktop) join a grandchild session's `parent_session_id` back to this field.

## 2026-09-08 — Persist team linkage on member task records

Team members spawned by `team_create` now persist `team_run_id`, `team_name`, `team_member_name`, and `team_role: "member"` on their `st_*.json` task records. The parser keeps all four fields optional so records written before this linkage remain compatible.

## 2026-09-05 — Make run_in_background=true the standard spawn in the task tool's prompt surfaces

`src/tools/task/description.ts` no longer tells the model to use `run_in_background=true` "only for parallel
independent work" with a default that "waits and returns the result". The guideline now reads "Spawn children
with run_in_background=true; pass false only for a short child whose result gates your very next call", the
description states the mechanics once (true returns the task id at once and the child's result arrives later
as a message; false blocks this turn until the child finishes), and `src/tools/task/params.ts` describes the
flag as "true (the standard spawn) ... false blocks this turn ... Omitted counts as false" instead of labelling
false as the default. The runtime default is unchanged (an omitted flag still runs in the foreground); only
the text the model reads changed. A live backtest against gpt-6-astra with senpi's async-first preset showed
the old wording still pulling one of three single-dependent delegations back to a blocking spawn.
`description.test.ts` and `params.test.ts` pin the new wording and the absence of the old.

## 2026-09-04 — Defer the lead tasklist tools to tool_search

The four lead tasklist tools (`task_create`, `task_get`, `task_list`, `task_update`) register with `exposure: "search"` (plus `searchText`/`searchKeywords`/`searchGroup: "team-tasklist"`/`allowLazyActivation`) instead of the resident tool list. They only matter once a team exists, so they cost no prompt tokens until a tasklist operation is searched for and promote through `tool_search` on demand. Descriptions now lead with the selecting situation. `src/tools/team/tasklist-exposure.test.ts` pins the exposure on all four.

## 2026-08-28 — Align the task engine with Senpi 2026.8.28

`packages/senpi-task/package.json` now carries the exact published
`@code-yeongyu/senpi` `2026.8.28` peer and development pins. The task engine
must remain synchronized with the Senpi adapter and native package so optional
peer resolution cannot select a stale engine release.

## 2026-08-27 — Align the task engine with Senpi 2026.8.27

`packages/senpi-task/package.json` now carries the exact published
`@code-yeongyu/senpi` `2026.8.27` peer and development pins. The task engine
must remain synchronized with the Senpi adapter and native package so optional
peer resolution cannot select a stale engine release.

## 2026-08-20 — Export the canonical notice-box visual contract

The package now exports one `buildNoticeBox` helper and `NoticeSpec`-shaped types for Senpi-coupled adapters. It reproduces Senpi's canonical `Box(1, 1, customMessageBg)` contract while the pinned host package does not export its own builder.

Keep transcript notices on this helper. Compact task/tool/status rows remain on their purpose-built renderers.

## 2026-08-18 — Route category selection guidance to the caller

The task tool description now shows the caller-only selection gates for quick and unspecified
categories before a child is spawned. Those gates no longer enter the child prompt, while each
category's worker-directed execution context remains unchanged.

Keep caller guidance on builtin category definitions and render it only from the task description.
`promptAppend` is reserved for instructions the spawned worker can act on.

## 2026-08-06 — Make batch contention coverage scheduler-independent

The batch-admission contention test now injects the typed `contended` lease result directly instead
of depending on 40–120 ms renewal timing. The real renewable-lease behavior remains covered in
`admission-lease.test.ts`; this test is responsible only for proving that a contended acquisition
defers the entire suspended batch without mutating records.

Keep this separation when refactoring admission tests. Reintroducing wall-clock lease expiry into
the batch policy test makes the Windows CI result depend on scheduler pauses rather than behavior.

## 2026-08-12 — Export the shared child progress projection

The package root now exports `createChildProgress` and `ToolProgressDetails` so the OmO Senpi RPC
bridge and the terminal status UI derive live tool, assistant-line, turn, and token progress from one
implementation.

Do not fork the progress grammar or token tracker in downstream adapters; child event interpretation
must remain shared with the task TUI.

## 2026-08-12 — Expose narrow runtime subpaths for packaged adapters

The package now exposes focused subpaths for builtin agents, category resolution, renderer text,
task renderers, and RPC spawn helpers. The OmO Senpi main bundle uses these subpaths so its lazy task
sidecar can own the full task engine without the root barrel pulling every runner into both
artifacts.

Keep the root export for task-component consumers, but use the narrow subpaths from non-task adapter
components. Reintroducing root runtime imports there defeats the split-bundle size guarantee.

## 2026-08-12 — Bound transcript source reads

Task output now reads at most 1 MB of transcript source data, preserving file head and tail content
and propagating source truncation into the returned transcript details. Multi-file child sessions
read only the first and last session files within that shared budget.

Keep the source-read budget ahead of parsing and rendering. A render-only character cap does not
protect the parent process from loading and materializing arbitrarily large child logs.

## 2026-08-12 — Never sweep a live sibling session's children in a multi-session host

`reconcileOnSessionStart` treated every resident record carrying THIS host pid but absent from the
calling session's registry as a crashed-process orphan. In a multi-session host (one shared senpi
process running one engine + one registry PER session over a shared store, e.g. the OmO desktop rpc
child) that description also fits a live sibling session's children, so a sibling `session_start`
reclaimed them and marked each `in-process` record `lost` with "in-process task from a previous
process cannot be reattached" while the child kept running; its real completion then landed as
`late_transition_ignored`. Observed in the desktop dev instance: six `explore` children
(`st_019ff430..435`) spawned at 04:17:43-45Z were destroyed at 04:19:04Z by another session's start.

The cross-session legacy loop now defers a same-process sibling (`deferred` / `foreign_live_owner`)
instead of reclaiming it; ownership stays with the session that actually holds the handle.

Keep this guard scoped to the cross-session loop. The global sweep (`parentSessionId === undefined`)
deliberately still loses a same-pid resident with no live handle: that is the single-session CLI
crash-recovery path, and an in-process child genuinely dies with its engine there. Records with no
`host_pid` or a dead foreign owner are not siblings and must stay sweepable.

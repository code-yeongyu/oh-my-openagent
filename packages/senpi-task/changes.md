
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

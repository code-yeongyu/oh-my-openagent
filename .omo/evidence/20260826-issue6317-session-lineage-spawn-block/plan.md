# Plan — Issue 6317: Subagent spawn blocked ("failed to resolve session lineage") despite registered agents

## Root cause analysis (traced end-to-end on real code, not memory)

Error path: `task()` / `call_omo_agent()` -> `BackgroundManager.reserveSubagentSpawn()`
(`packages/omo-opencode/src/features/background-agent/manager.ts:345-383`) ->
`resolveSubagentSpawnContext()` (`.../background-agent/subagent-spawn-limits.ts:16-69`).

Three defects combine:

1. **Fail-closed on ANY lineage lookup failure.** Commit 594233183 made
   `resolveSubagentSpawnContext()` throw `Subagent spawn blocked: failed to resolve session
   lineage ...` whenever any node of the parent chain returns an SDK error response, returns no
   data, or throws. Every delegation route (sync task, background task, call_omo_agent) funnels
   through this gate BEFORE agent resolution, so one bad lookup makes the entire plugin unable to
   delegate (the reported total outage).
2. **Directory-scoped lookup fragility.** Commit 3bfa3bd60 added `query: { directory }` to
   `session.get`. In the reporter's setup (`opencode serve --hostname 0.0.0.0` + remote Windows
   client), the plugin's server-side directory does not match the project the session was created
   under, so the scoped lookup fails even though the session exists in opencode.db and an
   unscoped get by the globally-unique session ID would succeed.
3. **`[object Object]` diagnostics.** `String(response.error)` (line 40) stringifies object SDK
   errors to "[object Object]", destroying the reason.

Sibling call sites already treat `session.get` failure as recoverable:
`spawner.ts:47` and `manager.ts:750` use `.catch(() => null)` with fallback;
`session-existence.ts` has a tri-state exists/missing/unknown;
`tools/delegate-task/sync-spawn-reservation.ts:36-48` degrades to depth 0/1 when enforcement is
unavailable. Only the spawn gate hard-blocks.

## Fix (minimal, root-cause)

File: `packages/omo-opencode/src/features/background-agent/subagent-spawn-limits.ts`

1. Per-node fetch helper: try directory-scoped `session.get`; if it fails AND a directory was
   provided, retry once unscoped (session IDs are globally unique in opencode).
2. If a node still cannot be resolved, STOP walking and return a degraded context
   `{ rootSessionID: parentSessionID, parentDepth: 0, childDepth: 1, degraded: true }` plus a
   warning log with a READABLE reason (new local serializer: Error.message -> JSON.stringify
   fallback -> String). No throw for lookup failures; depth enforcement still applies to every
   resolvable lineage (the normal case). Cycle detection stays a hard throw (corrupt data, not a
   lookup failure).
3. Add optional `degraded?: boolean` to `SubagentSpawnContext`.

Tests updated where they pinned the defective fail-closed contract (this is the TDD correction,
not weakening):
- `subagent-spawn-limits.test.ts`: two fail-closed tests rewritten to assert retry-unscoped
  recovery and graceful degradation; new RED tests added first.
- `manager.test.ts` (~line 3884): "should fail closed when session lineage lookup fails"
  rewritten to assert launch proceeds (degraded) when lookups fail.

## Verification

- Focused gates x2 over identical final tree: `bun test packages/omo-opencode/src/features/background-agent`
  (+ manager/delegate-task suites touching spawn reservation), `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`,
  `git diff --check`, hygiene grep zero new hits on changed paths.
- Real-surface QA under `/tmp/opencode/issue-6317/` with sandboxed XDG_* + HOME: real
  `opencode serve`, real `@opencode-ai/sdk` client, real sessions. Prove: (a) lineage resolves
  against real server; (b) wrong-directory scoped get fails and unscoped retry recovers (exact
  reported failure mode); (c) isolation proof via sandboxed DB session counts.

## Explicitly out of scope

- OpenCode-core behavior where `app.agents()` is empty inside a remotely-created session
  (upstream core issue, not plugin code).
- No git commit/push/PR (lane mandate).

# Plan: issue #3588 - sync (plan-sync) tasks do not stream toolcall progress to parent

## Root cause (file:line)

`packages/omo-opencode/src/tools/delegate-task/sync-session-poller.ts`

1. L167-170: while the child session status is active (`busy`/`retry`/`running`) the loop
   `continue`s BEFORE fetching messages. Child activity is never observed mid-run.
2. L172-236: messages are fetched only once status goes idle, and are used solely for
   terminal-condition evaluation (error / finish / text fallback). Nothing is published.
3. `sync-task-runner.ts:146-153` passes `ctx` but has no progress path;
   `sync-task-metadata.ts:6-33` publishes metadata exactly twice (spawn + completion).

Net effect: the parent's `task` tool call shows a static title for the whole run. Native
OpenCode renders live tool progress from child `message.part.updated` events; sync
delegation bypasses that contract entirely (issue #3588, confirmed by owner comments).

## Fix shape: publish progress via the existing ctx.metadata() live-update seam

OpenCode gives tools `ctx.metadata({ title, metadata })` which updates the RUNNING tool
part's title/metadata in the parent TUI in real time (same seam used by
`publishSyncTaskMetadata`, `tool-metadata-store/publish-tool-metadata.ts`). No new event
subscription needed; polling already provides the data.

### Changes

1. `executor-types.ts`: extend `SessionMessage` part type with optional runtime fields
   `tool?: string` (opencode ToolPart carries the tool name at top level).
2. NEW `sync-progress-reporter.ts`:
   - `SyncTaskProgressSnapshot { elapsedMs, assistantTurns, toolCalls, latestTool? }`
   - `extractProgressActivity(messages)` pure counter/deriver.
   - `createSyncProgressPublisher({ ctx, args, agentToUse, parentContext, getSessionID, getModel, getSpawnDepth })`
     returns `(snapshot) => Promise<void>` that rebuilds the base sync metadata payload
     (fresh session/model per call so fallback retries stay consistent) and publishes
     `{ ...base, progress: snapshot }` via `publishToolMetadata`.
3. `sync-task-metadata.ts`: extract exported `buildSyncTaskMetadataInput()` returning
   `{ title, metadata }`; `publishSyncTaskMetadata` becomes a thin wrapper (no behavior change).
4. `sync-session-poller.ts`:
   - New optional inputs: `onProgress?: (snapshot) => void | Promise<void>`,
     `progressIntervalMs?: number` (default 2000; mirrors `childWakeGraceMs` pattern).
   - Active-status branch: throttled messages fetch (default every 2s), diff snapshot
     signature `${assistantTurns}:${toolCalls}:${latestTool}`, publish on change only,
     anchor-gated, errors isolated (log + continue). Poll loop semantics unchanged.
5. `sync-task-runner.ts`: build publisher once, pass as `onProgress` into
   `deps.pollSyncSession(...)`.

### Non-goals / conflict avoidance

- PR #7230 (stall detection) touches the same poller file but different regions
  (post-text-fallback stall block + `stallWindowMs` input). This change touches the
  active-status branch + input type only; textual conflicts unlikely, rebase-safe.
- No change to background mode, result fetching, or completion contracts.

## Tests (failing first)

NEW `sync-session-poller.progress-streaming.test.ts` (house style: bun:test, given/when/then,
`require("./sync-session-poller")` at call time, `__setTimingConfig/__resetTimingConfig`,
`withMockedDateNow` fake clock copied file-local):

1. FAILING: busy session whose transcript grows with tool parts across polls ->
   `onProgress` fires multiple times WHILE status is busy, `toolCalls` monotonic,
   `latestTool` reflects newest tool part.
2. FAILING: busy-then-complete session -> progress callbacks observed before the poll
   resolves null (progress precedes completion).
3. Guard: frozen transcript while busy -> no duplicate publishes (signature dedupe).
4. Guard: `onProgress` throwing -> poll still completes normally (fault isolation).
5. Guard: anchor gating -> no progress before messages exceed anchorMessageCount.
6. Guard: throttle -> with large `progressIntervalMs`, no active-phase fetch/publish.

NEW `sync-progress-reporter.test.ts`: extraction counts + publisher merges base metadata
with progress and republishes per call (fresh getSessionID honored).

## Verification

- Failing-first run captured to evidence dir, then green.
- Scoped: `bun test packages/omo-opencode/src/tools/delegate-task/`
- Repo typecheck: `bun run typecheck`
- Evidence: `.omo/evidence/20260825-plan-sync-toolcall-stream/` (force-add; gitignored)
- Live-harness QA omitted (no provider credentials in env); honest omission note recorded,
  mirroring merged prior art PR #7230's evidence standard.

## Constraints honored

Bun-only; no `as any`/`@ts-ignore`/`@ts-expect-error`; no weakened/deleted tests; one
conventional commit staging ONLY own files + evidence; never stage
`packages/shared-skills/upstreams/*` or plugin build artifacts.

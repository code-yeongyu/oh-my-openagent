# Changes

## 2026-07-02 - Upstream harness timeout and compaction serialization sync

### What changed and why

- Accepted upstream harness changes for rejecting invalid/non-positive Node timeouts and serializing split-turn compaction
  summary requests.
- This keeps the fork aligned with upstream runtime validation and prevents single-concurrency providers from receiving
  overlapping compaction-summary generations.

### Files modified

- `packages/agent/src/harness/compaction/compaction.ts`
- `packages/agent/src/harness/env/nodejs.ts`

### Why the extension system could not handle this

- Timeout validation and harness compaction scheduling happen inside shared agent-core helpers before coding-agent
  extensions or mode renderers participate.

### Expected merge conflict zones on next upstream sync

- LOW: `packages/agent/src/harness/env/nodejs.ts` around timeout parsing and validation.
- LOW: `packages/agent/src/harness/compaction/compaction.ts` around summary request scheduling.

## 2026-05-15 - Tool abort loop termination

### What changed and why

- Stopped the core agent loop immediately after a tool batch finishes under an aborted signal.
- This prevents a tool-level abort result from continuing into `prepareNextTurn`, steering queue polling, follow-up queue
  polling, or another provider request.
- This closes the remaining abort path not covered by terminal assistant stream event normalization.

### Files modified

- `packages/agent/src/agent-loop.ts`
- `packages/agent/test/agent-loop.test.ts`

### Why the extension system could not handle this

- The decision to poll queued steering after tool execution happens inside the core loop before extensions can safely
  restore UI/editor queue state.

### Expected merge conflict zones on next upstream sync

- `packages/agent/src/agent-loop.ts` after `turn_end` emission in `runLoop()`.

## 2026-05-15 - Upstream harness refactor sync preservation

### What changed and why

- Preserved the fork's ES2021 diagnostic compatibility while accepting upstream's result-based harness/environment refactor.
- Kept stream option patching on `Object.prototype.hasOwnProperty.call` instead of `Object.hasOwn`.
- Kept harness error `cause` capture without relying on two-argument `Error` construction.

### Files modified

- `packages/agent/src/harness/agent-harness.ts`
- `packages/agent/src/harness/types.ts`

### Why the extension system could not handle this

- These are exported harness primitives and internal option-merging helpers that are evaluated before coding-agent
  extensions can participate.

### Expected merge conflict zones on next upstream sync

- `packages/agent/src/harness/agent-harness.ts` around `applyStreamOptionsPatch()`.
- `packages/agent/src/harness/types.ts` around harness error constructors.

## 2026-05-15 - Compaction summary metadata

### What changed and why

- Added optional `details` metadata to the harness `CompactionSummaryMessage` type.
- This keeps the shared agent-core message augmentation compatible with coding-agent compaction summaries that carry
  provider-native compaction route details for TUI rendering and replay.

### Files modified

- `packages/agent/src/harness/messages.ts`

### Why the extension system could not handle this

- This is exported type metadata in the shared harness message model. Extensions can populate compaction details, but they
  cannot alter the core `CustomAgentMessages` declaration merge.

### Expected merge conflict zones on next upstream sync

- LOW: `packages/agent/src/harness/messages.ts` around `CompactionSummaryMessage`.

## 2026-05-12 - Abort terminal event normalization

### What changed and why

- Normalized terminal assistant stream messages in `agent-loop.ts` so the event-level `reason` is authoritative for
  `done`/`error` events.
- This prevents an abort event with a stale assistant `stopReason` from being treated as a normal stop and draining queued
  steering/follow-up messages after the user interrupted the run.

### Files modified

- `packages/agent/src/agent-loop.ts`
- `packages/agent/test/agent.test.ts`

### Why the extension system could not handle this

- The stale-stopReason decision happens inside the core agent loop before extensions see a completed turn.
- Extensions can observe abort events after the fact, but they cannot prevent the loop from deciding to continue into
  queued messages.

### Expected merge conflict zones on next upstream sync

- `packages/agent/src/agent-loop.ts` around terminal `done`/`error` stream handling.

## 2026-04-05 - Parallel tool completion emission

### What changed and why

- Updated `executeToolCallsParallel()` to finalize prepared tool calls concurrently after sequential preflight.
- This lets `tool_execution_end` and `toolResult` message events appear as soon as each tool finishes instead of waiting behind an earlier slow tool.
- The returned `toolResults` array still stays in assistant source order, which preserves next-turn context ordering and matches existing semantic expectations.

### Files modified

- `packages/agent/src/agent-loop.ts`
- `packages/agent/src/types.ts`
- `packages/agent/README.md`
- `packages/agent/test/agent-loop.test.ts`

### Why the extension system could not handle this

- The scheduling and final result collection logic lives in `@mariozechner/pi-agent-core`, specifically `executeToolCallsParallel()`.
- Coding-agent extensions can observe and mutate tool inputs/results, but they cannot replace the agent loop's internal await/collection strategy or `toolExecution` scheduling behavior.
- The existing builtin `parallel-tool-calls` extension only changes provider payloads (`parallel_tool_calls: true`) and does not control runtime result finalization.

### Expected merge conflict zones on next upstream sync

- `packages/agent/src/agent-loop.ts` around `executeToolCallsParallel()`
- `packages/agent/src/types.ts` tool execution mode docs
- `packages/agent/README.md` tool execution behavior description

## 2026-05-11 - Inline harness UUIDv7 generation

### What changed and why

- Replaced upstream harness imports of `uuid/v7` with a local UUIDv7 generator backed by Node's `crypto.randomBytes`.
- This keeps clean package-manager builds working without adding a new direct `uuid` dependency to `@earendil-works/pi-agent-core`.

### Files modified

- `packages/agent/src/harness/session/uuid.ts` (current location; the generator originally landed in the since-restructured session repo/storage files)

### Why the extension system could not handle this

- The failing imports live inside the agent harness session storage implementation and run before any coding-agent extension can intercept them.

### Expected merge conflict zones on next upstream sync

- `packages/agent/src/harness/session/uuid.ts`
- its importers `packages/agent/src/harness/session/{repo-utils,memory-storage,jsonl-storage}.ts` around session/entry id creation.

## 2026-05-11 - Harness ES2021 diagnostic compatibility

### What changed and why

- Replaced `ErrorOptions`/two-argument `Error` construction in `FileError` with an equivalent local `{ cause }`
  option stored on the class.
- Replaced `Object.hasOwn` with `Object.prototype.hasOwnProperty.call` in the stream option patch helper.
- This keeps the upstream harness behavior intact while avoiding diagnostics in environments that type-check the package with
  ES2021 library declarations.

### Files modified

- `packages/agent/src/harness/types.ts`
- `packages/agent/src/harness/agent-harness.ts`

### Why the extension system could not handle this

- These are type-level compatibility fixes in exported harness primitives and internal option-merging code that run before
  coding-agent extensions are involved.

### Expected merge conflict zones on next upstream sync

- `packages/agent/src/harness/types.ts` around `FileError` construction.
- `packages/agent/src/harness/agent-harness.ts` around `hasOwn()`.

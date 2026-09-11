# Real OpenCode idle-`unknown` stall evidence (PR #6666)

Isolated end-to-end proof on a REAL opencode server (v1.18.15 — the version
from the original incident) with the PR's source plugin loaded, a mock
OpenAI-compatible provider that reproduces the interrupted-stream shape, and
no external API calls. Both required outcomes are proven with timings.

## Harness

- `mock-openai.mjs` — OpenAI-compatible SSE server. Parent requests receive a
  `task` tool call (delegate-task). Child requests receive the exact
  interrupted-stream shape from issue #6665: text chunks that end cleanly with
  `data: [DONE]` and NEVER carry a finish_reason, which opencode persists as
  `finish="unknown"` before the session settles idle. `CHILDPROBE EMPTY`
  streams zero text chunks (no-deliverable); `CHILDPROBE DELIVERABLE` streams
  text (current-turn deliverable present). Any unrecognized request shape
  fails with HTTP 500 rather than fabricating a scenario.
- `drive-stall.mjs` — spawns a real `opencode serve` in an isolated XDG sandbox
  with the source plugin (`file://.../packages/omo-opencode/src/index.ts`),
  routes the parent and the explore subagent at the mock, drives the parent
  turn through `prompt_async`, and watches the task tool's result part until
  completion. It asserts the opencode database is created INSIDE the sandbox
  and that the host's session count is unchanged before/after (isolation
  proof), kills the server in a `finally` path, and exits 0 only when the
  mode-specific outcome (deliverable handback / stall abort) is observed; 1 on
  mismatch, timeout, or harness failure.
- `status-map-absence-proof.txt` — 100ms-granularity status-map watch proving
  idle sessions vanish from the map (`busy -> (absent)`,
  `SAW_IDLE_IN_MAP=false`).

## Run (reproducible)

```bash
# 1. start the mock provider
node mock-openai.mjs &          # listens on 127.0.0.1:8790

# 2. drive each scenario against a real opencode 1.18.15
OMO_WORKTREE=/path/to/oh-my-openagent node drive-stall.mjs DELIVERABLE
OMO_WORKTREE=/path/to/oh-my-openagent node drive-stall.mjs EMPTY
```

- `OMO_WORKTREE` (or argv[3]) points at the checked-out repository whose
  `packages/omo-opencode/src/index.ts` is loaded as the plugin; the harness
  fails fast if that file is missing.
- Requires opencode-ai@1.18.15 (the incident version) on PATH; the binary can
  be overridden with `OPENCODE_EXE`.
- Each run keeps its sandbox (containing `serve.log`) unless
  `OMO_CLEANUP_SANDBOX=1` is set.

## Findings

1. **Reproduced the incident state.** On opencode 1.18.15 an interrupted child
   stream persists the assistant message with `finish="unknown"`, the child
   turn exits (`exiting loop`), and the session settles idle with the
   `session.idle` event. Pre-fix, the parent's task tool then hangs toward the
   30-minute inactivity timeout — verified live (400s+ with no result).

2. **Idle sessions are ABSENT from the status map.** Watched at 100ms
   granularity (`status-map-absence-proof.txt`), the child's status-map entry
   goes `busy -> (absent)`; a literal `type: "idle"` entry never appears
   (`SAW_IDLE_IN_MAP = false`), even though the `session.idle` event fires.
   On opencode ≥1.18.22 the same interruption instead keeps the session
   `busy` in an endless agent-loop retry (step 1387+ observed), which the
   busy-reset already handles.

   Consequence: the stall gate originally required `status.type === "idle"`,
   which real opencode never surfaces in the map. The poller now treats
   "absent from a SUCCESSFUL status response" as a known-inactive observation
   (a failed/thrown status fetch still resets the stall timer), so the
   detection matches real behavior while keeping the exception-safety
   semantics.

3. **Both outcomes proven with the fix loaded** (hardened harness, exit 0):
   - Deliverable handback (`deliverable-output.txt`): task tool returned at
     **t+52s** (task: 46s) with `Task completed in 46s` and the child's
     current-turn text (`child deliverable chunk-0 chunk-1`) handed back to
     the parent.
   - No-deliverable abort (`empty-output.txt`): task tool returned at **t+45s**
     with `Subagent stalled: session was inactive with finish="unknown" and
     produced no new messages for 30000ms. The model stream was likely
     interrupted.`

   Both exits land at ~45-52s: ~15-17s of setup/settling (session creation,
   child stream, idle transition, plugin machinery) plus the 30s stall window —
   instead of the 30-minute inactivity timeout from the incident.

## Corresponding unit coverage

`sync-session-poller.stall.test.ts` gains cases mirroring these findings: a
session absent from a successful status response stalls (no deliverable) and
hands back (deliverable); a status endpoint that throws on every observation
never accumulates a stall; and a short status outage interrupting an already
accumulated stall window resets the window (a stale pre-outage window cannot
fire on recovery).

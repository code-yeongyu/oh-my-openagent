# QA: monitor terminal output wakes the parent session

Harness-connected change in `packages/omo-opencode/src/features/monitor`, driven against a real
`opencode serve` instance loading this build — not a stub.

## Setup

- opencode 1.18.7, headless `opencode serve --port 52941`
- `OPENCODE_CONFIG` pointed at a temp config whose only plugin is this local build; the npm
  `oh-my-openagent` is excluded per CONTRIBUTING
- Real `MonitorManager` against the real SDK client and a real session
- Monitored command: `sh -c 'echo QA_BUILD_LINE; sleep 3; exit 7'`

Build identity is visible in the log itself: `shouldReply` and `forceActiveDispatch` are fields only
this branch emits.

## Before

The streaming batch is delivered, the command exits 7, and the parent is never told:

```
03:31:00 [monitor] Sent deferred monitor output: {"batchSeq":1,"shouldReply":false,...}
... 80s later: no further messages, no assistant turn
```

Running it surfaced a defect the unit tests could not: `MonitorBatcher.flushNow()` returned early on
an empty buffer, so a command that prints its output and then exits quietly produced **no terminal
batch at all** and the `Status: exited (code=N)` envelope was never built. Tests that construct a
terminal batch by hand cannot see this.

## After

```
03:33:36  user       [OMO MONITOR OUTPUT] monitor_id: mon_f4718d66 batch: 1   <- streaming, noReply
03:33:38  user       [OMO MONITOR OUTPUT] monitor_id: mon_f4718d66 batch: 2   <- terminal batch
03:33:38 -> 03:33:47 assistant  "Monitor `qa-build` (mon_f4718d66) exited with code 7 ..."
```

The parent produced an assistant turn reporting the failure with zero user input. Full transcript and
gate log in `live-harness.txt`.

## Files

- `red.txt` — regression test with the fix reverted: 4 fail / 4 pass
- `green.txt` — fix applied: 8/8 on the new file, 94/94 across the monitor suite, typecheck exit 0
- `live-harness.txt` — real session timeline and plugin gate log

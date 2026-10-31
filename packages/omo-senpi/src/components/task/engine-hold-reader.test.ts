import { expect, test } from "bun:test"
import { readEngineRunHold } from "./engine-hold-reader"

test("Stop records are identified by kind while per-Stop keys and the highest observed sequence survive", () => {
  expect(readEngineRunHold({
    pauseSeq: 12,
    holds: [
      { kind: "session_hold", key: "session_hold:9" },
      { kind: "session_hold", key: "session_hold:12" },
      { kind: "run_fence", key: "run_fence:dag:r", data: { runRef: { kind: "dag", id: "r" } } },
    ],
  })).toEqual({ pauseSeq: 12, stopped: true, runRefs: [{ kind: "dag", id: "r" }] })
})

test("RPC pause projection and extension hold projection select the same fenced run", () => {
  expect(readEngineRunHold({
    pauseSeq: 14,
    records: [
      { kind: "run_fence", key: "run_fence:workpool:p", runRef: { kind: "workpool", id: "p" } },
      { kind: "inherited_hold", key: "inherited_hold", parentSessionId: "parent" },
    ],
  })).toEqual({ pauseSeq: 14, stopped: false, runRefs: [{ kind: "workpool", id: "p" }] })
})

test("the engine's interrupted-run session hold is not a user Stop, while a Stop beside it still is", () => {
  expect(readEngineRunHold({
    pauseSeq: 2, holds: [{ kind: "session_hold", key: "interrupted-run" }],
  })).toEqual({ pauseSeq: 2, stopped: false, runRefs: [] })
  expect(readEngineRunHold({
    pauseSeq: 3, holds: [{ kind: "session_hold", key: "interrupted-run" }, { kind: "session_hold", key: "session_hold:3", data: { localSeq: 3 } }],
  })).toEqual({ pauseSeq: 3, stopped: true, runRefs: [] })
})

test("unrelated holds do not impersonate a user Stop or a run fence", () => {
  expect(readEngineRunHold({
    pauseSeq: 4, holds: [{ kind: "deadline_hold", key: "session_hold:4" }],
  })).toEqual({ pauseSeq: 4, stopped: false, runRefs: [] })
})

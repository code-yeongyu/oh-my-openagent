import { expect, test } from "bun:test"
import { createInProcessRunPause } from "./in-process/native-run-pause"

test("delta-2 MEDIUM: an in-process pause view without a sequence reports the hold as unknown, never cutoff 0", async () => {
  const pause = createInProcessRunPause({
    pauseForRun: async () => ({ childSeq: 1 }),
    resumeForRun: async () => ({ released: true, otherHoldLive: false }),
    holdInput: () => ({ kind: "held", entryId: "e", duplicate: false }),
    pauseView: { records: [{ kind: "inherited_hold", parentSessionId: "parent" }] },
  }, () => ({ outcome: new Promise<never>(() => undefined), cancel: () => undefined }))
  if (pause === undefined) throw new Error("expected a native run pause")
  expect(await pause.observeHold?.("parent")).toBeUndefined()
})

import { expect, test } from "bun:test"
import { AdmissionBarrier } from "./admission-barrier"

test("the final creation seam inherits the run identity bound after planning", () => {
  const barrier = new AdmissionBarrier()
  const admission = barrier.enter("parent", { key: "planning", runRef: { kind: "task", id: "planning" } })
  if (admission.kind !== "entered") throw new Error("expected entered")
  admission.ticket.update({ key: "child", runRef: { kind: "dag", id: "workflow" } })
  barrier.close("parent", 7)
  expect(admission.ticket.commit()).toEqual({
    kind: "start_paused",
    owner: { parentSessionId: "parent", parentPauseSeq: 7, runRef: { kind: "dag", id: "workflow" } },
  })
  admission.ticket.leave()
})

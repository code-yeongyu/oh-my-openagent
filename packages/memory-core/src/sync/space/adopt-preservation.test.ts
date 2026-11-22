import { expect, test } from "bun:test"

import { renderDocContent } from "../item/render"
import { newDoc } from "../item/test-support"
import { planAdoption } from "./adopt"
import { assertPreserved, testAdoptionPreservation } from "./adopt-preservation.test-support"
import { applyPlan, soleRegisters, t2Block } from "./test-support"

testAdoptionPreservation(20261016)

test("existing-key T2 and T1 values survive capture into the real item model", async () => {
  // Given the hub's actual differing-existing-key shape, not an absent-key fixture.
  const main = "---\ntitle: Main\ntags: [a]\nreviewed: true\n---\nmain\n"
  const other = "---\ntitle: Other\ntags: [a, b]\nreviewed: false\n---\n"
  const side = "---\ntitle: Side\ntags: [c]\nreviewed: 3\n---\nside\n"
  const plan = planAdoption(
    [
      { path: "n.md", text: main + t2Block("2026-10-15", "n.md", other) },
      { path: "n.sync-conflict-20261015-device.md", text: side },
    ],
    { currentText: null, lastMaterialised: null, tombstoned: false, registers: soleRegisters(null) },
  )
  expect(plan.action).toBe("capture")
  if (plan.action !== "capture") throw new Error("expected capture")
  const doc = await newDoc("1")
  try {
    // When the plan is committed as real CRDT operations.
    applyPlan(doc, "", plan)
    // Then the committed render, not merely the plan, retains all values.
    assertPreserved([main, other, side], renderDocContent(doc), "existing-key capture")
    expect(renderDocContent(doc)).toBe(plan.rendered)
  } finally {
    doc.free()
  }
})

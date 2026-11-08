import { expect, test } from "bun:test"
import { addGuidance, dispatchGuidance, type Guidance } from "./guidance"

test("design 24: a crash after the child held the guidance and before delivered was saved redelivers the same input, so the child keeps one entry", async () => {
  let saved: readonly Guidance[] = addGuidance([], {
    id: "guide-1", scope: { kind: "node", nodeId: "b" }, text: "use staging", createdAt: "2026-01-01T00:00:00Z",
  })
  const childEntries = new Map<string, { readonly entryId: string; readonly revision: number; readonly text: string }>()
  const sentInputs: { readonly inputId: string; readonly revision: number; readonly text: string }[] = []
  const deliver = async (_taskId: string, input: { readonly inputId: string; readonly revision: number; readonly text: string }) => {
    sentInputs.push(input)
    const existing = childEntries.get(input.inputId)
    if (existing !== undefined) {
      if (existing.revision !== input.revision || existing.text !== input.text) throw new Error("input_id_conflict")
      return { entryId: existing.entryId }
    }
    const entry = { entryId: `held-${childEntries.size + 1}`, revision: input.revision, text: input.text }
    childEntries.set(input.inputId, entry)
    return { entryId: entry.entryId }
  }
  let crashAfterHold = true
  const save = (records: readonly Guidance[]) => {
    if (crashAfterHold && records[0]?.deliveries.length === 1) {
      crashAfterHold = false
      throw new Error("host killed")
    }
    saved = records
  }
  const targets = [{ nodeId: "b", taskId: "st_b" }]
  await expect(dispatchGuidance(saved, targets, { save, deliver })).rejects.toThrow("host killed")
  expect(saved[0]).toMatchObject({ state: "dispatching", deliveries: [] })
  expect(childEntries.size).toBe(1)

  await dispatchGuidance(saved, targets, { save, deliver })
  expect(sentInputs).toEqual([
    { inputId: "guide-1", revision: 0, text: "use staging" },
    { inputId: "guide-1", revision: 0, text: "use staging" },
  ])
  expect(childEntries.size).toBe(1)
  expect(saved[0]).toMatchObject({ state: "delivered", deliveries: [{ taskId: "st_b", entryId: "held-1" }] })
})

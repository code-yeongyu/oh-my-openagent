import { expect, test } from "bun:test"
import { addGuidance, changeGuidance, dispatchGuidance, type Guidance } from "./guidance"

test("draft guidance can be edited and removed without starting work", () => {
  const initial = addGuidance([], { id: "g", scope: { kind: "run" }, text: "first", createdAt: "2026-01-01T00:00:00Z" })
  const edited = changeGuidance(initial, { id: "g", text: "second", editedAt: "2026-01-01T00:00:01Z" })
  expect(initial[0]?.text).toBe("first")
  expect(edited[0]).toMatchObject({ revision: 1, text: "second", state: "draft" })
  expect(changeGuidance(edited, { id: "g", remove: true, editedAt: "2026-01-01T00:00:02Z" })[0]?.state).toBe("removed")
})

test("custody is frozen before delivery and resumes only missing acknowledgements after a crash", async () => {
  let saved: readonly Guidance[] = addGuidance([], {
    id: "g", scope: { kind: "run" }, text: "use the new plan", createdAt: "2026-01-01T00:00:00Z",
  })
  const calls: string[] = []
  const targets = [{ taskId: "a", nodeId: "one" }, { taskId: "b", nodeId: "two" }]
  const deliver = async (taskId: string) => {
    calls.push(taskId)
    expect(saved[0]?.state).toBe("dispatching")
    expect(() => changeGuidance(saved, { id: "g", text: "too late", editedAt: "later" })).toThrow()
    if (taskId === "b" && calls.length === 2) throw new Error("crash after first child acknowledged")
    return { entryId: `entry-${taskId}` }
  }
  await expect(dispatchGuidance(saved, targets, { save: value => { saved = value }, deliver })).rejects.toThrow("crash")
  expect(saved[0]?.deliveries).toEqual([{ taskId: "a", entryId: "entry-a" }])
  await dispatchGuidance(saved, targets, { save: value => { saved = value }, deliver })
  expect(calls).toEqual(["a", "b", "b"])
  expect(saved[0]?.state).toBe("delivered")
})

test("queued nodes retain frozen guidance for their first prompt and do not fabricate child acknowledgements", async () => {
  let saved: readonly Guidance[] = addGuidance([], {
    id: "node-guide", scope: { kind: "node", nodeId: "queued" }, text: "check invariants", createdAt: "2026-01-01T00:00:00Z",
  })
  await dispatchGuidance(saved, [{ nodeId: "queued" }], {
    save: value => { saved = value },
    deliver: async () => { throw new Error("queued node has no child") },
  })
  expect(saved[0]).toMatchObject({ state: "dispatching", deliveries: [] })
})

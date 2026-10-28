import { describe, expect, test } from "bun:test"
import type { HelperCall, HelperReply } from "./client"
import { migrate } from "./migration"
import { namesFromRead, recoveryPlan, runRecovery } from "./recovery"

const A = "a".repeat(64)

function scriptedHelper(replies: Partial<Record<string, HelperReply>>) {
  const calls: string[] = []
  const helper = async (call: HelperCall): Promise<HelperReply> => {
    const key = `${call.verb} ${call.account.slice(64) || "<A>"}`
    calls.push(key)
    return replies[key] ?? (call.verb === "retire" ? { ok: true, slot: 0 } : { ok: true })
  }
  return { calls, helper }
}

describe("recovery table (#11262 design 3.4)", () => {
  test.each([
    ["staging + .old, no original", { original: false, staging: true, old: true, oldSlots: [0] }, ["promote", "delete-old"]],
    ["staging only", { original: false, staging: true, old: false, oldSlots: [] }, ["promote"]],
    [".old only (signed out; never renamed back)", { original: false, staging: false, old: true, oldSlots: [0] }, ["delete-old"]],
    ["original + staging", { original: true, staging: true, old: false, oldSlots: [] }, ["remove-staging"]],
    ["original + .old", { original: true, staging: false, old: true, oldSlots: [0] }, ["delete-old"]],
    ["original only", { original: true, staging: false, old: false, oldSlots: [] }, []],
    ["nothing", { original: false, staging: false, old: false, oldSlots: [] }, []],
  ] as const)("#given %s #when planned #then %p", (_name, names, plan) => {
    expect(recoveryPlan(names)).toEqual(plan)
  })

  test("#given read replies #when names are derived #then a recover answer means no original", () => {
    expect(namesFromRead({ owned: true, recover: true, present: { staging: true, old: true, oldSlots: [0] } })).toEqual({ original: false, staging: true, old: true, oldSlots: [0] })
    expect(namesFromRead({ owned: false, present: { staging: false, old: true, oldSlots: [0, 3] } })).toEqual({ original: true, staging: false, old: true, oldSlots: [0, 3] })
    expect(namesFromRead({ missing: true, present: { staging: false, old: false, oldSlots: [] } })).toEqual({ original: false, staging: false, old: false, oldSlots: [] })
  })

  test("#given a .old the helper cannot read #when recovery deletes it #then this process's own identity deletes it instead", async () => {
    const { calls, helper } = scriptedHelper({ "remove .old": { error: "not-owned" } })
    let ownDeletes = 0
    const outcome = await runRecovery(A, { original: true, staging: false, old: true, oldSlots: [0] }, helper, async () => ++ownDeletes > 0)
    expect(calls).toEqual(["remove .old"])
    expect(ownDeletes).toBe(1)
    expect(outcome).toEqual({ applied: ["delete-old"], failed: null })
  })
})

describe("migration (#11262 design 3.3)", () => {
  test("#given a migratable value #when migrated #then stage, retire, promote, then delete .old, in that order", async () => {
    const { calls, helper } = scriptedHelper({})
    expect(await migrate(A, "value", "own-identity", helper, async () => false)).toEqual({ kind: "migrated", oldDeleted: true })
    expect(calls).toEqual(["stage <A>", "retire <A>", "promote <A>", "remove .old"])
  })

  test("#given a non-owned .old left over #when migrated #then retire takes the next slot and migration proceeds (RULING-73)", async () => {
    const { calls, helper } = scriptedHelper({ "retire <A>": { ok: true, slot: 1 } })
    expect(await migrate(A, "value", "own-identity", helper, async () => false)).toEqual({ kind: "migrated", oldDeleted: true })
    expect(calls).toEqual(["stage <A>", "retire <A>", "promote <A>", "remove .old.1"])
  })

  test("#given every retire slot is taken #when migrated #then staging is removed and the skip names the full slots", async () => {
    const { calls, helper } = scriptedHelper({ "retire <A>": { error: "exists", reason: "old-slots-full" } })
    expect(await migrate(A, "value", "own-identity", helper, async () => false)).toEqual({ kind: "skipped", reason: "old-slots-full" })
    expect(calls).toEqual(["stage <A>", "retire <A>", "remove .staging"])
  })

  test("#given retired copies in slots 0 and 3 #when recovery deletes old #then both slots are removed", async () => {
    const { calls, helper } = scriptedHelper({})
    const outcome = await runRecovery(A, { original: true, staging: false, old: true, oldSlots: [0, 3] }, helper, async () => false)
    expect(calls).toEqual(["remove .old", "remove .old.3"])
    expect(outcome).toEqual({ applied: ["delete-old"], failed: null })
  })

  test.each(["owned", "missing", "", "something-else"])("#given a value whose source is %p #when migrate is asked #then nothing is called", async source => {
    const { calls, helper } = scriptedHelper({})
    expect(await migrate(A, "value", source, helper, async () => true)).toEqual({ kind: "skipped", reason: "not-migratable" })
    expect(calls).toEqual([])
  })

  test.each(["own-identity", "owned-unmarked", "approved"])("#given a %s value #when migrated #then the full sequence runs", async source => {
    const { calls, helper } = scriptedHelper({})
    expect((await migrate(A, "value", source, helper, async () => false)).kind).toBe("migrated")
    expect(calls[0]).toBe("stage <A>")
  })

  test.each(["stage", "retire", "promote"] as const)("#given %s fails #when migrating #then it stops there and reports the step", async step => {
    const { calls, helper } = scriptedHelper({ [`${step} <A>`]: { error: "store" } })
    expect(await migrate(A, "value", "own-identity", helper, async () => false)).toEqual({ kind: "failed", step })
    expect(calls.at(-1)).toBe(`${step} <A>`)
  })
})

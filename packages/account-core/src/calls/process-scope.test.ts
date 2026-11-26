import { describe, expect, test } from "bun:test"

import { processScope, processState } from "./process-scope"

// Custody review of 09d971691e, L3 (a): a reader that cannot read its own scope judges nobody whose record names one
// (security design 8.2, decision D22-17), so an absent pid is no proof the starter is gone.

async function deadPid(): Promise<number> {
  const child = Bun.spawn(["true"])
  await child.exited
  return child.pid
}

describe("the custody reader's judgement of a named process", () => {
  test("#given a reader whose own scope is unreadable and a record naming a scope with an absent pid #then the starter is unknown, not gone", async () => {
    const named = { pid: await deadPid(), start: "a-boot:1", scope: (await processScope()) ?? "a-scope" }
    expect({ unreadable: await processState(named, null), readable: await processState(named, named.scope) }).toEqual({
      unreadable: "unknown",
      readable: "gone",
    })
  })

  // Custody review 6073031252, C1: a live pid in this scope whose present start identity cannot be read is unknown,
  // not alive, so a lock it names breaks at the foreign-scope age and a record it started closes at the horizon.
  test("#given a live pid in this scope whose present start identity cannot be read #then it is unknown, not alive", async () => {
    const own = (await processScope()) ?? "a-scope"
    const named = { pid: process.pid, start: "a-boot:1", scope: own }
    expect({
      unreadable: await processState(named, own, async () => null),
      same: await processState(named, own, async () => "a-boot:1"),
      other: await processState(named, own, async () => "a-boot:2"),
    }).toEqual({ unreadable: "unknown", same: "alive", other: "gone" })
  })
})

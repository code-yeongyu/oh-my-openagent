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
})

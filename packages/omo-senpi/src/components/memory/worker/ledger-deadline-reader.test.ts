import { describe, expect, test } from "bun:test"

import { createLedgerDeadlineReader } from "./ledger-deadline-reader"

describe("parent completion deadline from the run ledger", () => {
  test("#given a queued ledger then an admitted one #when read #then there is no deadline until admission", () => {
    let ledger = JSON.stringify({ queued: true, deadlineAt: 100 })
    const read = createLedgerDeadlineReader("/run", 5, () => ledger)
    expect(read()).toBeUndefined()
    ledger = JSON.stringify({ queued: false, deadlineAt: 200 })
    expect(read()).toBe(205)
  })

  // The reader runs inside timer, fs.watch and promise-executor callbacks; a throw there is an
  // uncaught exception in the user's session (#11161 review). A failed read keeps the last good value.
  test("#given the ledger read fails after a good read #when read again #then it keeps the last deadline instead of throwing", () => {
    let fail = false
    const read = createLedgerDeadlineReader("/run", 5, () => {
      if (fail) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" })
      return JSON.stringify({ queued: false, deadlineAt: 200 })
    })
    expect(read()).toBe(205)
    fail = true
    expect(() => read()).not.toThrow()
    expect(read()).toBe(205)
  })

  test("#given a torn ledger #when read #then it does not throw", () => {
    const read = createLedgerDeadlineReader("/run", 5, () => "{\"queued\": fal")
    expect(() => read()).not.toThrow()
  })
})

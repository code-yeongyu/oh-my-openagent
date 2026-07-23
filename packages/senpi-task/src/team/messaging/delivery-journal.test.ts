import { describe, expect, test } from "bun:test"
import type { Message } from "@oh-my-opencode/team-core/types"

import { createLeadDeliveryJournal } from "./delivery-journal"

const TEAM = "00000000-0000-4000-8000-000000000000"
const OTHER_TEAM = "11111111-1111-4111-8111-111111111111"

function message(id: string, from = "alpha"): Message {
  return { version: 1, messageId: id, from, to: "lead", kind: "message", body: `body-${id}`, timestamp: 1 }
}

describe("lead delivery journal", () => {
  test("#given recorded messages #when drained #then it returns the oldest unreported first and reports atomically", () => {
    // given
    const journal = createLeadDeliveryJournal()
    journal.record(TEAM, message("m1"))
    journal.record(TEAM, message("m2"))

    // when / then
    expect(journal.takeOldestUnreported(TEAM, {})?.messageId).toBe("m1")
    expect(journal.takeOldestUnreported(TEAM, {})?.messageId).toBe("m2")
    expect(journal.takeOldestUnreported(TEAM, {})).toBeUndefined()
  })

  test("#given mixed senders #when drained with a from filter #then only matching messages are taken and the rest stay unreported", () => {
    // given
    const journal = createLeadDeliveryJournal()
    journal.record(TEAM, message("m1", "alpha"))
    journal.record(TEAM, message("m2", "beta"))

    // when / then
    expect(journal.takeOldestUnreported(TEAM, { from: "beta" })?.messageId).toBe("m2")
    expect(journal.takeOldestUnreported(TEAM, { from: "beta" })).toBeUndefined()
    expect(journal.takeOldestUnreported(TEAM, { from: "alpha" })?.messageId).toBe("m1")
  })

  test("#given two teams #when drained #then deliveries stay isolated per team", () => {
    // given
    const journal = createLeadDeliveryJournal()
    journal.record(TEAM, message("m1"))

    // when / then
    expect(journal.takeOldestUnreported(OTHER_TEAM, {})).toBeUndefined()
    expect(journal.takeOldestUnreported(TEAM, {})?.messageId).toBe("m1")
  })

  test("#given a reported message that is re-recorded #when drained #then it is unreported again", () => {
    // given
    const journal = createLeadDeliveryJournal()
    journal.record(TEAM, message("m1"))
    journal.markReported(TEAM, "m1")
    expect(journal.takeOldestUnreported(TEAM, {})).toBeUndefined()

    // when the same message is reserved again (recovery redelivery)
    journal.record(TEAM, message("m1"))

    // then
    expect(journal.takeOldestUnreported(TEAM, {})?.messageId).toBe("m1")
  })

  test("#given more deliveries than the cap #when drained #then the oldest are evicted and order is preserved", () => {
    // given
    const journal = createLeadDeliveryJournal({ maxPerTeam: 3 })
    for (const id of ["m1", "m2", "m3", "m4", "m5"]) journal.record(TEAM, message(id))

    // when / then
    expect(journal.takeOldestUnreported(TEAM, {})?.messageId).toBe("m3")
    expect(journal.takeOldestUnreported(TEAM, {})?.messageId).toBe("m4")
    expect(journal.takeOldestUnreported(TEAM, {})?.messageId).toBe("m5")
    expect(journal.takeOldestUnreported(TEAM, {})).toBeUndefined()
  })
})

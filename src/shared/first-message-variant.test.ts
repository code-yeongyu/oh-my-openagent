import { describe, expect, test } from "bun:test"
import { createFirstMessageVariantGate } from "./first-message-variant"

describe("createFirstMessageVariantGate", () => {
  test("marks new sessions and clears after apply", () => {
    // #given
    const gate = createFirstMessageVariantGate()

    // #when
    gate.markSessionCreated({ id: "session-1" })

    // #then
    expect(gate.shouldOverride("session-1")).toBe(true)

    // #when
    gate.markApplied("session-1")

    // #then
    expect(gate.shouldOverride("session-1")).toBe(false)
  })

  test("ignores forked sessions", () => {
    // #given
    const gate = createFirstMessageVariantGate()

    // #when
    gate.markSessionCreated({ id: "session-2", parentID: "session-parent" })

    // #then
    expect(gate.shouldOverride("session-2")).toBe(false)
  })
})

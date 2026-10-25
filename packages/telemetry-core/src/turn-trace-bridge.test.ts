import { afterEach, describe, expect, test } from "bun:test"

import { clearTurnTraceparent, isTraceparent, publishTurnTraceparent, readTurnTraceparent } from "./turn-trace-bridge"

const A = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
const B = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"

afterEach(() => {
  clearTurnTraceparent("session-a")
  clearTurnTraceparent("session-b")
})

describe("turn traceparent bridge", () => {
  test("#given two sessions #when each publishes its turn #then each reads back only its own value and a cleared session reads none", () => {
    // when
    publishTurnTraceparent("session-a", A)
    publishTurnTraceparent("session-b", B)

    // then
    expect(readTurnTraceparent("session-a")).toBe(A)
    expect(readTurnTraceparent("session-b")).toBe(B)
    clearTurnTraceparent("session-a")
    expect(readTurnTraceparent("session-a")).toBeUndefined()
    expect(readTurnTraceparent("session-b")).toBe(B)
  })

  test("#given a second copy of this module in another bundle #when it reads the registry #then it sees the value the first copy published (one process-wide registry)", async () => {
    // given
    publishTurnTraceparent("session-a", A)

    // when
    const copy = await import(`./turn-trace-bridge.ts?copy=${Date.now()}`)

    // then
    expect(copy.readTurnTraceparent("session-a")).toBe(A)
  })

  test("#given header values #then only a version-00 W3C traceparent with non-zero lowercase ids is accepted, and an invalid one is never published", () => {
    expect(isTraceparent(A)).toBe(true)
    expect(isTraceparent(A.replace(/-01$/, "-00"))).toBe(true)
    for (const bad of [
      "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
      "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
      "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      "00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01",
      `${A}-extra`,
      "",
      undefined,
    ]) {
      expect(isTraceparent(bad)).toBe(false)
    }
    publishTurnTraceparent("session-a", "garbage")
    expect(readTurnTraceparent("session-a")).toBeUndefined()
  })
})

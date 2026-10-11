import { describe, expect, test } from "bun:test"

import { createOwnStartIdentity } from "./lock-owner"

function scriptedReader(answers: ReadonlyArray<string | null>): { readonly read: () => string | null; readonly calls: () => number } {
  let calls = 0
  return {
    read: () => answers[Math.min(calls++, answers.length - 1)] ?? null,
    calls: () => calls,
  }
}

describe("own start identity", () => {
  test("#given a failed read #when asked again #then it is retried after a backoff and a success is kept", () => {
    // given
    let now = 0
    const reader = scriptedReader([null, null, "proc-start-epoch:42"])
    const ownIdentity = createOwnStartIdentity(reader.read, () => now)

    // when / then - fail at 0, wait 1 s, fail at 1000, wait 2 s, succeed at 3000, then cached
    expect(ownIdentity()).toBe("unavailable")
    now = 999
    expect(ownIdentity()).toBe("unavailable")
    expect(reader.calls()).toBe(1)
    now = 1_000
    expect(ownIdentity()).toBe("unavailable")
    now = 2_999
    expect(ownIdentity()).toBe("unavailable")
    expect(reader.calls()).toBe(2)
    now = 3_000
    expect(ownIdentity()).toBe("proc-start-epoch:42")
    now = 100_000
    expect(ownIdentity()).toBe("proc-start-epoch:42")
    expect(reader.calls()).toBe(3)
  })

  test("#given a reader that never succeeds #when asked for an hour #then the retry interval is capped at one minute", () => {
    // given
    let now = 0
    const reader = scriptedReader([null])
    const ownIdentity = createOwnStartIdentity(reader.read, () => now)

    // when - ask every second for an hour
    for (now = 0; now <= 3_600_000; now += 1_000) ownIdentity()

    // then - 1+2+4+...+32 s of doubling (6 reads by 63 s), then one read per 60 s for the rest
    expect(reader.calls()).toBe(6 + Math.floor((3_600_000 - 63_000) / 60_000) + 1)
  })
})

import { describe, expect, test } from "bun:test"

import { runVerificationGate } from "./verify"

function makeInput(command: string, overrides: Partial<Parameters<typeof runVerificationGate>[0]> = {}) {
  return {
    cwd: "/tmp",
    command,
    timeoutMs: 10000,
    abort: new AbortController().signal,
    ...overrides,
  }
}

describe("runVerificationGate", () => {
  test("#given a passing gate #when run #then reports verified with no evidence", async () => {
    // given / when
    const result = await runVerificationGate(makeInput("true"))

    // then
    expect(result.verified).toBe(true)
  })

  test("#given a failing gate #when run #then reports unverified with captured evidence", async () => {
    // given / when
    const result = await runVerificationGate(makeInput("echo boom && exit 1"))

    // then
    expect(result.verified).toBe(false)
    expect(result.evidence).toContain("boom")
  })

  test("#given a gate that writes to stderr #when run #then stderr is captured in evidence", async () => {
    // given / when
    const result = await runVerificationGate(makeInput("echo oops >&2 && exit 1"))

    // then
    expect(result.verified).toBe(false)
    expect(result.evidence).toContain("oops")
  })

  test("#given a hanging gate #when the timeout expires #then rejects", async () => {
    // given / when / then
    await expect(
      runVerificationGate(makeInput("sleep 30", { timeoutMs: 300 })),
    ).rejects.toThrow("exceeded 300ms")
  })
})
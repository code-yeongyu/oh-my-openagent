import { describe, expect, it } from "vitest"

import { ConsentPrompts, type PromptRequest } from "../src/index.ts"

function prompts(answer: "granted" | "denied" = "granted") {
  const asked: PromptRequest[] = []
  let revokes = 0
  const bridge = new ConsentPrompts({
    ask: async (request) => {
      asked.push(request)
      return answer
    },
    revoke: async () => {
      revokes += 1
    },
  })
  return { bridge, asked, revokes: () => revokes }
}

describe("call-budgeted consent prompts", () => {
  it("prompt_under_8s_budget_is_refused", async () => {
    // Given a computer call with 7.9 s left.
    const { bridge, asked } = prompts()

    // When it needs the foreground grant.
    const outcome = await bridge.request({ kind: "foreground", app: "Notes", callRemainingMs: 7_900 })

    // Then no prompt opens and the call is refused ControlRequired{budget}.
    expect(outcome).toEqual({ kind: "refused", code: "ControlRequired", reason: "budget" })
    expect(asked).toEqual([])
  })

  it("a prompt's deadline is the call's remaining budget, capped at 45 s", async () => {
    const { bridge, asked } = prompts()
    await bridge.request({ kind: "foreground", app: "Notes", callRemainingMs: 60_000 })
    await bridge.request({ kind: "tier", app: "Notes", callRemainingMs: 20_000 })
    expect(asked.map((request) => request.deadlineMs)).toEqual([45_000, 20_000])
  })

  it("consent_revoked_on_call_failure", async () => {
    // Given a foreground grant the human gave for a call.
    const { bridge, asked, revokes } = prompts()
    expect(await bridge.request({ kind: "foreground", app: "Notes", callRemainingMs: 30_000 })).toEqual({
      kind: "granted",
    })

    // When that call fails.
    await bridge.onCallFailed()

    // Then the grant is revoked in the engine and the next foreground call asks again.
    expect(revokes()).toBe(1)
    await bridge.request({ kind: "foreground", app: "Notes", callRemainingMs: 30_000 })
    expect(asked).toHaveLength(2)
  })

  it("agent end and shutdown revoke a held grant too; with none held nothing is sent", async () => {
    const { bridge, revokes } = prompts()
    await bridge.onAgentEnd()
    expect(revokes()).toBe(0)
    await bridge.request({ kind: "foreground", app: "Notes", callRemainingMs: 30_000 })
    await bridge.onAgentEnd()
    await bridge.request({ kind: "foreground", app: "Notes", callRemainingMs: 30_000 })
    await bridge.onShutdown()
    expect(revokes()).toBe(2)
  })

  it("a consent prompt can never land on an ended computer call", async () => {
    // Given a prompt open for a call, and the call ends before the human answers.
    let answer: (value: "granted") => void = () => undefined
    const bridge = new ConsentPrompts({
      ask: () =>
        new Promise((resolve) => {
          answer = resolve
        }),
      revoke: async () => undefined,
    })
    const call = new AbortController()
    const pending = bridge.request({ kind: "foreground", app: "Notes", callRemainingMs: 30_000, signal: call.signal })
    call.abort()

    // When the human then grants.
    answer("granted")

    // Then the grant does not land: the call reads withdrawn and the next request asks afresh.
    expect(await pending).toEqual({ kind: "withdrawn" })
  })
})

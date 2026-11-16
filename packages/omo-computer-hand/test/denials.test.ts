import { describe, expect, it } from "vitest"

import { ConsentPrompts } from "../src/index.ts"

function counting(answers: Array<"granted" | "denied">) {
  let asked = 0
  const bridge = new ConsentPrompts({
    ask: async () => answers[asked++] ?? "granted",
    revoke: async () => undefined,
  })
  return { bridge, asked: () => asked }
}

describe("denial memory and per-app stop (acceptance 71, 72)", () => {
  it("a denied prompt is not asked again in the same turn; a newer user message clears it", async () => {
    // Given the human denies a foreground prompt once.
    const { bridge, asked } = counting(["denied"])
    expect(await bridge.request({ kind: "foreground", app: "Notes", callRemainingMs: 30_000 })).toEqual({
      kind: "denied",
    })

    // When the same request comes again in this turn, no prompt opens.
    expect(await bridge.request({ kind: "foreground", app: "Notes", callRemainingMs: 30_000 })).toEqual({
      kind: "refused",
      code: "ControlRequired",
      reason: "denied_this_turn",
    })
    expect(asked()).toBe(1)

    // Then a newer user message clears the memory and the third request prompts.
    bridge.onUserMessage()
    expect(await bridge.request({ kind: "foreground", app: "Notes", callRemainingMs: 30_000 })).toEqual({
      kind: "granted",
    })
    expect(asked()).toBe(2)
  })

  it("a denial is remembered per kind and app, never for another app", async () => {
    const { bridge, asked } = counting(["denied", "granted"])
    await bridge.request({ kind: "app_scope", app: "Mail", callRemainingMs: 30_000 })
    expect(await bridge.request({ kind: "app_scope", app: "Notes", callRemainingMs: 30_000 })).toEqual({
      kind: "granted",
    })
    expect(asked()).toBe(2)
  })

  it("Stop computer use in <app> refuses that app with nothing asked, leaves other apps and the grant alone, and a newer user message restores it", async () => {
    // Given a foreground grant and the user's per-app stop on Notes.
    const { bridge, asked } = counting(["granted"])
    await bridge.request({ kind: "foreground", app: "Mail", callRemainingMs: 30_000 })
    bridge.stopApp("Notes")

    // Then Notes is refused app_scope/user_stopped, Mail still admits, the grant was not revoked.
    expect(bridge.admitApp("Notes")).toEqual({
      kind: "refused",
      code: "ControlRequired",
      reason: "app_scope",
      detail: "user_stopped",
    })
    expect(bridge.admitApp("Mail")).toEqual({ kind: "admitted" })
    expect(bridge.holdsForegroundGrant()).toBe(true)
    expect(asked()).toBe(1)

    // When a newer user message arrives, Notes is back in scope.
    bridge.onUserMessage()
    expect(bridge.admitApp("Notes")).toEqual({ kind: "admitted" })
  })
})

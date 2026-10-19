import { describe, expect, test } from "bun:test"
import { hasActiveNativeContextMode, withNativePluginLookup } from "./native-plugin-context"

describe("native plugin capability bridge", () => {
  test("unsupported host keeps the Claude bridge", async () => {
    expect(await hasActiveNativeContextMode({})).toBe(false)
  })

  test("reads activation state afresh and scopes it to this host context", async () => {
    let status = "loading"
    const input = withNativePluginLookup({}, async () => ({ data: [{ id: "context-mode", state: { status } }] }))
    expect(await hasActiveNativeContextMode(input)).toBe(false)
    status = "active"
    expect(await hasActiveNativeContextMode(input)).toBe(true)
    expect(await hasActiveNativeContextMode({})).toBe(false)
    status = "error"
    expect(await hasActiveNativeContextMode(input)).toBe(false)
  })

  test("does not mistake configuration or a similar plugin id for active native ownership", async () => {
    for (const result of [{ data: [{ id: "context-mode" }] }, { data: [{ id: "not-context-mode", state: { status: "active" } }] }, null, {}]) {
      expect(await hasActiveNativeContextMode(withNativePluginLookup({}, async () => result))).toBe(false)
    }
  })
})

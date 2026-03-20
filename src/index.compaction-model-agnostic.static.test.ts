import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

describe("experimental.session.compacting", () => {
  test("does not hardcode a model and uses output.context", () => {
    //#given
    const indexUrl = new URL("./index.ts", import.meta.url)
    const content = readFileSync(indexUrl, "utf-8")
    const hookIndex = content.indexOf('"experimental.session.compacting"')

    //#when
    const hookSlice = hookIndex >= 0 ? content.slice(hookIndex, hookIndex + 1200) : ""

    //#then
    expect(hookIndex).toBeGreaterThanOrEqual(0)
    expect(content.includes('modelID: "claude-opus-4-6"')).toBe(false)
    expect(hookSlice.includes("output.context.push")).toBe(true)
    expect(hookSlice.includes("providerID:")).toBe(false)
    expect(hookSlice.includes("modelID:")).toBe(false)
  })
})

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

describe("experimental.session.compacting", () => {
  test("does not hardcode a model and uses output.context", () => {
    //#given
    const moduleUrl = new URL("./testing/create-plugin-module.ts", import.meta.url)
    const compactionUrl = new URL("./plugin/session-compacting.ts", import.meta.url)
    const content = readFileSync(moduleUrl, "utf-8")
    const compactionContent = readFileSync(compactionUrl, "utf-8")

    //#when
    const hookIndex = content.indexOf("createSessionCompactingHandler")

    //#then
    expect(hookIndex).toBeGreaterThanOrEqual(0)
    expect(`${content}\n${compactionContent}`.includes('modelID: "claude-opus-4-7"')).toBe(false)
    expect(compactionContent.includes("output.context.push")).toBe(true)
    expect(compactionContent.includes("providerID:")).toBe(false)
    expect(compactionContent.includes("modelID:")).toBe(false)
  })

  test("registers autocontinue restores before OpenCode synthetic continue", () => {
    //#given
    const moduleUrl = new URL("./testing/create-plugin-module.ts", import.meta.url)
    const compactionUrl = new URL("./plugin/session-compacting.ts", import.meta.url)
    const content = readFileSync(moduleUrl, "utf-8")
    const compactionContent = readFileSync(compactionUrl, "utf-8")

    //#when
    const hookIndex = content.indexOf("createCompactionAutocontinueHandler")

    //#then
    expect(hookIndex).toBeGreaterThanOrEqual(0)
    expect(compactionContent.includes("compactionContextInjector?.restore")).toBe(true)
    expect(compactionContent.includes("compactionTodoPreserver?.restore")).toBe(true)
  })
})

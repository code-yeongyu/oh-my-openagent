import { describe, expect, it } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

import { createMetaGovernorHook } from "./index"

const createMockPluginInput = (): PluginInput => ({
  client: {} as PluginInput["client"],
  directory: "/tmp/test",
} as PluginInput)

describe("createMetaGovernorHook", () => {
  it("returns empty handlers when disabled", () => {
    // given
    const ctx = createMockPluginInput()

    // when
    const hook = createMetaGovernorHook(ctx, { config: { enabled: false, hook_enabled: true, observed_tools: ["edit"] } })

    // then
    expect(hook["tool.execute.after"]).toBeUndefined()
  })

  it("returns tool.execute.after when enabled", () => {
    // given
    const ctx = createMockPluginInput()

    // when
    const hook = createMetaGovernorHook(ctx, { config: { enabled: true, hook_enabled: true, observed_tools: ["edit"] } })

    // then
    expect(typeof hook["tool.execute.after"]).toBe("function")
  })

  it("ignores non-observed tools", async () => {
    // given
    const ctx = createMockPluginInput()
    const hook = createMetaGovernorHook(ctx, { config: { enabled: true, hook_enabled: true, observed_tools: ["edit"] } })
    const output = { title: "Tool", output: "ok", metadata: {} }

    // when
    await hook["tool.execute.after"]({ tool: "read", sessionID: "s", callID: "c" }, output)

    // then
    expect(output.output).toBe("ok")
  })
})

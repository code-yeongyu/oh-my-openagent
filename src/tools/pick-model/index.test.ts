/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"

import { createPickModelTool } from "./index"
import { getOverride, setAutoPick } from "../../features/roles-models"
import { _resetAllForTests } from "../../features/roles-models/state"
import type { OhMyOpenCodeConfig } from "../../config"

const baseConfig = {
  display: { auto_pick: true, auto_pick_budget: 2 },
  agents: {
    sisyphus: {
      model: "anthropic/claude-opus-4-7",
      variant: "max",
      fallback_models: [
        { model: "opencode-go/kimi-k2.6" },
        { model: "opencode-go/glm-5.1" },
      ],
    },
    hephaestus: {
      model: "openai/gpt-5.5",
      variant: "medium",
    },
  },
} as unknown as OhMyOpenCodeConfig

function makeCtx(sessionID = "s1"): Parameters<ReturnType<typeof createPickModelTool>["execute"]>[1] {
  return {
    sessionID,
    messageID: "m1",
    agent: "sisyphus",
    directory: "/tmp",
    worktree: "/tmp",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

describe("pick_model tool", () => {
  beforeEach(() => {
    _resetAllForTests()
  })

  test("#given auto_pick disabled in config and no session override #when called #then refuses", async () => {
    const tool = createPickModelTool({
      pluginConfig: { ...baseConfig, display: { auto_pick: false } } as OhMyOpenCodeConfig,
    })

    const result = await tool.execute(
      { role: "sisyphus", model: "opencode-go/kimi-k2.6" },
      makeCtx(),
    )

    expect(result).toContain("disabled")
    expect(getOverride("s1", "sisyphus")).toBeUndefined()
  })

  test("#given session-level /auto-pick on #when called #then accepts even if config default is false", async () => {
    setAutoPick("s1", true)
    const tool = createPickModelTool({
      pluginConfig: { ...baseConfig, display: { auto_pick: false } } as OhMyOpenCodeConfig,
    })

    const result = await tool.execute(
      { role: "sisyphus", model: "opencode-go/kimi-k2.6" },
      makeCtx(),
    )

    expect(result).toContain("Active model")
    expect(getOverride("s1", "sisyphus")).toEqual({ model: "opencode-go/kimi-k2.6" })
  })

  test("#given a valid chain entry #when called #then sets the override", async () => {
    const tool = createPickModelTool({ pluginConfig: baseConfig })

    const result = await tool.execute(
      { role: "sisyphus", model: "opencode-go/kimi-k2.6", reason: "primary timed out" },
      makeCtx(),
    )

    expect(result).toContain("opencode-go/kimi-k2.6")
    expect(result).toContain("primary timed out")
    expect(getOverride("s1", "sisyphus")).toEqual({ model: "opencode-go/kimi-k2.6" })
  })

  test("#given a model that isn't declared in the role's chain #when called #then refuses", async () => {
    const tool = createPickModelTool({ pluginConfig: baseConfig })

    const result = await tool.execute(
      { role: "sisyphus", model: "openai/gpt-5.5" },
      makeCtx(),
    )

    expect(result).toContain("not in sisyphus's declared chain")
    expect(getOverride("s1", "sisyphus")).toBeUndefined()
  })

  test("#given an unknown role #when called #then refuses with role list", async () => {
    const tool = createPickModelTool({ pluginConfig: baseConfig })

    const result = await tool.execute(
      { role: "nonexistent", model: "anthropic/claude-opus-4-7" },
      makeCtx(),
    )

    expect(result).toContain("Unknown role")
    expect(result).toContain("sisyphus")
  })

  test("#given budget of 2 #when called 3 times for same role #then third is refused", async () => {
    const tool = createPickModelTool({ pluginConfig: baseConfig })

    const r1 = await tool.execute({ role: "sisyphus", model: "opencode-go/kimi-k2.6" }, makeCtx())
    const r2 = await tool.execute({ role: "sisyphus", model: "opencode-go/glm-5.1" }, makeCtx())
    const r3 = await tool.execute({ role: "sisyphus", model: "opencode-go/kimi-k2.6" }, makeCtx())

    expect(r1).toContain("Active model")
    expect(r2).toContain("Active model")
    expect(r3).toContain("Budget exhausted")
  })

  test("#given matching primary model #when called with variant #then accepts", async () => {
    const tool = createPickModelTool({ pluginConfig: baseConfig })

    const result = await tool.execute(
      { role: "sisyphus", model: "anthropic/claude-opus-4-7", variant: "max" },
      makeCtx(),
    )

    expect(result).toContain("Active model")
    expect(getOverride("s1", "sisyphus")).toEqual({
      model: "anthropic/claude-opus-4-7",
      variant: "max",
    })
  })
})

import { describe, expect, test } from "bun:test"
import {
  createSisyphusJuniorAgentWithOverrides,
  getSisyphusJuniorPromptSource,
  buildSisyphusJuniorPrompt,
} from "./index"
import { buildDefaultSisyphusJuniorPrompt } from "./default"

describe("getSisyphusJuniorPromptSource for DeepSeek", () => {
  test("#given DeepSeek V4 model ids #when routed #then selects the deepseek source", () => {
    // given
    const cases = [
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-pro",
      "opencode-go/deepseek-v4-flash",
    ] as const

    // when
    const sources = cases.map((model) => getSisyphusJuniorPromptSource(model))

    // then
    expect(sources).toEqual(["deepseek", "deepseek", "deepseek"])
  })

  test("#given non-DeepSeek models #when routed #then keeps their existing sources", () => {
    // given / when / then
    expect(getSisyphusJuniorPromptSource("anthropic/claude-sonnet-5")).toBe("default")
    expect(getSisyphusJuniorPromptSource("zai/glm-5.2")).toBe("glm-5-2")
    expect(getSisyphusJuniorPromptSource("opencode-go/kimi-k3")).toBe("kimi-k3")
  })
})

describe("createSisyphusJuniorAgentWithOverrides on DeepSeek", () => {
  test("#given deepseek-v4-flash #when created #then skips Claude thinking and injected reasoningEffort", () => {
    // given
    const override = { model: "deepseek/deepseek-v4-flash" }

    // when
    const result = createSisyphusJuniorAgentWithOverrides(override)

    // then
    expect(result.thinking).toBeUndefined()
    expect(result.reasoningEffort).toBeUndefined()
  })

  test("#given a DeepSeek model #when created #then stays a subagent with task denied and call_omo_agent allowed", () => {
    // given
    const override = { model: "deepseek/deepseek-v4-flash" }

    // when
    const result = createSisyphusJuniorAgentWithOverrides(override)

    // then
    expect(result.mode).toBe("subagent")
    const permission = result.permission as Record<string, string>
    expect(permission.task).toBe("deny")
    expect(permission.call_omo_agent).toBe("allow")
  })

  test("#given a DeepSeek model #when created #then routes away from the default prompt builder", () => {
    // given
    const override = { model: "deepseek/deepseek-v4-flash" }

    // when
    const result = createSisyphusJuniorAgentWithOverrides(override)

    // then
    expect(result.prompt).not.toBe(buildDefaultSisyphusJuniorPrompt(false))
    expect(result.prompt).toBe(buildSisyphusJuniorPrompt("deepseek/deepseek-v4-flash", false))
  })

  test("#given useTaskSystem=true #when created on DeepSeek #then wires the task tool contract sentinels", () => {
    // given
    const override = { model: "deepseek/deepseek-v4-flash" }

    // when
    const result = createSisyphusJuniorAgentWithOverrides(override, undefined, true)

    // then
    expect(result.prompt).toContain("task_create")
    expect(result.prompt).toContain("task_update")
    expect(result.prompt).not.toContain("todowrite")
  })
})

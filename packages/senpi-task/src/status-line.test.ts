import { describe, expect, test } from "bun:test"

import { composeStatusLine, formatStatusTarget, taskIdentityLabel } from "./status-line"

describe("taskIdentityLabel", () => {
  test("#given a description #when labelled #then the human description wins over name and id", () => {
    // given / when / then
    expect(taskIdentityLabel({ taskId: "st_00000001", name: "task-1", description: "Audit renderers" })).toBe("Audit renderers")
  })

  test("#given no description #when labelled #then the stable name is used", () => {
    // given / when / then
    expect(taskIdentityLabel({ taskId: "st_00000001", name: "reviewer" })).toBe("reviewer")
  })

  test("#given neither description nor name #when labelled #then the id remains as the last-resort handle", () => {
    // given / when / then
    expect(taskIdentityLabel({ taskId: "st_00000001" })).toBe("st_00000001")
  })

  test("#given blank labels #when labelled #then whitespace-only values are ignored", () => {
    // given / when / then
    expect(taskIdentityLabel({ taskId: "st_00000001", name: "  ", description: "\n" })).toBe("st_00000001")
  })

  test("#given an overlong description #when labelled #then it is excerpted for one status row", () => {
    // given a description far wider than a status row
    const label = taskIdentityLabel({ taskId: "st_00000001", description: "x".repeat(80) })

    // then
    expect(label.length).toBeLessThanOrEqual(48)
    expect(label.endsWith("...")).toBe(true)
  })
})

describe("formatStatusTarget", () => {
  test("#given a category and resolved model #when formatted #then the model is qualified in parentheses", () => {
    // given / when / then
    expect(
      formatStatusTarget({
        category: "quick",
        resolvedModel: { provider: "apitopia", model_id: "kimi-k3", display: "kimi-k3", reasoning_effort: "max", source: "category" },
      }),
    ).toBe("quick (apitopia/kimi-k3:max)")
  })

  test("#given only an agent type #when formatted #then the agent name is the target", () => {
    // given / when / then
    expect(formatStatusTarget({ agentType: "momus" })).toBe("momus")
  })

  test("#given model metadata with terminal controls #when formatted #then every part is normalized", () => {
    // given / when / then
    expect(
      formatStatusTarget({
        category: "quick",
        resolvedModel: {
          provider: "openai",
          model_id: "gpt-5.6-sol",
          display: "GPT\u001b]0;hidden\u0007-5.6 Sol",
          reasoning_effort: "xhigh\u0007",
          variant: "sol\u007f",
          source: "category",
        },
      }),
    ).toBe("quick (openai/gpt-5.6-sol:xhigh)")
  })

  test("#given a category but only a raw model #when formatted #then the sanitized raw model qualifies the target", () => {
    // given / when / then
    expect(formatStatusTarget({ category: "quick", model: "anthropic/claude-sonnet-4-5" })).toBe("quick (anthropic/claude-sonnet-4-5)")
    expect(formatStatusTarget({ model: "anthropic/claude-sonnet-4-5" })).toBe("anthropic/claude-sonnet-4-5")
    expect(formatStatusTarget({ category: "quick", model: "raw\u001b[31m-model" })).toBe("quick (raw-model)")
  })

  test("#given no target facts #when formatted #then nothing is emitted", () => {
    // given / when / then
    expect(formatStatusTarget({})).toBeUndefined()
  })
})

describe("composeStatusLine", () => {
  test("#given full live facts #when composed #then tokens follow the canonical identity-first grammar", () => {
    // given / when
    const line = composeStatusLine({
      identity: "Audit renderers",
      target: "quick (apitopia/kimi-k3:max)",
      stats: { runtime_ms: 1_000, turns: 3, tool_calls: 7, tokens_per_second: 62 },
      verb: "running read src/foo.ts",
    })

    // then
    expect(line).toBe("Audit renderers · quick (apitopia/kimi-k3:max) · turn 3 (7 tools) · running read src/foo.ts · 62 tok/s")
  })

  test("#given a single tool call #when composed #then the tool noun is singular", () => {
    // given / when / then
    expect(
      composeStatusLine({ identity: "t", stats: { runtime_ms: 0, turns: 1, tool_calls: 1 }, verb: "running" }),
    ).toBe("t · turn 1 (1 tool) · running")
  })

  test("#given no stats #when composed #then only known tokens are emitted", () => {
    // given / when / then
    expect(composeStatusLine({ identity: "t", verb: "waiting (running)" })).toBe("t · waiting (running)")
  })
})

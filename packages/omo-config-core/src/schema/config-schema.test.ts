import { describe, expect, test } from "bun:test"
import { OmoConfigSchema } from "../index"

describe("omo config schema", () => {
  test("#given a full omo config #when parsed #then task defaults and category camelCase keys are preserved", () => {
    // given
    const config = {
      $schema: "https://example.com/omo.schema.json",
      categories: {
        deep: {
          description: "Deep analysis",
          model: "anthropic/claude",
          fallback_models: ["openai/gpt"],
          variant: "high",
          temperature: 0.2,
          top_p: 0.9,
          maxTokens: 12000,
          thinking: { type: "enabled", budgetTokens: 2048 },
          reasoningEffort: "high",
          textVerbosity: "medium",
          tools: { bash: true },
          prompt_append: "Think carefully.",
          max_prompt_tokens: 2000,
          is_unstable_agent: false,
          disable: false,
        },
      },
      agents: {
        reviewer: {
          description: "Reviews code",
          prompt: "Review this.",
          model: "openai/gpt-5",
          models: ["anthropic/claude"],
          tools: { bash: false, read: true },
          execution_mode: "in-process",
          background: true,
          max_depth: 1,
          allowed_subagents: ["quick"],
          temperature: 0.1,
          disable: false,
        },
      },
      task: {},
      teams: {
        builders: {
          description: "Build team",
          members: [{ name: "quick-one", kind: "category", category: "quick", prompt: "Help" }],
        },
      },
    }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(result.data.task?.default_execution_mode).toBe("in-process")
    expect(result.data.task?.default_concurrency).toBe(5)
    expect(result.data.task?.residency_max_children).toBe(8)
    expect(result.data.categories?.deep?.maxTokens).toBe(12000)
    expect(result.data.categories?.deep?.reasoningEffort).toBe("high")
    expect(result.data.categories?.deep?.textVerbosity).toBe("medium")
    expect(result.data.categories?.deep?.thinking?.budgetTokens).toBe(2048)
  })

  test("#given an unknown root key #when parsed #then the schema rejects the config", () => {
    // given
    const config = { unknown_section: true }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("#given a wrong typed task setting #when parsed #then the issue path identifies the bad field", () => {
    // given
    const config = { task: { default_concurrency: "five" } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
    if (result.success) throw new Error("Expected config parsing to fail")
    const issuePaths = result.error.issues.map((issue) => issue.path.join("."))
    expect(issuePaths).toContain("task.default_concurrency")
  })
})

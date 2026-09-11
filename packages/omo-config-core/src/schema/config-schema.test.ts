import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import {
  loadOmoConfig,
  OmoConfigLayerSchema,
  OmoConfigProfileSchema,
  OmoConfigSchema,
  OmoTypedHarnessConfigSchema,
} from "../index"

function makeConfigFixture(): { readonly cwd: string; readonly homeDir: string; readonly root: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-config-model-profiles-"))
  const homeDir = join(root, "home")
  const cwd = join(homeDir, "project")
  mkdirSync(join(homeDir, ".omo"), { recursive: true })
  mkdirSync(cwd, { recursive: true })
  return { cwd, homeDir, root }
}

describe("omo config schema", () => {
  test("#given an empty formatOnMutation config #when parsed #then formatter defaults are available", () => {
    expect(OmoConfigSchema.parse({ formatOnMutation: {} }).formatOnMutation).toEqual({ mode: "best-effort", maxFileBytes: 1048576, timeoutMs: 3000 })
  })

  test("#given formatOnMutation overrides #when parsed #then mode limits and language map survive", () => {
    expect(OmoConfigSchema.parse({ formatOnMutation: { mode: "required", languages: { python: false }, timeoutMs: 1000 } }).formatOnMutation).toEqual({ mode: "required", languages: { python: false }, maxFileBytes: 1048576, timeoutMs: 1000 })
  })
  test("#given a full omo config #when parsed #then task defaults and deprecated category keys normalize", () => {
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
      git_master: { include_co_authored_by: false },
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
    expect(result.data.git_master?.include_co_authored_by).toBe(false)
    expect(result.data.task?.default_execution_mode).toBe("in-process")
    expect(result.data.task?.default_concurrency).toBe(5)
    expect(result.data.task?.residency_max_children).toBe(8)
    expect(result.data.categories?.deep?.max_tokens).toBe(12000)
    expect(result.data.categories?.deep?.reasoning).toBe("high")
    expect(result.data.categories?.deep?.provider_options).toEqual({
      thinking: { type: "enabled", budgetTokens: 2048 },
      textVerbosity: "medium",
    })
  })

  test("#given an empty git_master config #when parsed #then the attribution defaults apply", () => {
    // given
    const config = { git_master: {} }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(result.data.git_master).toEqual({ commit_footer: true, include_co_authored_by: true })
  })

  test("#given an unknown root key #when parsed #then the schema rejects the config", () => {
    // given
    const config = { unknown_section: true }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("#given a wrong typed git_master setting #when parsed #then the issue path identifies the bad field", () => {
    // given
    const config = { git_master: { include_co_authored_by: "yes" } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
    if (result.success) throw new Error("Expected config parsing to fail")
    const issuePaths = result.error.issues.map((issue) => issue.path.join("."))
    expect(issuePaths).toContain("git_master.include_co_authored_by")
  })

  test("#given model_profiles and a selected model_profile #when parsed #then all four strict config shapes accept them", () => {
    // given
    const block = {
      model_profiles: {
        capable: { display_name: "Capable", models: ["anthropic/claude-fable-5-1", { model: "openai/gpt-6-astra", reasoning: "high" }] },
      },
      model_profile: "capable",
    }

    // when
    const results = {
      config: OmoConfigSchema.safeParse(block),
      harness: OmoTypedHarnessConfigSchema.safeParse(block),
      layer: OmoConfigLayerSchema.safeParse(block),
      profile: OmoConfigProfileSchema.safeParse(block),
    }

    // then
    expect(Object.entries(results).map(([shape, result]) => [shape, result.success])).toEqual([
      ["config", true],
      ["harness", true],
      ["layer", true],
      ["profile", true],
    ])
    if (!results.config.success) throw new Error(results.config.error.message)
    expect(results.config.data.model_profile).toBe("capable")
    expect(results.config.data.model_profiles?.capable?.models).toEqual([
      "anthropic/claude-fable-5-1",
      { model: "openai/gpt-6-astra", reasoning: "high" },
    ])
  })

  test("#given a non-string model_profile #when parsed #then the issue path identifies the bad field", () => {
    // given
    const config = { model_profile: 123 }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
    if (result.success) throw new Error("Expected config parsing to fail")
    expect(result.error.issues.map((issue) => issue.path.join("."))).toContain("model_profile")
  })

  test("#given a display_name-only profile beside categories in a user config file #when loaded #then the layer survives instead of being rejected wholesale", () => {
    // given
    const fixture = makeConfigFixture()
    writeFileSync(
      join(fixture.homeDir, ".omo", "omo.json"),
      `{"categories":{"quick":{"model":"user-model"}},"model_profiles":{"capable":{"display_name":"Fast and capable"}},"model_profile":"capable"}`,
    )

    try {
      // when
      const result = loadOmoConfig({ cwd: fixture.cwd, env: { HOME: fixture.homeDir }, harness: "senpi", platform: "linux" })

      // then
      expect(result.diagnostics).toEqual([])
      expect(result.config.categories?.quick?.model).toBe("user-model")
      expect(result.config.model_profiles?.capable).toEqual({ display_name: "Fast and capable" })
      expect(result.config.model_profile).toBe("capable")
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test("#given model_profile inside a [senpi] block #when the senpi view loads #then the harness block selects the profile", () => {
    // given
    const fixture = makeConfigFixture()
    writeFileSync(
      join(fixture.homeDir, ".omo", "omo.json"),
      `{"model_profile":"simple-work","[senpi]":{"model_profile":"deep-work","model_profiles":{"deep-work":{"models":["openai/gpt-6-astra"]}}}}`,
    )

    try {
      // when
      const result = loadOmoConfig({ cwd: fixture.cwd, env: { HOME: fixture.homeDir }, harness: "senpi", platform: "linux" })

      // then
      expect(result.diagnostics).toEqual([])
      expect(result.config.model_profile).toBe("deep-work")
      expect(result.config.model_profiles?.["deep-work"]?.models).toEqual(["openai/gpt-6-astra"])
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
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

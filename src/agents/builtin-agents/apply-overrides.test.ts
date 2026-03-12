import { describe, expect, test } from "bun:test"
import { applyOverrides } from "./agent-overrides"
import type { AgentConfig } from "@opencode-ai/sdk"

interface TestCategoryConfig {
  model?: string
  steps?: number
  permission?: {
    edit?: "allow" | "ask" | "deny"
    bash?: "allow" | "ask" | "deny"
    webfetch?: "allow" | "ask" | "deny"
    task?: "allow" | "ask" | "deny" | boolean
    doom_loop?: boolean
    external_directory?: boolean
  }
}

describe("applyOverrides", () => {
  test("applies category steps/permission then direct override", () => {
    //#given
    const baseConfig: AgentConfig = {
      instructions: "Base instructions",
      model: "anthropic/claude-sonnet-4-6",
    }
    const categoryConfig: TestCategoryConfig = {
      model: "openai/gpt-5.3-codex",
      steps: 100,
      permission: {
        edit: "allow" as const,
        bash: "ask" as const,
        webfetch: "ask" as const,
        task: "allow" as const,
        doom_loop: false,
        external_directory: false,
      },
    }
    const mergedCategories: Record<string, TestCategoryConfig> = {
      "deep": categoryConfig,
    }
    const override = {
      category: "deep",
      steps: 150,
      permission: {
        edit: "deny" as const,
        bash: "deny" as const,
        webfetch: "deny" as const,
        task: false as const,
        doom_loop: true,
        external_directory: true,
      },
    }

    //#when
    const result = applyOverrides(
      baseConfig,
      override as import("../../config/schema").AgentOverrideConfig,
      mergedCategories as Record<string, import("../../config/schema").CategoryConfig>
    )

    //#then
    expect(result.steps).toBe(150)
    expect(result.permission).toEqual({
      edit: "deny",
      bash: "deny",
      webfetch: "deny",
      task: false,
      doom_loop: true,
      external_directory: true,
    })
  })

  test("applies only category when no direct override for steps/permission", () => {
    //#given
    const baseConfig: AgentConfig = {
      instructions: "Base instructions",
      model: "anthropic/claude-sonnet-4-6",
    }
    const categoryConfig: TestCategoryConfig = {
      model: "openai/gpt-5.3-codex",
      steps: 100,
      permission: {
        edit: "allow" as const,
        bash: "allow" as const,
        webfetch: "allow" as const,
        task: "allow" as const,
        doom_loop: false,
        external_directory: false,
      },
    }
    const mergedCategories: Record<string, TestCategoryConfig> = {
      "deep": categoryConfig,
    }
    const override = {
      category: "deep",
    }

    //#when
    const result = applyOverrides(
      baseConfig,
      override as import("../../config/schema").AgentOverrideConfig,
      mergedCategories as Record<string, import("../../config/schema").CategoryConfig>
    )

    //#then
    expect(result.steps).toBe(100)
    expect(result.permission).toEqual({
      edit: "allow",
      bash: "allow",
      webfetch: "allow",
      task: "allow",
      doom_loop: false,
      external_directory: false,
    })
  })
})

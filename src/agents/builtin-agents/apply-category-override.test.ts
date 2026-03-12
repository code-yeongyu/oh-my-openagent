import { describe, expect, test } from "bun:test"
import { applyCategoryOverride } from "./agent-overrides"
import type { AgentConfig } from "@opencode-ai/sdk"

interface TestCategoryConfig {
  description?: string
  model?: string
  variant?: string
  temperature?: number
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

describe("applyCategoryOverride", () => {
  test("propagates steps from category config to agent config", () => {
    //#given
    const baseConfig: AgentConfig = {
      instructions: "Base instructions",
      model: "anthropic/claude-sonnet-4-6",
    }
    const categoryConfig: TestCategoryConfig = {
      model: "openai/gpt-5.3-codex",
      steps: 100,
    }
    const mergedCategories: Record<string, TestCategoryConfig> = {
      "deep": categoryConfig,
    }

    //#when
    const result = applyCategoryOverride(baseConfig, "deep", mergedCategories as Record<string, import("../../config/schema").CategoryConfig>)

    //#then
    expect(result.steps).toBe(100)
  })

  test("propagates permission from category config to agent config", () => {
    //#given
    const baseConfig: AgentConfig = {
      instructions: "Base instructions",
      model: "anthropic/claude-sonnet-4-6",
    }
    const permission = {
      edit: "allow" as const,
      bash: "ask" as const,
      webfetch: "deny" as const,
      task: false as const,
      doom_loop: false,
      external_directory: false,
    }
    const categoryConfig: TestCategoryConfig = {
      model: "openai/gpt-5.3-codex",
      permission,
    }
    const mergedCategories: Record<string, TestCategoryConfig> = {
      "deep": categoryConfig,
    }

    //#when
    const result = applyCategoryOverride(baseConfig, "deep", mergedCategories as Record<string, import("../../config/schema").CategoryConfig>)

    //#then
    expect(result.permission).toEqual(permission)
  })

  test("propagates both steps and permission together", () => {
    //#given
    const baseConfig: AgentConfig = {
      instructions: "Base instructions",
      model: "anthropic/claude-sonnet-4-6",
    }
    const permission = {
      edit: "allow" as const,
      bash: "allow" as const,
      webfetch: "allow" as const,
      task: "allow" as const,
      doom_loop: false,
      external_directory: false,
    }
    const categoryConfig: TestCategoryConfig = {
      model: "openai/gpt-5.4",
      steps: 50,
      permission,
    }
    const mergedCategories: Record<string, TestCategoryConfig> = {
      "ultrabrain": categoryConfig,
    }

    //#when
    const result = applyCategoryOverride(baseConfig, "ultrabrain", mergedCategories as Record<string, import("../../config/schema").CategoryConfig>)

    //#then
    expect(result.steps).toBe(50)
    expect(result.permission).toEqual(permission)
    expect(result.model).toBe("openai/gpt-5.4")
  })

  test("preserves existing steps when category has none", () => {
    //#given
    const baseConfig: AgentConfig = {
      instructions: "Base instructions",
      model: "anthropic/claude-sonnet-4-6",
      steps: 75,
    }
    const categoryConfig: TestCategoryConfig = {
      model: "openai/gpt-5.3-codex",
    }
    const mergedCategories: Record<string, TestCategoryConfig> = {
      "deep": categoryConfig,
    }

    //#when
    const result = applyCategoryOverride(baseConfig, "deep", mergedCategories as Record<string, import("../../config/schema").CategoryConfig>)

    //#then
    expect(result.steps).toBe(75)
    expect(result.model).toBe("openai/gpt-5.3-codex")
  })

  test("preserves existing permission when category has none", () => {
    //#given
    const existingPermission = {
      edit: "deny" as const,
      bash: "deny" as const,
      webfetch: "deny" as const,
      task: false as const,
      doom_loop: true,
      external_directory: true,
    }
    const baseConfig: AgentConfig = {
      instructions: "Base instructions",
      model: "anthropic/claude-sonnet-4-6",
      permission: existingPermission,
    }
    const categoryConfig: TestCategoryConfig = {
      model: "openai/gpt-5.3-codex",
    }
    const mergedCategories: Record<string, TestCategoryConfig> = {
      "deep": categoryConfig,
    }

    //#when
    const result = applyCategoryOverride(baseConfig, "deep", mergedCategories as Record<string, import("../../config/schema").CategoryConfig>)

    //#then
    expect(result.permission).toEqual(existingPermission)
  })

  test("category steps overwrite base steps when present", () => {
    //#given
    const baseConfig: AgentConfig = {
      instructions: "Base instructions",
      model: "anthropic/claude-sonnet-4-6",
      steps: 25,
    }
    const categoryConfig: TestCategoryConfig = {
      model: "openai/gpt-5.3-codex",
      steps: 200,
    }
    const mergedCategories: Record<string, TestCategoryConfig> = {
      "deep": categoryConfig,
    }

    //#when
    const result = applyCategoryOverride(baseConfig, "deep", mergedCategories as Record<string, import("../../config/schema").CategoryConfig>)

    //#then
    expect(result.steps).toBe(200)
  })

  test("category permission overwrites base permission when present", () => {
    //#given
    const basePermission = {
      edit: "deny" as const,
      bash: "deny" as const,
      webfetch: "deny" as const,
      task: false as const,
      doom_loop: true,
      external_directory: true,
    }
    const categoryPermission = {
      edit: "allow" as const,
      bash: "allow" as const,
      webfetch: "allow" as const,
      task: "allow" as const,
      doom_loop: false,
      external_directory: false,
    }
    const baseConfig: AgentConfig = {
      instructions: "Base instructions",
      model: "anthropic/claude-sonnet-4-6",
      permission: basePermission,
    }
    const categoryConfig: TestCategoryConfig = {
      model: "openai/gpt-5.3-codex",
      permission: categoryPermission,
    }
    const mergedCategories: Record<string, TestCategoryConfig> = {
      "deep": categoryConfig,
    }

    //#when
    const result = applyCategoryOverride(baseConfig, "deep", mergedCategories as Record<string, import("../../config/schema").CategoryConfig>)

    //#then
    expect(result.permission).toEqual(categoryPermission)
  })

  test("returns original config when category not found", () => {
    //#given
    const baseConfig: AgentConfig = {
      instructions: "Base instructions",
      model: "anthropic/claude-sonnet-4-6",
    }
    const mergedCategories: Record<string, TestCategoryConfig> = {}

    //#when
    const result = applyCategoryOverride(baseConfig, "nonexistent", mergedCategories as Record<string, import("../../config/schema").CategoryConfig>)

    //#then
    expect(result).toEqual(baseConfig)
  })
})

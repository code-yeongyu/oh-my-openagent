import { describe, expect, test } from "bun:test"
import type { AgentConfig } from "@opencode-ai/sdk"
import { applyOverrides } from "./agent-overrides"

describe("applyOverrides", () => {
  test("applies automatic locale prompt even without explicit overrides", () => {
    const previousLang = process.env.LANG
    process.env.LANG = "zh-CN.UTF-8"
    try {
      const base = { prompt: "Base prompt" } as AgentConfig
      const result = applyOverrides(base, undefined, {})
      expect(result.prompt).toContain("Language Preference")
      expect(result.prompt).toContain("Simplified Chinese")
    } finally {
      process.env.LANG = previousLang
    }
  })
})

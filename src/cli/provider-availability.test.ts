import { describe, expect, it } from "bun:test"
import { createEmptyLocalProviderModels } from "./local-model-capabilities"
import { isProviderAvailable, toProviderAvailability } from "./provider-availability"
import type { InstallConfig } from "./types"

function createInstallConfig(overrides: Partial<InstallConfig> = {}): InstallConfig {
  return {
    hasClaude: false,
    isMax20: false,
    hasOpenAI: false,
    hasGemini: false,
    hasCopilot: false,
    hasOpencodeZen: false,
    hasZaiCodingPlan: false,
    hasKimiForCoding: false,
    hasLmstudio: false,
    hasOllama: false,
    hasVllm: false,
    localProviderModels: createEmptyLocalProviderModels(),
    ...overrides,
  }
}

describe("provider-availability", () => {
  it("maps local providers into ProviderAvailability", () => {
    //#given
    const installConfig = createInstallConfig({
      hasLmstudio: true,
      lmstudioUrl: "http://localhost:1234/v1",
      hasOllama: true,
      ollamaUrl: "http://localhost:11434",
      hasVllm: false,
    })

    //#when
    const availability = toProviderAvailability(installConfig)

    //#then
    expect(availability.lmstudio).toBe(true)
    expect(availability.ollama).toBe(true)
    expect(availability.vllm).toBe(false)
  })

  it("reports local provider availability in isProviderAvailable", () => {
    //#given
    const availability = toProviderAvailability(
      createInstallConfig({
        hasLmstudio: true,
        hasOllama: false,
        hasVllm: true,
      })
    )

    //#when / #then
    expect(isProviderAvailable("lmstudio", availability)).toBe(true)
    expect(isProviderAvailable("ollama", availability)).toBe(false)
    expect(isProviderAvailable("vllm", availability)).toBe(true)
  })
})

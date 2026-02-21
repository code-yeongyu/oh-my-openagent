import { describe, expect, it } from "bun:test"
import {
  mapProbeResultsToLocalProviderModels,
  resolveLocalModelForSelector,
} from "./local-model-capabilities"
import type { LocalProviderProbeResult } from "./local-provider-probe"

describe("local-model-capabilities", () => {
  it("detects devstral models as multimodal and routes to multimodal-looker", () => {
    //#given
    const probeResults: LocalProviderProbeResult[] = [
      {
        provider: "lmstudio",
        url: "http://localhost:1234/v1",
        models: [{ id: "devstral-small", name: "devstral-small", contextLength: 65536 }],
      },
    ]

    //#when
    const mapped = mapProbeResultsToLocalProviderModels(probeResults)

    //#then
    expect(mapped.lmstudio[0].capabilities).toContain("multimodal")
    expect(mapped.lmstudio[0].targets).toContain("multimodal-looker")
    expect(resolveLocalModelForSelector("lmstudio", "local:multimodal-looker", mapped)).toBe("devstral-small")
  })

  it("detects qwen and deepseek models as coding-capable", () => {
    //#given
    const probeResults: LocalProviderProbeResult[] = [
      {
        provider: "ollama",
        url: "http://localhost:11434",
        models: [
          { id: "qwen3-coder:32b", name: "qwen3-coder:32b" },
          { id: "deepseek-coder:16b", name: "deepseek-coder:16b" },
        ],
      },
    ]

    //#when
    const mapped = mapProbeResultsToLocalProviderModels(probeResults)

    //#then
    expect(mapped.ollama[0].capabilities).toContain("coding")
    expect(mapped.ollama[1].capabilities).toContain("coding")
    expect(["qwen3-coder:32b", "deepseek-coder:16b"]).toContain(
      resolveLocalModelForSelector("ollama", "local:librarian", mapped)
    )
  })

  it("assigns unknown models to explore-only fallback", () => {
    //#given
    const probeResults: LocalProviderProbeResult[] = [
      {
        provider: "vllm",
        url: "http://localhost:8000/v1",
        models: [{ id: "my-custom-model", name: "my-custom-model" }],
      },
    ]

    //#when
    const mapped = mapProbeResultsToLocalProviderModels(probeResults)

    //#then
    expect(mapped.vllm[0].targets).toEqual(["explore"])
    expect(resolveLocalModelForSelector("vllm", "local:explore", mapped)).toBe("my-custom-model")
    expect(resolveLocalModelForSelector("vllm", "local:librarian", mapped)).toBeNull()
  })

  it("preserves context length from probe metadata", () => {
    //#given
    const probeResults: LocalProviderProbeResult[] = [
      {
        provider: "lmstudio",
        url: "http://localhost:1234/v1",
        models: [{ id: "codestral-22b", name: "codestral-22b", contextLength: 131072 }],
      },
    ]

    //#when
    const mapped = mapProbeResultsToLocalProviderModels(probeResults)

    //#then
    expect(mapped.lmstudio[0].contextLength).toBe(131072)
    expect(mapped.lmstudio[0].outputLength).toBe(8192)
  })
})

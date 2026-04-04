import { describe, expect, it, mock } from "bun:test"

import { refreshModelCapabilities } from "./refresh-model-capabilities"

describe("refreshModelCapabilities", () => {
  it("uses config source_url when CLI override is absent", async () => {
    const loadConfig = mock(() => ({
      model_capabilities: {
        source_url: "https://mirror.example/api.json",
      },
    }))
    const refreshCache = mock(async () => ({
      generatedAt: "2026-03-25T00:00:00.000Z",
      sourceUrl: "https://mirror.example/api.json",
      models: {
        "gpt-5.4": { id: "gpt-5.4" },
      },
    }))
    let stdout = ""

    const exitCode = await refreshModelCapabilities(
      { directory: "/repo", json: false },
      {
        loadConfig,
        refreshCache,
        stdout: {
          write: (chunk: string) => {
            stdout += chunk
            return true
          },
        } as never,
        stderr: {
          write: () => true,
        } as never,
      },
    )

    expect(exitCode).toBe(0)
    expect(loadConfig).toHaveBeenCalledWith("/repo", null)
    expect(refreshCache).toHaveBeenCalledWith({
      sourceUrl: "https://mirror.example/api.json",
    })
    expect(stdout).toContain("Refreshed model capabilities cache (1 models)")
  })

  it("CLI sourceUrl overrides config and supports json output", async () => {
    const refreshCache = mock(async () => ({
      generatedAt: "2026-03-25T00:00:00.000Z",
      sourceUrl: "https://override.example/api.json",
      models: {
        "gpt-5.4": { id: "gpt-5.4" },
        "claude-opus-4-6": { id: "claude-opus-4-6" },
      },
    }))
    let stdout = ""

    const exitCode = await refreshModelCapabilities(
      {
        directory: "/repo",
        json: true,
        sourceUrl: "https://override.example/api.json",
      },
      {
        loadConfig: () => ({}),
        refreshCache,
        stdout: {
          write: (chunk: string) => {
            stdout += chunk
            return true
          },
        } as never,
        stderr: {
          write: () => true,
        } as never,
      },
    )

    expect(exitCode).toBe(0)
    expect(refreshCache).toHaveBeenCalledWith({
      sourceUrl: "https://override.example/api.json",
    })
    expect(JSON.parse(stdout)).toEqual({
      sourceUrl: "https://override.example/api.json",
      generatedAt: "2026-03-25T00:00:00.000Z",
      modelCount: 2,
    })
  })

  it("returns exit code 1 when refresh fails", async () => {
    let stderr = ""

    const exitCode = await refreshModelCapabilities(
      { directory: "/repo" },
      {
        loadConfig: () => ({}),
        refreshCache: async () => {
          throw new Error("boom")
        },
        stdout: {
          write: () => true,
        } as never,
        stderr: {
          write: (chunk: string) => {
            stderr += chunk
            return true
          },
        } as never,
      },
    )

    expect(exitCode).toBe(1)
    expect(stderr).toContain("Failed to refresh model capabilities cache")
  })
})

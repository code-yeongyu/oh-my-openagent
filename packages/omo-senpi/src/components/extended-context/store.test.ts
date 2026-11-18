import { describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyContextWindowOverrides, clearContextWindowOverrides, readModelsJsonConfig } from "./store"

describe("models.json overrides", () => {
  const widened = [{ id: "gpt-6.1-sol", slug: "gpt-6.1-sol", from: 500_000, to: 744_000 }]

  it("#given a provider with another override #when applied #then only contextWindow is added", () => {
    const { config, written } = applyContextWindowOverrides(
      { providers: { "chatgpt-subscription": { modelOverrides: { "gpt-6.1-sol": { maxTokens: 64_000 } } } } },
      "chatgpt-subscription",
      widened,
    )
    expect(config.providers?.["chatgpt-subscription"]?.modelOverrides?.["gpt-6.1-sol"]).toEqual({
      maxTokens: 64_000,
      contextWindow: 744_000,
    })
    expect(written).toEqual({ "gpt-6.1-sol": 744_000 })
  })

  it("#given an override the command did not write #when cleared #then the user's value survives", () => {
    const config = {
      providers: {
        "chatgpt-subscription": {
          modelOverrides: {
            "gpt-6.1-sol": { contextWindow: 744_000 },
            "gpt-5.5": { contextWindow: 200_000 },
          },
        },
      },
    }
    const { config: cleared, cleared: ids } = clearContextWindowOverrides(config, "chatgpt-subscription", {
      "gpt-6.1-sol": 744_000,
    })
    expect(ids).toEqual(["gpt-6.1-sol"])
    expect(cleared.providers?.["chatgpt-subscription"]?.modelOverrides).toEqual({
      "gpt-5.5": { contextWindow: 200_000 },
    })
  })

  it("#given the provider held only the written window #when cleared #then the provider goes and providers stays", () => {
    const { config } = clearContextWindowOverrides(
      { providers: { "chatgpt-subscription": { modelOverrides: { "gpt-6.1-sol": { contextWindow: 744_000 } } } } },
      "chatgpt-subscription",
      { "gpt-6.1-sol": 744_000 },
    )
    expect(config).toEqual({ providers: {} })
  })

  it("#given a file that exists but does not parse #when read #then it is reported as invalid rather than empty", () => {
    const directory = mkdtempSync(join(tmpdir(), "extended-context-read-"))
    const path = join(directory, "models.json")
    try {
      expect(readModelsJsonConfig(path, false)).toEqual({ kind: "missing", config: {} })
      writeFileSync(path, "{ broken")
      expect(readModelsJsonConfig(path, true)).toEqual({ kind: "invalid" })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

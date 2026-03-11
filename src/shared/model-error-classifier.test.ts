import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as dataPath from "./data-path"
import { shouldRetryError, selectFallbackProvider } from "./model-error-classifier"

describe("model-error-classifier", () => {
  let cacheDirSpy: ReturnType<typeof spyOn>
  let testCacheDir: string

  beforeEach(() => {
    testCacheDir = mkdtempSync(join(tmpdir(), "omo-model-error-"))
    cacheDirSpy = spyOn(dataPath, "getOmoOpenCodeCacheDir").mockReturnValue(testCacheDir)
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true })
    }
    mkdirSync(testCacheDir, { recursive: true })
  })

  afterEach(() => {
    cacheDirSpy.mockRestore()
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true })
    }
  })

  test("treats overloaded retry messages as retryable", () => {
    //#given
    const error = { message: "Provider is overloaded" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats cooling-down auto-retry messages as retryable", () => {
    //#given
    const error = {
      message:
        "All credentials for model claude-opus-4-6-thinking are cooling down [retrying in ~5 days attempt #1]",
    }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("selectFallbackProvider prefers first connected provider in preference order", () => {
    //#given
    writeFileSync(
      join(testCacheDir, "connected-providers.json"),
      JSON.stringify({ connected: ["anthropic", "nvidia"], updatedAt: new Date().toISOString() }, null, 2),
    )

    //#when
    const provider = selectFallbackProvider(["anthropic", "nvidia"], "nvidia")

    //#then
    expect(provider).toBe("anthropic")
  })

  test("selectFallbackProvider falls back to next connected provider when first is disconnected", () => {
    //#given
    writeFileSync(
      join(testCacheDir, "connected-providers.json"),
      JSON.stringify({ connected: ["nvidia"], updatedAt: new Date().toISOString() }, null, 2),
    )

    //#when
    const provider = selectFallbackProvider(["anthropic", "nvidia"])

    //#then
    expect(provider).toBe("nvidia")
  })

  test("selectFallbackProvider uses provider preference order when cache is missing", () => {
    //#given - no cache file

    //#when
    const provider = selectFallbackProvider(["anthropic", "nvidia"], "nvidia")

    //#then
    expect(provider).toBe("anthropic")
  })

  test("selectFallbackProvider uses connected preferred provider when fallback providers are unavailable", () => {
    //#given
    writeFileSync(
      join(testCacheDir, "connected-providers.json"),
      JSON.stringify({ connected: ["provider-x"], updatedAt: new Date().toISOString() }, null, 2),
    )

    //#when
    const provider = selectFallbackProvider(["provider-y"], "provider-x")

    //#then
    expect(provider).toBe("provider-x")
  })
})

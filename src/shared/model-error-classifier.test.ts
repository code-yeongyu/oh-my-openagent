import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"

import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import * as dataPath from "./data-path"
import { shouldRetryError, selectFallbackProvider } from "./model-error-classifier"

const TEST_CACHE_DIR = join(import.meta.dir, "__test-cache__")

describe("model-error-classifier", () => {
  let cacheDirSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    cacheDirSpy = spyOn(dataPath, "getOmoOpenCodeCacheDir").mockReturnValue(TEST_CACHE_DIR)
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true })
    }
    mkdirSync(TEST_CACHE_DIR, { recursive: true })
  })

  afterEach(() => {
    cacheDirSpy.mockRestore()
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true })
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
      join(TEST_CACHE_DIR, "connected-providers.json"),
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
      join(TEST_CACHE_DIR, "connected-providers.json"),
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

  test("selectFallbackProvider maps opencode fallback to quotio when quotio is connected", () => {
    //#given
    writeFileSync(
      join(TEST_CACHE_DIR, "connected-providers.json"),
      JSON.stringify({ connected: ["quotio"], updatedAt: new Date().toISOString() }, null, 2),
    )

    //#when
    const provider = selectFallbackProvider(["opencode"], "quotio")

    //#then
    expect(provider).toBe("quotio")
  })
})

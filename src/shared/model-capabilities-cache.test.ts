/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createModelCapabilitiesCacheStore,
} from "./model-capabilities-cache"

let fakeUserCacheRoot = ""
let testCacheDir = ""

describe("model-capabilities-cache", () => {
  beforeEach(() => {
    fakeUserCacheRoot = mkdtempSync(join(tmpdir(), "model-capabilities-cache-"))
    testCacheDir = join(fakeUserCacheRoot, "oh-my-opencode")
  })

  afterEach(() => {
    if (existsSync(fakeUserCacheRoot)) {
      rmSync(fakeUserCacheRoot, { recursive: true, force: true })
    }
    fakeUserCacheRoot = ""
    testCacheDir = ""
  })

  test("refresh writes cache and preserves unrelated files in the cache directory", async () => {
    //#given
    const sentinelPath = join(testCacheDir, "keep-me.json")
    const store = createModelCapabilitiesCacheStore(() => testCacheDir)
    mkdirSync(testCacheDir, { recursive: true })
    writeFileSync(sentinelPath, JSON.stringify({ keep: true }))

    const fetchImpl = async () =>
      new Response(JSON.stringify({
        openai: {
          models: {
            "gpt-5.4": {
              id: "gpt-5.4",
              family: "gpt",
              reasoning: true,
              limit: { output: 128_000 },
            },
          },
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })

    //#when
    const snapshot = await store.refreshModelCapabilitiesCache({ fetchImpl })
    const reloadedStore = createModelCapabilitiesCacheStore(() => testCacheDir)

    //#then
    expect(snapshot.models["gpt-5.4"]?.limit?.output).toBe(128_000)
    expect(existsSync(sentinelPath)).toBe(true)
    expect(readFileSync(sentinelPath, "utf-8")).toBe(JSON.stringify({ keep: true }))
    expect(reloadedStore.readModelCapabilitiesCache()).toEqual(snapshot)
  })
})

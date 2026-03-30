/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  buildModelCapabilitiesSnapshotFromModelsDev,
  createModelCapabilitiesCacheStore,
  MODELS_DEV_SOURCE_URL,
} from "./model-capabilities-cache"

const originalFetch = globalThis.fetch

let fakeUserCacheRoot = ""
let testCacheDir = ""

function createFetchMock(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return Object.assign(implementation, {
    preconnect: Reflect.get(originalFetch, "preconnect"),
  })
}

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

  test("builds a normalized snapshot from provider-keyed models.dev data", () => {
    //#given
    const raw = {
      openai: {
        models: {
          "gpt-5.4": {
            id: "gpt-5.4",
            family: "gpt",
            reasoning: true,
            temperature: false,
            tool_call: true,
            modalities: {
              input: ["text", "image"],
              output: ["text"],
            },
            limit: {
              context: 1_050_000,
              output: 128_000,
            },
          },
        },
      },
      anthropic: {
        models: {
          "claude-sonnet-4-6": {
            family: "claude-sonnet",
            reasoning: true,
            temperature: true,
            limit: {
              context: 1_000_000,
              output: 64_000,
            },
          },
        },
      },
    }

    //#when
    const snapshot = buildModelCapabilitiesSnapshotFromModelsDev(raw)

    //#then
    expect(snapshot.sourceUrl).toBe(MODELS_DEV_SOURCE_URL)
    expect(snapshot.models["gpt-5.4"]).toEqual({
      id: "gpt-5.4",
      family: "gpt",
      reasoning: true,
      temperature: false,
      toolCall: true,
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
      limit: {
        context: 1_050_000,
        output: 128_000,
      },
    })
    expect(snapshot.models["claude-sonnet-4-6"]).toEqual({
      id: "claude-sonnet-4-6",
      family: "claude-sonnet",
      reasoning: true,
      temperature: true,
      limit: {
        context: 1_000_000,
        output: 64_000,
      },
    })
  })

  test("merges repeated snapshot entries without materializing empty optional objects", () => {
    //#given
    const raw = {
      openai: {
        models: {
          "gpt-5.4": {
            id: "gpt-5.4",
            family: "gpt",
          },
        },
      },
      alias: {
        models: {
          "gpt-5.4-preview": {
            id: "gpt-5.4",
            reasoning: true,
          },
        },
      },
    }

    //#when
    const snapshot = buildModelCapabilitiesSnapshotFromModelsDev(raw)

    //#then
    expect(snapshot.models["gpt-5.4"]).toEqual({
      id: "gpt-5.4",
      family: "gpt",
      reasoning: true,
    })
    expect(snapshot.models["gpt-5.4"]).not.toHaveProperty("modalities")
    expect(snapshot.models["gpt-5.4"]).not.toHaveProperty("limit")
  })

  test("preserves true boolean capabilities when a later provider reports false", () => {
    //#given
    const raw = {
      openai: {
        models: {
          "gpt-4.1-mini": {
            id: "openai/gpt-4.1-mini",
            family: "gpt",
            reasoning: true,
            temperature: true,
            tool_call: true,
          },
        },
      },
      "nano-gpt": {
        models: {
          "openai/gpt-4.1-mini": {
            id: "openai/gpt-4.1-mini",
            reasoning: false,
            temperature: false,
            tool_call: false,
          },
        },
      },
    }

    //#when
    const snapshot = buildModelCapabilitiesSnapshotFromModelsDev(raw)

    //#then
    expect(snapshot.models["openai/gpt-4.1-mini"]).toEqual({
      id: "openai/gpt-4.1-mini",
      family: "gpt",
      reasoning: true,
      temperature: true,
      toolCall: true,
    })
  })

  test("refresh writes cache and preserves unrelated files in the cache directory", async () => {
    //#given
    const sentinelPath = join(testCacheDir, "keep-me.json")
    const store = createModelCapabilitiesCacheStore(() => testCacheDir)
    mkdirSync(testCacheDir, { recursive: true })
    writeFileSync(sentinelPath, JSON.stringify({ keep: true }))

    const fetchImpl = createFetchMock(async () =>
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
      }))

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

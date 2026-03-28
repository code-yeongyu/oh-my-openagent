/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"

import { getPluginNameWithVersion } from "../config-manager"

describe("getPluginNameWithVersion", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns the canonical latest tag when current version matches latest", async () => {
    //#given
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "3.13.1", beta: "3.14.0-beta.1" }),
      } as Response)
    ) as unknown as typeof fetch

    //#when
    const result = await getPluginNameWithVersion("3.13.1")

    //#then
    expect(result).toBe("oh-my-openagent@latest")
  })

  test("preserves the canonical prerelease channel when fetch fails", async () => {
    //#given
    globalThis.fetch = mock(() => Promise.reject(new Error("Network error"))) as unknown as typeof fetch

    //#when
    const result = await getPluginNameWithVersion("3.14.0-beta.1")

    //#then
    expect(result).toBe("oh-my-openagent@beta")
  })

  test("returns the canonical bare package name for stable fallback", async () => {
    //#given
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
      } as Response)
    ) as unknown as typeof fetch

    //#when
    const result = await getPluginNameWithVersion("3.13.1")

    //#then
    expect(result).toBe("oh-my-openagent")
  })
})

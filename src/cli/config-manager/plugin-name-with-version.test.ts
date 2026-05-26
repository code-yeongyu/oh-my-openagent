/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"

import { getPluginNameWithVersion, resolvePluginInstallReference } from "../config-manager"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"

describe("getPluginNameWithVersion", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns the exact versioned entry when current version matches latest", async () => {
    //#given
    globalThis.fetch = unsafeTestValue<typeof fetch>(mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "3.13.1", beta: "3.14.0-beta.1" }),
      } as Response)
    ))

    //#when
    const result = await getPluginNameWithVersion("3.13.1")

    //#then
    expect(result).toBe("oh-my-openagent@3.13.1")
  })

  test("returns the exact prerelease version when fetch fails", async () => {
    //#given
    globalThis.fetch = unsafeTestValue<typeof fetch>(mock(() => Promise.reject(new Error("Network error"))))

    //#when
    const result = await getPluginNameWithVersion("3.14.0-beta.1")

    //#then
    expect(result).toBe("oh-my-openagent@3.14.0-beta.1")
  })

  test("returns the exact stable version for fallback", async () => {
    //#given
    globalThis.fetch = unsafeTestValue<typeof fetch>(mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
      } as Response)
    ))

    //#when
    const result = await getPluginNameWithVersion("3.13.1")

    //#then
    expect(result).toBe("oh-my-openagent@3.13.1")
  })
})

describe("resolvePluginInstallReference", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns the matching release channel when dist-tags resolve", async () => {
    //#given
    globalThis.fetch = unsafeTestValue<typeof fetch>(mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "3.13.1", beta: "3.14.0-beta.1" }),
      } as Response)
    ))

    //#when
    const result = await resolvePluginInstallReference("3.14.0-beta.1")

    //#then
    expect(result).toEqual({
      entry: "oh-my-openagent@3.14.0-beta.1",
      channel: "beta",
    })
  })

  test("falls back to latest for stable releases without dist-tag metadata", async () => {
    //#given
    globalThis.fetch = unsafeTestValue<typeof fetch>(mock(() => Promise.reject(new Error("Network error"))))

    //#when
    const result = await resolvePluginInstallReference("3.13.1")

    //#then
    expect(result).toEqual({
      entry: "oh-my-openagent@3.13.1",
      channel: "latest",
    })
  })
})

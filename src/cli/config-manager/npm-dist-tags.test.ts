/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"

import { fetchNpmDistTags } from "../config-manager"

describe("fetchNpmDistTags", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns dist-tags on success", async () => {
    //#given
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "3.13.1", beta: "3.14.0-beta.1" }),
      } as Response)
    ) as unknown as typeof fetch

    //#when
    const result = await fetchNpmDistTags("oh-my-openagent")

    //#then
    expect(result).toEqual({ latest: "3.13.1", beta: "3.14.0-beta.1" })
  })

  test("returns null on network failure", async () => {
    //#given
    globalThis.fetch = mock(() => Promise.reject(new Error("Network error"))) as unknown as typeof fetch

    //#when
    const result = await fetchNpmDistTags("oh-my-openagent")

    //#then
    expect(result).toBeNull()
  })

  test("returns null on non-ok response", async () => {
    //#given
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
      } as Response)
    ) as unknown as typeof fetch

    //#when
    const result = await fetchNpmDistTags("oh-my-openagent")

    //#then
    expect(result).toBeNull()
  })
})

/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"

import { fetchNpmDistTags } from "../config-manager"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"

describe("fetchNpmDistTags", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns dist-tags on success", async () => {
    //#given
    globalThis.fetch = unsafeTestValue<typeof fetch>(mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "3.13.1", beta: "3.14.0-beta.1" }),
      } as Response)
    ))

    //#when
    const result = await fetchNpmDistTags("oh-my-openagent")

    //#then
    expect(result).toEqual({ latest: "3.13.1", beta: "3.14.0-beta.1" })
  })

  test("returns null on network failure", async () => {
    //#given
    globalThis.fetch = unsafeTestValue<typeof fetch>(mock(() => Promise.reject(new Error("Network error"))))

    //#when
    const result = await fetchNpmDistTags("oh-my-openagent")

    //#then
    expect(result).toBeNull()
  })

  test("returns null on non-ok response", async () => {
    //#given
    globalThis.fetch = unsafeTestValue<typeof fetch>(mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
      } as Response)
    ))

    //#when
    const result = await fetchNpmDistTags("oh-my-openagent")

    //#then
    expect(result).toBeNull()
  })
})

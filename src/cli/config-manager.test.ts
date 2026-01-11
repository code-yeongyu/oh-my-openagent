import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"

import { ANTIGRAVITY_PROVIDER_CONFIG, getPluginNameWithVersion, fetchNpmDistTags } from "./config-manager"

describe("getPluginNameWithVersion", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns @latest when current version matches latest tag", async () => {
    // #given npm dist-tags with latest=2.14.0
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3" }),
      } as Response)
    ) as unknown as typeof fetch

    // #when current version is 2.14.0
    const result = await getPluginNameWithVersion("2.14.0")

    // #then should use @latest tag
    expect(result).toBe("oh-my-opencode@latest")
  })

  test("returns @beta when current version matches beta tag", async () => {
    // #given npm dist-tags with beta=3.0.0-beta.3
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3" }),
      } as Response)
    ) as unknown as typeof fetch

    // #when current version is 3.0.0-beta.3
    const result = await getPluginNameWithVersion("3.0.0-beta.3")

    // #then should use @beta tag
    expect(result).toBe("oh-my-opencode@beta")
  })

  test("returns @next when current version matches next tag", async () => {
    // #given npm dist-tags with next=3.1.0-next.1
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3", next: "3.1.0-next.1" }),
      } as Response)
    ) as unknown as typeof fetch

    // #when current version is 3.1.0-next.1
    const result = await getPluginNameWithVersion("3.1.0-next.1")

    // #then should use @next tag
    expect(result).toBe("oh-my-opencode@next")
  })

  test("returns pinned version when no tag matches", async () => {
    // #given npm dist-tags with beta=3.0.0-beta.3
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3" }),
      } as Response)
    ) as unknown as typeof fetch

    // #when current version is old beta 3.0.0-beta.2
    const result = await getPluginNameWithVersion("3.0.0-beta.2")

    // #then should pin to specific version
    expect(result).toBe("oh-my-opencode@3.0.0-beta.2")
  })

  test("returns pinned version when fetch fails", async () => {
    // #given network failure
    globalThis.fetch = mock(() => Promise.reject(new Error("Network error"))) as unknown as typeof fetch

    // #when current version is 3.0.0-beta.3
    const result = await getPluginNameWithVersion("3.0.0-beta.3")

    // #then should fall back to pinned version
    expect(result).toBe("oh-my-opencode@3.0.0-beta.3")
  })

  test("returns pinned version when npm returns non-ok response", async () => {
    // #given npm returns 404
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
      } as Response)
    ) as unknown as typeof fetch

    // #when current version is 2.14.0
    const result = await getPluginNameWithVersion("2.14.0")

    // #then should fall back to pinned version
    expect(result).toBe("oh-my-opencode@2.14.0")
  })
})

describe("fetchNpmDistTags", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns dist-tags on success", async () => {
    // #given npm returns dist-tags
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3" }),
      } as Response)
    ) as unknown as typeof fetch

    // #when fetching dist-tags
    const result = await fetchNpmDistTags("oh-my-opencode")

    // #then should return the tags
    expect(result).toEqual({ latest: "2.14.0", beta: "3.0.0-beta.3" })
  })

  test("returns null on network failure", async () => {
    // #given network failure
    globalThis.fetch = mock(() => Promise.reject(new Error("Network error"))) as unknown as typeof fetch

    // #when fetching dist-tags
    const result = await fetchNpmDistTags("oh-my-opencode")

    // #then should return null
    expect(result).toBeNull()
  })

  test("returns null on non-ok response", async () => {
    // #given npm returns 404
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
      } as Response)
    ) as unknown as typeof fetch

    // #when fetching dist-tags
    const result = await fetchNpmDistTags("oh-my-opencode")

    // #then should return null
    expect(result).toBeNull()
  })
})

describe("config-manager ANTIGRAVITY_PROVIDER_CONFIG", () => {
  test("Gemini models include full spec (limit + modalities)", () => {
    const google = (ANTIGRAVITY_PROVIDER_CONFIG as any).google
    expect(google).toBeTruthy()

    const models = google.models as Record<string, any>
    expect(models).toBeTruthy()

    const required = [
      "antigravity-gemini-3-pro-high",
      "antigravity-gemini-3-pro-low",
      "antigravity-gemini-3-flash",
    ]

    for (const key of required) {
      const model = models[key]
      expect(model).toBeTruthy()
      expect(typeof model.name).toBe("string")
      expect(model.name.includes("(Antigravity)")).toBe(true)

      expect(model.limit).toBeTruthy()
      expect(typeof model.limit.context).toBe("number")
      expect(typeof model.limit.output).toBe("number")

      expect(model.modalities).toBeTruthy()
      expect(Array.isArray(model.modalities.input)).toBe(true)
      expect(Array.isArray(model.modalities.output)).toBe(true)
    }
  })
})

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { NPM_REGISTRY_URL } from "./constants"
import { getLatestVersion } from "./checker"

describe("auto-update-checker/checker", () => {
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    mock.restore()
  })

  function mockDistTags(distTags: Record<string, string>) {
    fetchSpy.mockImplementation(async () =>
      new Response(JSON.stringify(distTags), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
  }

  describe("getLatestVersion", () => {
    test("accepts channel parameter", async () => {
      // given
      mockDistTags({ latest: "1.0.0", beta: "2.0.0-beta.1" })

      // when
      const result = await getLatestVersion("beta")

      // then
      expect(result).toBe("2.0.0-beta.1")
    })

    test("accepts latest channel", async () => {
      // given
      mockDistTags({ latest: "1.0.0", beta: "2.0.0-beta.1" })

      // when
      const result = await getLatestVersion("latest")

      // then
      expect(result).toBe("1.0.0")
    })

    test("works without channel (defaults to latest)", async () => {
      // given
      mockDistTags({ latest: "1.0.0", beta: "2.0.0-beta.1" })

      // when
      const result = await getLatestVersion()

      // then
      expect(result).toBe("1.0.0")
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
      expect((globalThis.fetch as ReturnType<typeof mock>).mock.calls[0]?.[0]).toBe(NPM_REGISTRY_URL)
    })

    test("falls back to latest when the channel is missing", async () => {
      // given
      mockDistTags({ latest: "1.0.0" })

      // when
      const result = await getLatestVersion("nonexistent-channel")

      // then
      expect(result).toBe("1.0.0")
    })

    test("returns null when the registry responds with an error status", async () => {
      // given
      fetchSpy.mockImplementation(async () => new Response("upstream error", { status: 502 }))

      // when
      const result = await getLatestVersion()

      // then
      expect(result).toBeNull()
    })
  })
})

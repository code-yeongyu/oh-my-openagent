import { describe, expect, test } from "bun:test"
import { createOpencodeV2Check } from "./opencode-v2"

describe("opencode-v2 doctor check", () => {
  describe("#given opencode2 is not installed", () => {
    test("skips with a v1-only message", async () => {
      // given
      const check = createOpencodeV2Check({
        getV1Version: () => "1.18.19",
        getV2VersionOutput: () => null,
      })
      // when
      const result = await check()
      // then
      expect(result.status).toBe("skip")
      expect(result.message).toContain("opencode2")
      expect(result.issues).toEqual([])
    })
  })

  describe("#given opencode2 beta is installed", () => {
    test("warns with the detected version and degradation details", async () => {
      // given
      const check = createOpencodeV2Check({
        getV1Version: () => null,
        getV2VersionOutput: () => "opencode2 v0.0.0-beta-17759",
      })
      // when
      const result = await check()
      // then
      expect(result.status).toBe("warn")
      expect(result.message).toContain("0.0.0-beta-17759")
      expect(result.details?.length).toBeGreaterThan(0)
      expect(result.details?.some((line) => line.includes("[degraded]") || line.includes("[unavailable]"))).toBe(true)
      expect(result.issues).toEqual([])
    })

    test("keeps the check non-critical so v2 presence never fails doctor", async () => {
      // given
      const check = createOpencodeV2Check({
        getV1Version: () => null,
        getV2VersionOutput: () => "garbage output",
      })
      // when
      const result = await check()
      // then
      expect(["pass", "warn", "skip"]).toContain(result.status)
    })
  })

  describe("#given both hosts are installed", () => {
    test("reports the coexistence without failing", async () => {
      // given
      const check = createOpencodeV2Check({
        getV1Version: () => "1.18.19",
        getV2VersionOutput: () => "opencode2 v0.0.0-beta-17759",
      })
      // when
      const result = await check()
      // then
      expect(result.status).toBe("warn")
      expect(result.message).toContain("1.18.19")
      expect(result.message).toContain("0.0.0-beta-17759")
    })
  })
})

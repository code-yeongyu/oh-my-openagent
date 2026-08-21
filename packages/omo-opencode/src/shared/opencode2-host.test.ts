import { describe, expect, test } from "bun:test"
import { detectOmoHosts, isBetaVersion, parseV2VersionOutput } from "./opencode2-host"

describe("opencode2-host", () => {
  describe("#parseV2VersionOutput", () => {
    test("parses the opencode2 version banner", () => {
      // given
      const output = "opencode2 v0.0.0-beta-17759"
      // then
      expect(parseV2VersionOutput(output)).toBe("0.0.0-beta-17759")
    })

    test("parses a bare beta version string", () => {
      expect(parseV2VersionOutput("0.0.0-beta-17778")).toBe("0.0.0-beta-17778")
    })

    test("parses dev-channel builds", () => {
      expect(parseV2VersionOutput("opencode2 v0.0.0-dev-17774")).toBe("0.0.0-dev-17774")
    })

    test("rejects stable v1 semver without prerelease", () => {
      expect(parseV2VersionOutput("1.18.19")).toBeNull()
    })

    test("rejects empty and garbage output", () => {
      expect(parseV2VersionOutput("")).toBeNull()
      expect(parseV2VersionOutput("command not found")).toBeNull()
    })
  })

  describe("#isBetaVersion", () => {
    test("accepts beta builds", () => {
      expect(isBetaVersion("0.0.0-beta-17759")).toBe(true)
    })

    test("accepts dev builds", () => {
      expect(isBetaVersion("0.0.0-dev-17774")).toBe(true)
    })

    test("rejects stable semver", () => {
      expect(isBetaVersion("1.18.19")).toBe(false)
    })
  })

  describe("#detectOmoHosts", () => {
    test("detects v1 only", () => {
      // given
      const detection = detectOmoHosts({
        getV1Version: () => "1.18.19",
        getV2VersionOutput: () => null,
      })
      // then
      expect(detection.hasV1).toBe(true)
      expect(detection.hasV2).toBe(false)
      expect(detection.primary?.kind).toBe("opencode-v1")
      expect(detection.primary?.version).toBe("1.18.19")
    })

    test("detects v2 only", () => {
      const detection = detectOmoHosts({
        getV1Version: () => null,
        getV2VersionOutput: () => "opencode2 v0.0.0-beta-17759",
      })
      expect(detection.hasV1).toBe(false)
      expect(detection.hasV2).toBe(true)
      expect(detection.primary?.kind).toBe("opencode-v2")
    })

    test("detects both hosts with v1 as primary target", () => {
      const detection = detectOmoHosts({
        getV1Version: () => "1.18.19",
        getV2VersionOutput: () => "opencode2 v0.0.0-beta-17759",
      })
      expect(detection.hosts).toHaveLength(2)
      expect(detection.primary?.kind).toBe("opencode-v1")
      expect(detection.hasV2).toBe(true)
    })

    test("returns empty detection when no host exists", () => {
      const detection = detectOmoHosts({
        getV1Version: () => null,
        getV2VersionOutput: () => null,
      })
      expect(detection.hosts).toHaveLength(0)
      expect(detection.primary).toBeNull()
      expect(detection.hasV1).toBe(false)
      expect(detection.hasV2).toBe(false)
    })

    test("ignores a beta-looking string reported by the v1 probe", () => {
      const detection = detectOmoHosts({
        getV1Version: () => "0.0.0-beta-1",
        getV2VersionOutput: () => null,
      })
      expect(detection.hasV1).toBe(false)
      expect(detection.hosts).toHaveLength(0)
    })

    test("ignores garbage v2 output", () => {
      const detection = detectOmoHosts({
        getV1Version: () => "1.18.19",
        getV2VersionOutput: () => "command not found",
      })
      expect(detection.hasV2).toBe(false)
      expect(detection.hasV1).toBe(true)
    })
  })
})

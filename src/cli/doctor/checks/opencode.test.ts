import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test"
import * as opencode from "./opencode"
import { MIN_OPENCODE_VERSION } from "../constants"

describe("opencode check", () => {
  describe("compareVersions", () => {
    it("returns true when current >= minimum", () => {
      // #given versions where current is greater
      // #when comparing
      // #then should return true
      expect(opencode.compareVersions("1.0.200", "1.0.150")).toBe(true)
      expect(opencode.compareVersions("1.1.0", "1.0.150")).toBe(true)
      expect(opencode.compareVersions("2.0.0", "1.0.150")).toBe(true)
    })

    it("returns true when versions are equal", () => {
      // #given equal versions
      // #when comparing
      // #then should return true
      expect(opencode.compareVersions("1.0.150", "1.0.150")).toBe(true)
    })

    it("returns false when current < minimum", () => {
      // #given version below minimum
      // #when comparing
      // #then should return false
      expect(opencode.compareVersions("1.0.100", "1.0.150")).toBe(false)
      expect(opencode.compareVersions("0.9.0", "1.0.150")).toBe(false)
    })

    it("handles version prefixes", () => {
      // #given version with v prefix
      // #when comparing
      // #then should strip prefix and compare correctly
      expect(opencode.compareVersions("v1.0.200", "1.0.150")).toBe(true)
    })

    it("handles prerelease versions", () => {
      // #given prerelease version
      // #when comparing
      // #then should use base version
      expect(opencode.compareVersions("1.0.200-beta.1", "1.0.150")).toBe(true)
    })
  })

  describe("getOpenCodeInfo", () => {
    it("returns installed: false when binary not found", async () => {
      // #given no opencode binary
      const spy = spyOn(opencode, "findOpenCodeBinary").mockResolvedValue(null)

      // #when getting info
      const info = await opencode.getOpenCodeInfo()

      // #then should indicate not installed
      expect(info.installed).toBe(false)
      expect(info.version).toBeNull()
      expect(info.path).toBeNull()
      expect(info.binary).toBeNull()

      spy.mockRestore()
    })
  })

  describe("checkOpenCodeInstallation", () => {
    let getInfoSpy: ReturnType<typeof spyOn>

    afterEach(() => {
      getInfoSpy?.mockRestore()
    })

    it("returns fail when not installed", async () => {
      // #given opencode not installed
      getInfoSpy = spyOn(opencode, "getOpenCodeInfo").mockResolvedValue({
        installed: false,
        version: null,
        path: null,
        binary: null,
      })

      // #when checking installation
      const result = await opencode.checkOpenCodeInstallation()

      // #then should fail with installation hint
      expect(result.status).toBe("fail")
      expect(result.message).toContain("not installed")
      expect(result.details).toBeDefined()
      expect(result.details?.some((d) => d.includes("opencode.ai"))).toBe(true)
    })

    it("returns warn when version below minimum", async () => {
      // #given old version installed
      getInfoSpy = spyOn(opencode, "getOpenCodeInfo").mockResolvedValue({
        installed: true,
        version: "1.0.100",
        path: "/usr/local/bin/opencode",
        binary: "opencode",
      })

      // #when checking installation
      const result = await opencode.checkOpenCodeInstallation()

      // #then should warn about old version
      expect(result.status).toBe("warn")
      expect(result.message).toContain("below minimum")
      expect(result.details?.some((d) => d.includes(MIN_OPENCODE_VERSION))).toBe(true)
    })

    it("returns pass when properly installed", async () => {
      // #given current version installed
      getInfoSpy = spyOn(opencode, "getOpenCodeInfo").mockResolvedValue({
        installed: true,
        version: "1.0.200",
        path: "/usr/local/bin/opencode",
        binary: "opencode",
      })

      // #when checking installation
      const result = await opencode.checkOpenCodeInstallation()

      // #then should pass
      expect(result.status).toBe("pass")
      expect(result.message).toContain("1.0.200")
    })
  })

  describe("getOpenCodeCheckDefinition", () => {
    it("returns valid check definition", () => {
      // #given
      // #when getting definition
      const def = opencode.getOpenCodeCheckDefinition()

      // #then should have required properties
      expect(def.id).toBe("opencode-installation")
      expect(def.category).toBe("installation")
      expect(def.critical).toBe(true)
      expect(typeof def.check).toBe("function")
    })
  })
})

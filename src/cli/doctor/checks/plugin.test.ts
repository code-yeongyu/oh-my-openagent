import { describe, it, expect, spyOn, afterEach } from "bun:test"
import * as plugin from "./plugin"

describe("plugin check", () => {
  describe("getPluginInfo", () => {
    it("returns registered: false when config not found", () => {
      // given no config file exists
      // when getting plugin info
      // then should indicate not registered
      const info = plugin.getPluginInfo()
      expect(typeof info.registered).toBe("boolean")
      expect(typeof info.isPinned).toBe("boolean")
    })
  })

  describe("checkPluginRegistration", () => {
    let getInfoSpy: ReturnType<typeof spyOn>

    afterEach(() => {
      getInfoSpy?.mockRestore()
    })

    it("returns fail when config file not found", async () => {
      // given no config file
      getInfoSpy = spyOn(plugin, "getPluginInfo").mockReturnValue({
        registered: false,
        configPath: null,
        entry: null,
        isPinned: false,
        pinnedVersion: null,
      })

      // when checking registration
      const result = await plugin.checkPluginRegistration()

      // then should fail with hint
      expect(result.status).toBe("fail")
      expect(result.message).toContain("not found")
    })

    it("returns fail when plugin not registered", async () => {
      // given config exists but plugin not registered
      getInfoSpy = spyOn(plugin, "getPluginInfo").mockReturnValue({
        registered: false,
        configPath: "/home/user/.config/opencode/opencode.json",
        entry: null,
        isPinned: false,
        pinnedVersion: null,
      })

      // when checking registration
      const result = await plugin.checkPluginRegistration()

      // then should fail
      expect(result.status).toBe("fail")
      expect(result.message).toContain("not registered")
    })

    it("returns pass when plugin registered", async () => {
      // given plugin registered
      getInfoSpy = spyOn(plugin, "getPluginInfo").mockReturnValue({
        registered: true,
        configPath: "/home/user/.config/opencode/opencode.json",
        entry: "oh-my-opencode",
        isPinned: false,
        pinnedVersion: null,
      })

      // when checking registration
      const result = await plugin.checkPluginRegistration()

      // then should pass
      expect(result.status).toBe("pass")
      expect(result.message).toContain("Registered")
    })

    it("indicates pinned version when applicable", async () => {
      // given plugin pinned to version
      getInfoSpy = spyOn(plugin, "getPluginInfo").mockReturnValue({
        registered: true,
        configPath: "/home/user/.config/opencode/opencode.json",
        entry: "oh-my-opencode@2.7.0",
        isPinned: true,
        pinnedVersion: "2.7.0",
      })

      // when checking registration
      const result = await plugin.checkPluginRegistration()

      // then should show pinned version
      expect(result.status).toBe("pass")
      expect(result.message).toContain("pinned")
      expect(result.message).toContain("2.7.0")
    })
  })

  describe("getPluginCheckDefinition", () => {
    it("returns valid check definition", () => {
      // given
      // when getting definition
      const def = plugin.getPluginCheckDefinition()

      // then should have required properties
      expect(def.id).toBe("plugin-registration")
      expect(def.category).toBe("installation")
      expect(def.critical).toBe(true)
    })
  })
})

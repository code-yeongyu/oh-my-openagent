/// <reference types="bun:test" />

import { describe, test, expect, spyOn, mock } from "bun:test"
import {
  isModuleInstalled,
  isAntigravityModel,
  isAntigravityPluginInstalled,
  warnAntigravityPluginMissing,
  validateAntigravityPlugin,
} from "./plugin-availability"

describe("Plugin Availability Checker", () => {
  describe("isAntigravityModel", () => {
    test("detects antigravity in model ID", () => {
      expect(isAntigravityModel("google/antigravity-gemini-3-1-pro")).toBe(true)
      expect(isAntigravityModel("antigravity-gemini-3-flash")).toBe(true)
      expect(isAntigravityModel("google/antigravity-claude-opus-4-5-thinking")).toBe(true)
    })

    test("returns false for non-antigravity models", () => {
      expect(isAntigravityModel("google/gemini-3-1-pro")).toBe(false)
      expect(isAntigravityModel("claude-opus-4-6")).toBe(false)
      expect(isAntigravityModel("gpt-5-4")).toBe(false)
    })

    test("is case-insensitive", () => {
      expect(isAntigravityModel("ANTIGRAVITY-gemini-3-1-pro")).toBe(true)
      expect(isAntigravityModel("AntiGravity-gemini-3-flash")).toBe(true)
    })
  })

  describe("warnAntigravityPluginMissing", () => {
    test("logs warning for antigravity model without plugin", () => {
      const consoleWarnSpy = spyOn(console, "warn")

      warnAntigravityPluginMissing("google/antigravity-gemini-3-1-pro")

      expect(consoleWarnSpy).toHaveBeenCalled()
      const warnMessage = consoleWarnSpy.mock.calls[0]?.[0]
      expect(warnMessage).toContain("opencode-antigravity-auth")
      expect(warnMessage).toContain("google/antigravity-gemini-3-1-pro")

      consoleWarnSpy.mockRestore()
    })

    test("includes context in warning message", () => {
      const consoleWarnSpy = spyOn(console, "warn")

      warnAntigravityPluginMissing("google/antigravity-gemini-3-1-pro", "agent: Librarian")

      expect(consoleWarnSpy).toHaveBeenCalled()
      const warnMessage = consoleWarnSpy.mock.calls[0]?.[0]
      expect(warnMessage).toContain("agent: Librarian")

      consoleWarnSpy.mockRestore()
    })

    test("does not warn for non-antigravity models", () => {
      const consoleWarnSpy = spyOn(console, "warn")

      warnAntigravityPluginMissing("google/gemini-3-1-pro")

      expect(consoleWarnSpy).not.toHaveBeenCalled()

      consoleWarnSpy.mockRestore()
    })

    test("warning includes installation instructions", () => {
      const consoleWarnSpy = spyOn(console, "warn")

      warnAntigravityPluginMissing("antigravity-gemini-3-flash")

      expect(consoleWarnSpy).toHaveBeenCalled()
      const warnMessage = consoleWarnSpy.mock.calls[0]?.[0]
      expect(warnMessage).toContain("npm install opencode-antigravity-auth")

      consoleWarnSpy.mockRestore()
    })

    test("warning includes documentation links", () => {
      const consoleWarnSpy = spyOn(console, "warn")

      warnAntigravityPluginMissing("antigravity-gemini-3-flash")

      expect(consoleWarnSpy).toHaveBeenCalled()
      const warnMessage = consoleWarnSpy.mock.calls[0]?.[0]
      expect(warnMessage).toContain("github.com/NoeFabris/opencode-antigravity-auth")
      expect(warnMessage).toContain("configuration.md")

      consoleWarnSpy.mockRestore()
    })
  })

  describe("validateAntigravityPlugin", () => {
    test("throws error for antigravity model without plugin", () => {
      expect(() => {
        validateAntigravityPlugin("google/antigravity-gemini-3-1-pro")
      }).toThrow()

      expect(() => {
        validateAntigravityPlugin("google/antigravity-gemini-3-1-pro")
      }).toThrow(/opencode-antigravity-auth/)
    })

    test("includes model ID in error message", () => {
      expect(() => {
        validateAntigravityPlugin("google/antigravity-gemini-3-1-pro")
      }).toThrow(/google\/antigravity-gemini-3-1-pro/)
    })

    test("includes context in error message", () => {
      expect(() => {
        validateAntigravityPlugin("antigravity-gemini-3-flash", "agent: Librarian")
      }).toThrow(/agent: Librarian/)
    })

    test("does not throw for non-antigravity models", () => {
      expect(() => {
        validateAntigravityPlugin("google/gemini-3-1-pro")
      }).not.toThrow()

      expect(() => {
        validateAntigravityPlugin("claude-opus-4-6")
      }).not.toThrow()
    })

    test("error message includes installation instructions", () => {
      expect(() => {
        validateAntigravityPlugin("antigravity-gemini-3-flash")
      }).toThrow(/npm install opencode-antigravity-auth/)
    })
  })

  describe("isModuleInstalled", () => {
    test("returns true for installed modules", () => {
      // 'bun:test' is available in this environment
      expect(isModuleInstalled("bun:test")).toBe(true)
    })

    test("returns false for non-existent modules", () => {
      expect(isModuleInstalled("nonexistent-module-xyz-12345")).toBe(false)
    })
  })

  describe("isAntigravityPluginInstalled", () => {
    test("returns false if plugin not installed", () => {
      // In test environment, the plugin is unlikely to be installed
      const result = isAntigravityPluginInstalled()
      // We don't assert the specific value since it depends on environment,
      // but the function should not throw
      expect(typeof result).toBe("boolean")
    })
  })

  describe("Integration: Model Check + Warning", () => {
    test("workflow: check model → warn if needed", () => {
      const modelID = "google/antigravity-gemini-3-1-pro"
      const consoleWarnSpy = spyOn(console, "warn")

      if (isAntigravityModel(modelID)) {
        warnAntigravityPluginMissing(modelID, "model resolution")
      }

      expect(consoleWarnSpy).toHaveBeenCalled()

      consoleWarnSpy.mockRestore()
    })

    test("workflow: check model → validate if critical", () => {
      const modelID = "google/antigravity-gemini-3-1-pro"

      expect(() => {
        if (isAntigravityModel(modelID)) {
          validateAntigravityPlugin(modelID, "critical operation")
        }
      }).toThrow()
    })

    test("workflow: skip warning for non-antigravity models", () => {
      const modelID = "google/gemini-3-1-pro"
      const consoleWarnSpy = spyOn(console, "warn")

      if (isAntigravityModel(modelID)) {
        warnAntigravityPluginMissing(modelID)
      }

      expect(consoleWarnSpy).not.toHaveBeenCalled()

      consoleWarnSpy.mockRestore()
    })
  })
})

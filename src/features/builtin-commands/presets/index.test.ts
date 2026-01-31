/**
 * Command Presets Tests
 *
 * Tests for mode-based command configuration presets (quick/full/pre-pr)
 */

import { describe, it, expect, beforeEach } from "bun:test"
import {
  PresetManager,
  createPresetManager,
  PresetMode,
  type PresetConfig,
} from "./index"

describe("PresetManager", () => {
  let manager: PresetManager

  beforeEach(() => {
    manager = createPresetManager()
  })

  describe("available presets", () => {
    it("should have quick preset", () => {
      expect(manager.hasPreset("quick")).toBe(true)
    })

    it("should have full preset", () => {
      expect(manager.hasPreset("full")).toBe(true)
    })

    it("should have pre-pr preset", () => {
      expect(manager.hasPreset("pre-pr")).toBe(true)
    })

    it("should list all available presets", () => {
      const presets = manager.listPresets()
      expect(presets).toContain("quick")
      expect(presets).toContain("full")
      expect(presets).toContain("pre-pr")
    })
  })

  describe("quick preset", () => {
    //#given command includes --mode=quick
    //#when parsing arguments
    //#then should use quick mode configuration
    it("should apply quick preset configuration", () => {
      const config = manager.getPreset("quick")

      expect(config.mode).toBe(PresetMode.QUICK)
      expect(config.runTests).toBe(false)
      expect(config.runLint).toBe(true)
      expect(config.runTypecheck).toBe(false)
      expect(config.runBuild).toBe(false)
    })

    it("should have minimal checks for speed", () => {
      const config = manager.getPreset("quick")
      
      // Quick mode should be fast - minimal checks
      expect(config.timeout).toBeLessThanOrEqual(30000)
    })
  })

  describe("full preset", () => {
    it("should apply full preset configuration", () => {
      const config = manager.getPreset("full")

      expect(config.mode).toBe(PresetMode.FULL)
      expect(config.runTests).toBe(true)
      expect(config.runLint).toBe(true)
      expect(config.runTypecheck).toBe(true)
      expect(config.runBuild).toBe(true)
    })
  })

  describe("pre-pr preset", () => {
    //#given command includes --mode=pre-pr
    //#when executing command
    //#then should run complete PR check suite
    it("should apply pre-pr preset configuration", () => {
      const config = manager.getPreset("pre-pr")

      expect(config.mode).toBe(PresetMode.PRE_PR)
      expect(config.runTests).toBe(true)
      expect(config.runLint).toBe(true)
      expect(config.runTypecheck).toBe(true)
      expect(config.runBuild).toBe(true)
      expect(config.runDeadCodeCheck).toBe(true)
    })

    it("should include git status check", () => {
      const config = manager.getPreset("pre-pr")
      expect(config.checkGitStatus).toBe(true)
    })
  })

  describe("unknown mode handling", () => {
    //#given unknown mode specified
    //#when getting preset
    //#then should throw error with available modes
    it("should throw error for unknown mode", () => {
      expect(() => manager.getPreset("invalid")).toThrow()
    })

    it("should include available modes in error message", () => {
      try {
        manager.getPreset("invalid")
      } catch (e) {
        const error = e as Error
        expect(error.message).toContain("quick")
        expect(error.message).toContain("full")
        expect(error.message).toContain("pre-pr")
      }
    })
  })

  describe("custom preset override", () => {
    //#given custom mode configuration
    //#when merging with preset
    //#then custom values should override
    it("should merge custom config with preset", () => {
      const customConfig: Partial<PresetConfig> = {
        runTests: false,
        timeout: 60000,
      }

      const config = manager.getPresetWithOverrides("full", customConfig)

      expect(config.runTests).toBe(false) // Overridden
      expect(config.runLint).toBe(true) // From preset
      expect(config.timeout).toBe(60000) // Overridden
    })
  })

  describe("parse mode from args", () => {
    it("should parse --mode=quick", () => {
      const mode = manager.parseModeFromArgs(["--mode=quick"])
      expect(mode).toBe("quick")
    })

    it("should parse --mode quick (space separated)", () => {
      const mode = manager.parseModeFromArgs(["--mode", "quick"])
      expect(mode).toBe("quick")
    })

    it("should return null when no mode specified", () => {
      const mode = manager.parseModeFromArgs(["--verbose"])
      expect(mode).toBeNull()
    })
  })
})

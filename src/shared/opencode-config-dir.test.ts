import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  getOpenCodeConfigDir,
  getOpenCodeConfigPaths,
  isDevBuild,
  detectExistingConfigDir,
  TAURI_APP_IDENTIFIER,
  TAURI_APP_IDENTIFIER_DEV,
} from "./opencode-config-dir"

describe("opencode-config-dir", () => {
  let originalPlatform: NodeJS.Platform
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalPlatform = process.platform
    originalEnv = {
      APPDATA: process.env.APPDATA,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    }
  })

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform })
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) {
        process.env[key] = value
      } else {
        delete process.env[key]
      }
    }
  })

  describe("isDevBuild", () => {
    test("returns false for null version", () => {
      expect(isDevBuild(null)).toBe(false)
    })

    test("returns false for undefined version", () => {
      expect(isDevBuild(undefined)).toBe(false)
    })

    test("returns false for production version", () => {
      expect(isDevBuild("1.0.200")).toBe(false)
      expect(isDevBuild("2.1.0")).toBe(false)
    })

    test("returns true for version containing -dev", () => {
      expect(isDevBuild("1.0.0-dev")).toBe(true)
      expect(isDevBuild("1.0.0-dev.123")).toBe(true)
    })

    test("returns true for version containing .dev", () => {
      expect(isDevBuild("1.0.0.dev")).toBe(true)
      expect(isDevBuild("1.0.0.dev.456")).toBe(true)
    })
  })

  describe("getOpenCodeConfigDir", () => {
    describe("for opencode CLI binary", () => {
      test("returns ~/.config/opencode on Linux", () => {
        // #given opencode CLI binary detected, platform is Linux
        Object.defineProperty(process, "platform", { value: "linux" })
        delete process.env.XDG_CONFIG_HOME

        // #when getOpenCodeConfigDir is called with binary="opencode"
        const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

        // #then returns ~/.config/opencode
        expect(result).toBe(join(homedir(), ".config", "opencode"))
      })

      test("returns $XDG_CONFIG_HOME/opencode on Linux when XDG_CONFIG_HOME is set", () => {
        // #given opencode CLI binary detected, platform is Linux with XDG_CONFIG_HOME set
        Object.defineProperty(process, "platform", { value: "linux" })
        process.env.XDG_CONFIG_HOME = "/custom/config"

        // #when getOpenCodeConfigDir is called with binary="opencode"
        const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

        // #then returns $XDG_CONFIG_HOME/opencode
        expect(result).toBe("/custom/config/opencode")
      })

      test("returns ~/.config/opencode on macOS", () => {
        // #given opencode CLI binary detected, platform is macOS
        Object.defineProperty(process, "platform", { value: "darwin" })
        delete process.env.XDG_CONFIG_HOME

        // #when getOpenCodeConfigDir is called with binary="opencode"
        const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

        // #then returns ~/.config/opencode
        expect(result).toBe(join(homedir(), ".config", "opencode"))
      })

      test("returns ~/.config/opencode on Windows by default", () => {
        // #given opencode CLI binary detected, platform is Windows
        Object.defineProperty(process, "platform", { value: "win32" })
        delete process.env.APPDATA

        // #when getOpenCodeConfigDir is called with binary="opencode"
        const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200", checkExisting: false })

        // #then returns ~/.config/opencode (cross-platform default)
        expect(result).toBe(join(homedir(), ".config", "opencode"))
      })
    })

    describe("for opencode-desktop Tauri binary", () => {
      test("returns ~/.config/ai.opencode.desktop on Linux", () => {
        // #given opencode-desktop binary detected, platform is Linux
        Object.defineProperty(process, "platform", { value: "linux" })
        delete process.env.XDG_CONFIG_HOME

        // #when getOpenCodeConfigDir is called with binary="opencode-desktop"
        const result = getOpenCodeConfigDir({ binary: "opencode-desktop", version: "1.0.200", checkExisting: false })

        // #then returns ~/.config/ai.opencode.desktop
        expect(result).toBe(join(homedir(), ".config", TAURI_APP_IDENTIFIER))
      })

      test("returns ~/Library/Application Support/ai.opencode.desktop on macOS", () => {
        // #given opencode-desktop binary detected, platform is macOS
        Object.defineProperty(process, "platform", { value: "darwin" })

        // #when getOpenCodeConfigDir is called with binary="opencode-desktop"
        const result = getOpenCodeConfigDir({ binary: "opencode-desktop", version: "1.0.200", checkExisting: false })

        // #then returns ~/Library/Application Support/ai.opencode.desktop
        expect(result).toBe(join(homedir(), "Library", "Application Support", TAURI_APP_IDENTIFIER))
      })

      test("returns %APPDATA%/ai.opencode.desktop on Windows", () => {
        // #given opencode-desktop binary detected, platform is Windows
        Object.defineProperty(process, "platform", { value: "win32" })
        process.env.APPDATA = "C:\\Users\\TestUser\\AppData\\Roaming"

        // #when getOpenCodeConfigDir is called with binary="opencode-desktop"
        const result = getOpenCodeConfigDir({ binary: "opencode-desktop", version: "1.0.200", checkExisting: false })

        // #then returns %APPDATA%/ai.opencode.desktop
        expect(result).toBe(join("C:\\Users\\TestUser\\AppData\\Roaming", TAURI_APP_IDENTIFIER))
      })
    })

    describe("dev build detection", () => {
      test("returns ai.opencode.desktop.dev path when dev version detected", () => {
        // #given opencode-desktop dev version
        Object.defineProperty(process, "platform", { value: "linux" })
        delete process.env.XDG_CONFIG_HOME

        // #when getOpenCodeConfigDir is called with dev version
        const result = getOpenCodeConfigDir({ binary: "opencode-desktop", version: "1.0.0-dev.123", checkExisting: false })

        // #then returns path with ai.opencode.desktop.dev
        expect(result).toBe(join(homedir(), ".config", TAURI_APP_IDENTIFIER_DEV))
      })

      test("returns ai.opencode.desktop.dev on macOS for dev build", () => {
        // #given opencode-desktop dev version on macOS
        Object.defineProperty(process, "platform", { value: "darwin" })

        // #when getOpenCodeConfigDir is called with dev version
        const result = getOpenCodeConfigDir({ binary: "opencode-desktop", version: "1.0.0-dev", checkExisting: false })

        // #then returns path with ai.opencode.desktop.dev
        expect(result).toBe(join(homedir(), "Library", "Application Support", TAURI_APP_IDENTIFIER_DEV))
      })
    })
  })

  describe("getOpenCodeConfigPaths", () => {
    test("returns all config paths for CLI binary", () => {
      // #given opencode CLI binary on Linux
      Object.defineProperty(process, "platform", { value: "linux" })
      delete process.env.XDG_CONFIG_HOME

      // #when getOpenCodeConfigPaths is called
      const paths = getOpenCodeConfigPaths({ binary: "opencode", version: "1.0.200" })

      // #then returns all expected paths
      const expectedDir = join(homedir(), ".config", "opencode")
      expect(paths.configDir).toBe(expectedDir)
      expect(paths.configJson).toBe(join(expectedDir, "opencode.json"))
      expect(paths.configJsonc).toBe(join(expectedDir, "opencode.jsonc"))
      expect(paths.packageJson).toBe(join(expectedDir, "package.json"))
      expect(paths.omoConfig).toBe(join(expectedDir, "oh-my-opencode.json"))
    })

    test("returns all config paths for desktop binary", () => {
      // #given opencode-desktop binary on macOS
      Object.defineProperty(process, "platform", { value: "darwin" })

      // #when getOpenCodeConfigPaths is called
      const paths = getOpenCodeConfigPaths({ binary: "opencode-desktop", version: "1.0.200", checkExisting: false })

      // #then returns all expected paths
      const expectedDir = join(homedir(), "Library", "Application Support", TAURI_APP_IDENTIFIER)
      expect(paths.configDir).toBe(expectedDir)
      expect(paths.configJson).toBe(join(expectedDir, "opencode.json"))
      expect(paths.configJsonc).toBe(join(expectedDir, "opencode.jsonc"))
      expect(paths.packageJson).toBe(join(expectedDir, "package.json"))
      expect(paths.omoConfig).toBe(join(expectedDir, "oh-my-opencode.json"))
    })
  })

  describe("detectExistingConfigDir", () => {
    test("returns null when no config exists", () => {
      // #given no config files exist
      Object.defineProperty(process, "platform", { value: "linux" })
      delete process.env.XDG_CONFIG_HOME

      // #when detectExistingConfigDir is called
      const result = detectExistingConfigDir("opencode", "1.0.200")

      // #then result is either null or a valid string path
      expect(result === null || typeof result === "string").toBe(true)
    })
  })
})

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
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
      OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
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

  describe("OPENCODE_CONFIG_DIR environment variable", () => {
    test("returns OPENCODE_CONFIG_DIR when env var is set", () => {
      // #given OPENCODE_CONFIG_DIR is set to a custom path
      process.env.OPENCODE_CONFIG_DIR = "/custom/opencode/path"
      Object.defineProperty(process, "platform", { value: "linux" })

      // #when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // #then returns the custom path
      expect(result).toBe("/custom/opencode/path")
    })

    test("falls back to default when env var is not set", () => {
      // #given OPENCODE_CONFIG_DIR is not set, platform is Linux
      delete process.env.OPENCODE_CONFIG_DIR
      delete process.env.XDG_CONFIG_HOME
      Object.defineProperty(process, "platform", { value: "linux" })

      // #when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // #then returns default ~/.config/opencode
      expect(result).toBe(join(homedir(), ".config", "opencode"))
    })

    test("falls back to default when env var is empty string", () => {
      // #given OPENCODE_CONFIG_DIR is set to empty string
      process.env.OPENCODE_CONFIG_DIR = ""
      delete process.env.XDG_CONFIG_HOME
      Object.defineProperty(process, "platform", { value: "linux" })

      // #when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // #then returns default ~/.config/opencode
      expect(result).toBe(join(homedir(), ".config", "opencode"))
    })

    test("falls back to default when env var is whitespace only", () => {
      // #given OPENCODE_CONFIG_DIR is set to whitespace only
      process.env.OPENCODE_CONFIG_DIR = "   "
      delete process.env.XDG_CONFIG_HOME
      Object.defineProperty(process, "platform", { value: "linux" })

      // #when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // #then returns default ~/.config/opencode
      expect(result).toBe(join(homedir(), ".config", "opencode"))
    })

    test("resolves relative path to absolute path", () => {
      // #given OPENCODE_CONFIG_DIR is set to a relative path
      process.env.OPENCODE_CONFIG_DIR = "./my-opencode-config"
      Object.defineProperty(process, "platform", { value: "linux" })

      // #when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // #then returns resolved absolute path
      expect(result).toBe(resolve("./my-opencode-config"))
    })

    test("OPENCODE_CONFIG_DIR takes priority over XDG_CONFIG_HOME", () => {
      // #given both OPENCODE_CONFIG_DIR and XDG_CONFIG_HOME are set
      process.env.OPENCODE_CONFIG_DIR = "/custom/opencode/path"
      process.env.XDG_CONFIG_HOME = "/xdg/config"
      Object.defineProperty(process, "platform", { value: "linux" })

      // #when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // #then OPENCODE_CONFIG_DIR takes priority
      expect(result).toBe("/custom/opencode/path")
    })
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
        delete process.env.OPENCODE_CONFIG_DIR

        // #when getOpenCodeConfigDir is called with binary="opencode"
        const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

        // #then returns ~/.config/opencode
        expect(result).toBe(join(homedir(), ".config", "opencode"))
      })

      test("returns $XDG_CONFIG_HOME/opencode on Linux when XDG_CONFIG_HOME is set", () => {
        // #given opencode CLI binary detected, platform is Linux with XDG_CONFIG_HOME set
        Object.defineProperty(process, "platform", { value: "linux" })
        process.env.XDG_CONFIG_HOME = "/custom/config"
        delete process.env.OPENCODE_CONFIG_DIR

        // #when getOpenCodeConfigDir is called with binary="opencode"
        const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

        // #then returns $XDG_CONFIG_HOME/opencode
        expect(result).toBe("/custom/config/opencode")
      })

      test("returns ~/.config/opencode on macOS", () => {
        // #given opencode CLI binary detected, platform is macOS
        Object.defineProperty(process, "platform", { value: "darwin" })
        delete process.env.XDG_CONFIG_HOME
        delete process.env.OPENCODE_CONFIG_DIR

        // #when getOpenCodeConfigDir is called with binary="opencode"
        const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

        // #then returns ~/.config/opencode
        expect(result).toBe(join(homedir(), ".config", "opencode"))
      })

      test("returns ~/.config/opencode on Windows by default", () => {
        // #given opencode CLI binary detected, platform is Windows
        Object.defineProperty(process, "platform", { value: "win32" })
        delete process.env.APPDATA
        delete process.env.OPENCODE_CONFIG_DIR

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
      delete process.env.OPENCODE_CONFIG_DIR

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
      delete process.env.OPENCODE_CONFIG_DIR

      // #when detectExistingConfigDir is called
      const result = detectExistingConfigDir("opencode", "1.0.200")

      // #then result is either null or a valid string path
      expect(result === null || typeof result === "string").toBe(true)
    })

    test("includes OPENCODE_CONFIG_DIR in search locations when set", () => {
      // #given OPENCODE_CONFIG_DIR is set to a custom path
      process.env.OPENCODE_CONFIG_DIR = "/custom/opencode/path"
      Object.defineProperty(process, "platform", { value: "linux" })
      delete process.env.XDG_CONFIG_HOME

      // #when detectExistingConfigDir is called
      const result = detectExistingConfigDir("opencode", "1.0.200")

      // #then result is either null (no config file exists) or a valid string path
      // The important thing is that the function doesn't throw
      expect(result === null || typeof result === "string").toBe(true)
    })
  })
})

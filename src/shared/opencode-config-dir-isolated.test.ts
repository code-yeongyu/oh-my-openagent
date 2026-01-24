import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import {
  getOpenCodeConfigDir,
  getOpenCodeConfigPaths,
  getOmoIsolatedConfigDir,
  getOmoDefaultIsolatedDir,
} from "./opencode-config-dir"

describe("opencode-config-dir - OH_MY_OPENCODE_CONFIG_DIR (isolated mode)", () => {
  let originalPlatform: NodeJS.Platform
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalPlatform = process.platform
    originalEnv = {
      APPDATA: process.env.APPDATA,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
      OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
      OH_MY_OPENCODE_CONFIG_DIR: process.env.OH_MY_OPENCODE_CONFIG_DIR,
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

  describe("OH_MY_OPENCODE_CONFIG_DIR environment variable", () => {
    test("returns OH_MY_OPENCODE_CONFIG_DIR when env var is set", () => {
      // #given OH_MY_OPENCODE_CONFIG_DIR is set to a custom path
      const customPath = resolve("/custom/oh-my-opencode/path")
      process.env.OH_MY_OPENCODE_CONFIG_DIR = "/custom/oh-my-opencode/path"
      Object.defineProperty(process, "platform", { value: "linux" })

      // #when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // #then returns custom path
      expect(result).toBe(customPath)
    })

    test("OH_MY_OPENCODE_CONFIG_DIR takes priority over OPENCODE_CONFIG_DIR", () => {
      // #given both OH_MY_OPENCODE_CONFIG_DIR and OPENCODE_CONFIG_DIR are set
      const omoPath = resolve("/omo/isolated")
      process.env.OH_MY_OPENCODE_CONFIG_DIR = "/omo/isolated"
      process.env.OPENCODE_CONFIG_DIR = "/generic/opencode"
      Object.defineProperty(process, "platform", { value: "linux" })

      // #when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // #then OH_MY_OPENCODE_CONFIG_DIR takes priority
      expect(result).toBe(omoPath)
    })

    test("OH_MY_OPENCODE_CONFIG_DIR takes priority over XDG_CONFIG_HOME", () => {
      // #given both OH_MY_OPENCODE_CONFIG_DIR and XDG_CONFIG_HOME are set
      const omoPath = resolve("/omo/isolated")
      process.env.OH_MY_OPENCODE_CONFIG_DIR = "/omo/isolated"
      process.env.XDG_CONFIG_HOME = "/xdg/config"
      Object.defineProperty(process, "platform", { value: "linux" })

      // #when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // #then OH_MY_OPENCODE_CONFIG_DIR takes priority
      expect(result).toBe(omoPath)
    })

    test("falls back to OPENCODE_CONFIG_DIR when OH_MY_OPENCODE_CONFIG_DIR is not set", () => {
      // #given only OPENCODE_CONFIG_DIR is set
      delete process.env.OH_MY_OPENCODE_CONFIG_DIR
      const genericPath = resolve("/generic/opencode")
      process.env.OPENCODE_CONFIG_DIR = "/generic/opencode"
      Object.defineProperty(process, "platform", { value: "linux" })

      // #when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // #then returns OPENCODE_CONFIG_DIR path
      expect(result).toBe(genericPath)
    })

    test("falls back to default when OH_MY_OPENCODE_CONFIG_DIR is empty string", () => {
      // #given OH_MY_OPENCODE_CONFIG_DIR is set to empty string
      process.env.OH_MY_OPENCODE_CONFIG_DIR = ""
      delete process.env.XDG_CONFIG_HOME
      Object.defineProperty(process, "platform", { value: "linux" })

      // #when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // #then returns default ~/.config/opencode
      expect(result).toBe(join(homedir(), ".config", "opencode"))
    })

    test("falls back to default when OH_MY_OPENCODE_CONFIG_DIR is whitespace only", () => {
      // #given OH_MY_OPENCODE_CONFIG_DIR is set to whitespace only
      process.env.OH_MY_OPENCODE_CONFIG_DIR = "   "
      delete process.env.XDG_CONFIG_HOME
      Object.defineProperty(process, "platform", { value: "linux" })

      // #when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // #then returns default ~/.config/opencode
      expect(result).toBe(join(homedir(), ".config", "opencode"))
    })

    test("resolves relative path to absolute path", () => {
      // #given OH_MY_OPENCODE_CONFIG_DIR is set to a relative path
      process.env.OH_MY_OPENCODE_CONFIG_DIR = "./my-omo-config"
      Object.defineProperty(process, "platform", { value: "linux" })

      // #when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // #then returns resolved absolute path
      expect(result).toBe(resolve("./my-omo-config"))
    })
  })

  describe("getOmoDefaultIsolatedDir", () => {
    test("returns ~/.config/oh-my-opencode on Linux", () => {
      // #given platform is Linux
      Object.defineProperty(process, "platform", { value: "linux" })

      // #when getOmoDefaultIsolatedDir is called
      const result = getOmoDefaultIsolatedDir()

      // #then returns ~/.config/oh-my-opencode
      expect(result).toBe(join(homedir(), ".config", "oh-my-opencode"))
    })

    test("returns ~/.config/oh-my-opencode on macOS", () => {
      // #given platform is macOS
      Object.defineProperty(process, "platform", { value: "darwin" })

      // #when getOmoDefaultIsolatedDir is called
      const result = getOmoDefaultIsolatedDir()

      // #then returns ~/.config/oh-my-opencode
      expect(result).toBe(join(homedir(), ".config", "oh-my-opencode"))
    })

    test("returns ~/.config/oh-my-opencode on Windows", () => {
      // #given platform is Windows
      Object.defineProperty(process, "platform", { value: "win32" })

      // #when getOmoDefaultIsolatedDir is called
      const result = getOmoDefaultIsolatedDir()

      // #then returns ~/.config/oh-my-opencode (cross-platform default)
      expect(result).toBe(join(homedir(), ".config", "oh-my-opencode"))
    })
  })

  describe("getOmoIsolatedConfigDir", () => {
    test("returns custom isolated directory when OH_MY_OPENCODE_CONFIG_DIR is set", () => {
      // #given OH_MY_OPENCODE_CONFIG_DIR is set to a custom path
      const customPath = resolve("/custom/oh-my-opencode/path")
      process.env.OH_MY_OPENCODE_CONFIG_DIR = "/custom/oh-my-opencode/path"
      Object.defineProperty(process, "platform", { value: "linux" })

      // #when getOmoIsolatedConfigDir is called
      const paths = getOmoIsolatedConfigDir({ binary: "opencode", version: "1.0.200" })

      // #then returns custom isolated paths
      expect(paths.configDir).toBe(customPath)
      expect(paths.configJson).toBe(join(customPath, "opencode.json"))
      expect(paths.configJsonc).toBe(join(customPath, "opencode.jsonc"))
      expect(paths.packageJson).toBe(join(customPath, "package.json"))
      expect(paths.omoConfig).toBe(join(customPath, "oh-my-opencode.json"))
    })

    test("returns default isolated directory when OH_MY_OPENCODE_CONFIG_DIR is not set", () => {
      // #given OH_MY_OPENCODE_CONFIG_DIR is not set
      delete process.env.OH_MY_OPENCODE_CONFIG_DIR
      Object.defineProperty(process, "platform", { value: "linux" })

      // #when getOmoIsolatedConfigDir is called
      const paths = getOmoIsolatedConfigDir({ binary: "opencode", version: "1.0.200" })

      // #then returns default isolated paths
      const expectedDir = join(homedir(), ".config", "oh-my-opencode")
      expect(paths.configDir).toBe(expectedDir)
      expect(paths.configJson).toBe(join(expectedDir, "opencode.json"))
      expect(paths.configJsonc).toBe(join(expectedDir, "opencode.jsonc"))
      expect(paths.packageJson).toBe(join(expectedDir, "package.json"))
      expect(paths.omoConfig).toBe(join(expectedDir, "oh-my-opencode.json"))
    })

    test("resolves relative OH_MY_OPENCODE_CONFIG_DIR to absolute path", () => {
      // #given OH_MY_OPENCODE_CONFIG_DIR is set to a relative path
      process.env.OH_MY_OPENCODE_CONFIG_DIR = "./my-omo-config"
      Object.defineProperty(process, "platform", { value: "linux" })

      // #when getOmoIsolatedConfigDir is called
      const paths = getOmoIsolatedConfigDir({ binary: "opencode", version: "1.0.200" })

      // #then returns resolved absolute paths
      expect(paths.configDir).toBe(resolve("./my-omo-config"))
      expect(paths.configJson).toBe(resolve("./my-omo-config/opencode.json"))
      expect(paths.configJsonc).toBe(resolve("./my-omo-config/opencode.jsonc"))
      expect(paths.packageJson).toBe(resolve("./my-omo-config/package.json"))
      expect(paths.omoConfig).toBe(resolve("./my-omo-config/oh-my-opencode.json"))
    })
  })

  describe("getOpenCodeConfigPaths with isolated mode", () => {
    test("returns isolated config paths when OH_MY_OPENCODE_CONFIG_DIR is set", () => {
      // #given OH_MY_OPENCODE_CONFIG_DIR is set to a custom path
      const customPath = resolve("/custom/oh-my-opencode/path")
      process.env.OH_MY_OPENCODE_CONFIG_DIR = "/custom/oh-my-opencode/path"
      Object.defineProperty(process, "platform", { value: "linux" })

      // #when getOpenCodeConfigPaths is called
      const paths = getOpenCodeConfigPaths({ binary: "opencode", version: "1.0.200" })

      // #then returns isolated config paths
      expect(paths.configDir).toBe(customPath)
      expect(paths.configJson).toBe(join(customPath, "opencode.json"))
      expect(paths.configJsonc).toBe(join(customPath, "opencode.jsonc"))
      expect(paths.packageJson).toBe(join(customPath, "package.json"))
      expect(paths.omoConfig).toBe(join(customPath, "oh-my-opencode.json"))
    })

    test("returns default config paths when OH_MY_OPENCODE_CONFIG_DIR is not set", () => {
      // #given OH_MY_OPENCODE_CONFIG_DIR is not set
      delete process.env.OH_MY_OPENCODE_CONFIG_DIR
      Object.defineProperty(process, "platform", { value: "linux" })
      delete process.env.XDG_CONFIG_HOME

      // #when getOpenCodeConfigPaths is called
      const paths = getOpenCodeConfigPaths({ binary: "opencode", version: "1.0.200" })

      // #then returns default config paths
      const expectedDir = join(homedir(), ".config", "opencode")
      expect(paths.configDir).toBe(expectedDir)
      expect(paths.configJson).toBe(join(expectedDir, "opencode.json"))
      expect(paths.configJsonc).toBe(join(expectedDir, "opencode.jsonc"))
      expect(paths.packageJson).toBe(join(expectedDir, "package.json"))
      expect(paths.omoConfig).toBe(join(expectedDir, "oh-my-opencode.json"))
    })
  })
})

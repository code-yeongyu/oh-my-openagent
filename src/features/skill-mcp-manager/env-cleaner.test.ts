import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { createCleanMcpEnvironment, EXCLUDED_ENV_PATTERNS } from "./env-cleaner"

describe("createCleanMcpEnvironment", () => {
  // Store original env to restore after tests
  const originalEnv = { ...process.env }

  afterEach(() => {
    // Restore original environment
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key]
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value
    }
  })

  describe("NPM_CONFIG_* filtering", () => {
    it("filters out uppercase NPM_CONFIG_* variables", () => {
      // #given
      process.env.NPM_CONFIG_REGISTRY = "https://private.registry.com"
      process.env.NPM_CONFIG_CACHE = "/some/cache/path"
      process.env.NPM_CONFIG_PREFIX = "/some/prefix"
      process.env.PATH = "/usr/bin"

      // #when
      const cleanEnv = createCleanMcpEnvironment()

      // #then
      expect(cleanEnv.NPM_CONFIG_REGISTRY).toBeUndefined()
      expect(cleanEnv.NPM_CONFIG_CACHE).toBeUndefined()
      expect(cleanEnv.NPM_CONFIG_PREFIX).toBeUndefined()
      expect(cleanEnv.PATH).toBe("/usr/bin")
    })

    it("filters out lowercase npm_config_* variables", () => {
      // #given
      process.env.npm_config_registry = "https://private.registry.com"
      process.env.npm_config_cache = "/some/cache/path"
      process.env.npm_config_https_proxy = "http://proxy:8080"
      process.env.npm_config_proxy = "http://proxy:8080"
      process.env.HOME = "/home/user"

      // #when
      const cleanEnv = createCleanMcpEnvironment()

      // #then
      expect(cleanEnv.npm_config_registry).toBeUndefined()
      expect(cleanEnv.npm_config_cache).toBeUndefined()
      expect(cleanEnv.npm_config_https_proxy).toBeUndefined()
      expect(cleanEnv.npm_config_proxy).toBeUndefined()
      expect(cleanEnv.HOME).toBe("/home/user")
    })
  })

  describe("YARN_* filtering", () => {
    it("filters out YARN_* variables", () => {
      // #given
      process.env.YARN_CACHE_FOLDER = "/yarn/cache"
      process.env.YARN_ENABLE_IMMUTABLE_INSTALLS = "true"
      process.env.YARN_REGISTRY = "https://yarn.registry.com"
      process.env.NODE_ENV = "production"

      // #when
      const cleanEnv = createCleanMcpEnvironment()

      // #then
      expect(cleanEnv.YARN_CACHE_FOLDER).toBeUndefined()
      expect(cleanEnv.YARN_ENABLE_IMMUTABLE_INSTALLS).toBeUndefined()
      expect(cleanEnv.YARN_REGISTRY).toBeUndefined()
      expect(cleanEnv.NODE_ENV).toBe("production")
    })
  })

  describe("PNPM_* filtering", () => {
    it("filters out PNPM_* variables", () => {
      // #given
      process.env.PNPM_HOME = "/pnpm/home"
      process.env.PNPM_STORE_DIR = "/pnpm/store"
      process.env.USER = "testuser"

      // #when
      const cleanEnv = createCleanMcpEnvironment()

      // #then
      expect(cleanEnv.PNPM_HOME).toBeUndefined()
      expect(cleanEnv.PNPM_STORE_DIR).toBeUndefined()
      expect(cleanEnv.USER).toBe("testuser")
    })
  })

  describe("NO_UPDATE_NOTIFIER filtering", () => {
    it("filters out NO_UPDATE_NOTIFIER variable", () => {
      // #given
      process.env.NO_UPDATE_NOTIFIER = "1"
      process.env.SHELL = "/bin/bash"

      // #when
      const cleanEnv = createCleanMcpEnvironment()

      // #then
      expect(cleanEnv.NO_UPDATE_NOTIFIER).toBeUndefined()
      expect(cleanEnv.SHELL).toBe("/bin/bash")
    })
  })

  describe("custom environment overlay", () => {
    it("merges custom env on top of clean process.env", () => {
      // #given
      process.env.PATH = "/usr/bin"
      process.env.NPM_CONFIG_REGISTRY = "https://private.registry.com"
      const customEnv = {
        MCP_API_KEY: "secret-key",
        CUSTOM_VAR: "custom-value",
      }

      // #when
      const cleanEnv = createCleanMcpEnvironment(customEnv)

      // #then
      expect(cleanEnv.PATH).toBe("/usr/bin")
      expect(cleanEnv.NPM_CONFIG_REGISTRY).toBeUndefined()
      expect(cleanEnv.MCP_API_KEY).toBe("secret-key")
      expect(cleanEnv.CUSTOM_VAR).toBe("custom-value")
    })

    it("custom env can override process.env values", () => {
      // #given
      process.env.NODE_ENV = "development"
      const customEnv = {
        NODE_ENV: "production",
      }

      // #when
      const cleanEnv = createCleanMcpEnvironment(customEnv)

      // #then
      expect(cleanEnv.NODE_ENV).toBe("production")
    })
  })

  describe("undefined value handling", () => {
    it("skips undefined values from process.env", () => {
      // #given - process.env can have undefined values in TypeScript
      const envWithUndefined = { ...process.env, UNDEFINED_VAR: undefined }
      Object.assign(process.env, envWithUndefined)

      // #when
      const cleanEnv = createCleanMcpEnvironment()

      // #then - should not throw and should not include undefined values
      expect(cleanEnv.UNDEFINED_VAR).toBeUndefined()
      expect(Object.values(cleanEnv).every((v) => v !== undefined)).toBe(true)
    })
  })

  describe("mixed case handling", () => {
    it("filters both uppercase and lowercase npm config variants", () => {
      // #given - pnpm/yarn can set both cases simultaneously
      process.env.NPM_CONFIG_CACHE = "/uppercase/cache"
      process.env.npm_config_cache = "/lowercase/cache"
      process.env.NPM_CONFIG_REGISTRY = "https://uppercase.registry.com"
      process.env.npm_config_registry = "https://lowercase.registry.com"

      // #when
      const cleanEnv = createCleanMcpEnvironment()

      // #then
      expect(cleanEnv.NPM_CONFIG_CACHE).toBeUndefined()
      expect(cleanEnv.npm_config_cache).toBeUndefined()
      expect(cleanEnv.NPM_CONFIG_REGISTRY).toBeUndefined()
      expect(cleanEnv.npm_config_registry).toBeUndefined()
    })
  })
})

describe("EXCLUDED_ENV_PATTERNS", () => {
  it("contains patterns for npm, yarn, and pnpm configs", () => {
    // #given / #when / #then
    expect(EXCLUDED_ENV_PATTERNS.length).toBeGreaterThanOrEqual(4)

    // Test that patterns match expected strings
    const testCases = [
      { pattern: "NPM_CONFIG_REGISTRY", shouldMatch: true },
      { pattern: "npm_config_registry", shouldMatch: true },
      { pattern: "YARN_CACHE_FOLDER", shouldMatch: true },
      { pattern: "PNPM_HOME", shouldMatch: true },
      { pattern: "NO_UPDATE_NOTIFIER", shouldMatch: true },
      { pattern: "PATH", shouldMatch: false },
      { pattern: "HOME", shouldMatch: false },
      { pattern: "NODE_ENV", shouldMatch: false },
    ]

    for (const { pattern, shouldMatch } of testCases) {
      const matches = EXCLUDED_ENV_PATTERNS.some((regex: RegExp) => regex.test(pattern))
      expect(matches).toBe(shouldMatch)
    }
  })
})

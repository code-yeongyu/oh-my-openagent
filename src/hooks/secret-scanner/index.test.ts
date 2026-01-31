/**
 * Secret Scanner Hook Tests
 */

import { describe, test, expect } from "bun:test"
import { scanContent, createSecretScannerHook } from "./index"
import { DEFAULT_SECRET_SCANNER_CONFIG } from "./patterns"

describe("Secret Scanner Hook", () => {
  describe("scanContent", () => {
    test("should detect API_KEY pattern", () => {
      // #given - content with API key
      const content = `const config = {
  API_KEY: "sk-1234567890abcdefghij"
}`
      const filePath = "src/config.ts"

      // #when - scanning content
      const result = scanContent(content, filePath)

      // #then - should detect secret
      expect(result.hasSecrets).toBe(true)
      expect(result.matches.length).toBeGreaterThan(0)
      expect(result.shouldBlock).toBe(true)
    })

    test("should detect password pattern", () => {
      // #given - content with hardcoded password
      const content = `const db = {
  password: "mysuperSecretP@ss123"
}`
      const filePath = "src/database.ts"

      // #when - scanning content
      const result = scanContent(content, filePath)

      // #then - should detect secret
      expect(result.hasSecrets).toBe(true)
      expect(result.matches.some(m => m.pattern.name === "password_assignment")).toBe(true)
    })

    test("should detect AWS access key", () => {
      // #given - content with AWS key
      const content = `const aws = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE"
}`
      const filePath = "src/aws.ts"

      // #when - scanning content
      const result = scanContent(content, filePath)

      // #then - should detect AWS key
      expect(result.hasSecrets).toBe(true)
      expect(result.matches.some(m => m.pattern.name === "aws_access_key")).toBe(true)
      expect(result.shouldBlock).toBe(true)
    })

    test("should detect GitHub token", () => {
      // #given - content with GitHub token
      const content = `const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz"`
      const filePath = "src/github.ts"

      // #when - scanning content
      const result = scanContent(content, filePath)

      // #then - should detect GitHub token
      expect(result.hasSecrets).toBe(true)
      expect(result.matches.some(m => m.pattern.name === "github_token")).toBe(true)
    })

    test("should allow normal code without secrets", () => {
      // #given - normal code without secrets
      const content = `export function fetchData(apiEndpoint: string) {
  return fetch(apiEndpoint)
}

const api = {
  baseUrl: "https://api.example.com",
  timeout: 5000
}`
      const filePath = "src/api.ts"

      // #when - scanning content
      const result = scanContent(content, filePath)

      // #then - should not detect secrets
      expect(result.hasSecrets).toBe(false)
      expect(result.matches.length).toBe(0)
      expect(result.shouldBlock).toBe(false)
    })

    test("should allow environment variable references", () => {
      // #given - content using env vars
      const content = `const config = {
  apiKey: process.env.API_KEY,
  secret: process.env.SECRET_TOKEN
}`
      const filePath = "src/config.ts"

      // #when - scanning content
      const result = scanContent(content, filePath)

      // #then - should not block env var references
      expect(result.shouldBlock).toBe(false)
    })

    test("should whitelist test files", () => {
      // #given - test file with mock secrets
      const content = `const mockApiKey = "sk-test1234567890abcdefghij"
test("should authenticate", () => {
  expect(auth(mockApiKey)).toBe(true)
})`
      const filePath = "src/__tests__/auth.test.ts"

      // #when - scanning content
      const result = scanContent(content, filePath)

      // #then - should not block test files
      expect(result.shouldBlock).toBe(false)
    })

    test("should whitelist spec files", () => {
      // #given - spec file with mock secrets
      const content = `const mockToken = "ghp_mocktoken12345678901234567890123"`
      const filePath = "src/auth.spec.ts"

      // #when - scanning content
      const result = scanContent(content, filePath)

      // #then - should not block spec files
      expect(result.shouldBlock).toBe(false)
    })

    test("should detect private keys", () => {
      // #given - content with private key
      const content = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
-----END RSA PRIVATE KEY-----`
      const filePath = "src/certs/key.ts"

      // #when - scanning content
      const result = scanContent(content, filePath)

      // #then - should detect private key
      expect(result.hasSecrets).toBe(true)
      expect(result.matches.some(m => m.pattern.name === "private_key")).toBe(true)
      expect(result.shouldBlock).toBe(true)
    })

    test("should detect database connection strings", () => {
      // #given - content with database URL
      const content = `const dbUrl = "postgres://user:password123@localhost:5432/mydb"`
      const filePath = "src/db.ts"

      // #when - scanning content
      const result = scanContent(content, filePath)

      // #then - should detect database URL
      expect(result.hasSecrets).toBe(true)
      expect(result.matches.some(m => m.pattern.name === "database_url")).toBe(true)
    })

    test("should respect custom whitelist paths", () => {
      // #given - custom config with additional whitelist
      const content = `const apiKey = "sk-prod1234567890abcdefghij"`
      const filePath = "src/fixtures/mock-data.ts"
      const config = {
        ...DEFAULT_SECRET_SCANNER_CONFIG,
        whitelist_paths: [...DEFAULT_SECRET_SCANNER_CONFIG.whitelist_paths, "**/fixtures/**"],
      }

      // #when - scanning with custom config
      const result = scanContent(content, filePath, config)

      // #then - should not block whitelisted path
      expect(result.shouldBlock).toBe(false)
    })

    test("should warn but not block when block_on_detection is false", () => {
      // #given - config with blocking disabled
      const content = `const apiKey = "sk-1234567890abcdefghij"`
      const filePath = "src/config.ts"
      const config = {
        ...DEFAULT_SECRET_SCANNER_CONFIG,
        block_on_detection: false,
      }

      // #when - scanning with blocking disabled
      const result = scanContent(content, filePath, config)

      // #then - should detect but not block
      expect(result.hasSecrets).toBe(true)
      expect(result.shouldBlock).toBe(false)
    })
  })

  describe("createSecretScannerHook", () => {
    test("should create hook with default config", () => {
      // #given - hook context
      const ctx = { cwd: "/test" }

      // #when - creating hook
      const hook = createSecretScannerHook(ctx)

      // #then - should have expected structure
      expect(hook.name).toBe("secret-scanner")
      expect(hook["tool.execute.before"]).toBeDefined()
    })

    test("should block edit with secrets", async () => {
      // #given - hook and edit with secrets
      const ctx = { cwd: "/test" }
      const hook = createSecretScannerHook(ctx)
      const input = { tool: "edit", sessionID: "test", callID: "1" }
      const output: {
        args: Record<string, unknown>
        blocked?: boolean
        message?: string
      } = {
        args: {
          filePath: "src/config.ts",
          newString: `const key = "AKIAIOSFODNN7EXAMPLE"`,
        },
      }

      // #when - hook is called
      await hook["tool.execute.before"](input, output)

      // #then - should block
      expect(output.blocked).toBe(true)
      expect(output.message).toContain("Secret Scanner")
    })

    test("should not block non-edit tools", async () => {
      // #given - hook and read tool
      const ctx = { cwd: "/test" }
      const hook = createSecretScannerHook(ctx)
      const input = { tool: "read", sessionID: "test", callID: "1" }
      const output: {
        args: Record<string, unknown>
        blocked?: boolean
      } = {
        args: { filePath: "src/config.ts" },
      }

      // #when - hook is called
      await hook["tool.execute.before"](input, output)

      // #then - should not block
      expect(output.blocked).toBeUndefined()
    })

    test("should not block when disabled", async () => {
      // #given - disabled hook
      const ctx = { cwd: "/test" }
      const hook = createSecretScannerHook(ctx, { config: { enabled: false } })
      const input = { tool: "edit", sessionID: "test", callID: "1" }
      const output: {
        args: Record<string, unknown>
        blocked?: boolean
      } = {
        args: {
          filePath: "src/config.ts",
          newString: `const key = "AKIAIOSFODNN7EXAMPLE"`,
        },
      }

      // #when - hook is called
      await hook["tool.execute.before"](input, output)

      // #then - should not block
      expect(output.blocked).toBeUndefined()
    })
  })
})

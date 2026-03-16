import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { expandEnvVars, expandEnvVarsInObject } from "./env-expander"

describe("env-expander", () => {
  const TEST_DIR = "/tmp/env-expander-test"
  
  beforeEach(() => {
    // Create test directory and files
    mkdirSync(TEST_DIR, { recursive: true })
    writeFileSync(join(TEST_DIR, "secret-token.txt"), "secret-api-key-123")
    writeFileSync(join(TEST_DIR, "config.json"), '{"host": "localhost", "port": 8080}')
    writeFileSync(join(TEST_DIR, "multi-line.txt"), "line1\nline2\nline3")
    writeFileSync(join(TEST_DIR, "whitespace.txt"), "  secret-with-whitespace  \n")
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  describe("expandEnvVars", () => {
    it("resolves {file:path} templates to file content", () => {
      const result = expandEnvVars(`Bearer {file:${TEST_DIR}/secret-token.txt}`)
      expect(result).toBe("Bearer secret-api-key-123")
    })

    it("trims whitespace from file content", () => {
      const result = expandEnvVars(`Token: {file:${TEST_DIR}/whitespace.txt}`)
      expect(result).toBe("Token: secret-with-whitespace")
    })

    it("resolves multiple {file:} templates in same string", () => {
      const result = expandEnvVars(`API_KEY={file:${TEST_DIR}/secret-token.txt} CONFIG={file:${TEST_DIR}/config.json}`)
      expect(result).toBe(`API_KEY=secret-api-key-123 CONFIG={"host": "localhost", "port": 8080}`)
    })

    it("returns original string if file does not exist", () => {
      const original = "{file:/nonexistent/file.txt}"
      const result = expandEnvVars(original)
      expect(result).toBe(original)
    })

    it("resolves relative paths from process.cwd()", () => {
      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)
      try {
        const result = expandEnvVars("Token: {file:secret-token.txt}")
        expect(result).toBe("Token: secret-api-key-123")
      } finally {
        process.chdir(originalCwd)
      }
    })

    it("resolves ${VAR} templates after {file:} templates", () => {
      process.env.TEST_VAR = "env-value"
      const result = expandEnvVars(`Config: {file:${TEST_DIR}/secret-token.txt} Env: \${TEST_VAR}`)
      expect(result).toBe("Config: secret-api-key-123 Env: env-value")
      delete process.env.TEST_VAR
    })

    it("handles {file:} template with default values for ${VAR}", () => {
      const result = expandEnvVars(`{file:${TEST_DIR}/secret-token.txt} \${NONEXISTENT:-default}`)
      expect(result).toBe("secret-api-key-123 default")
    })

    it("preserves ${VAR} functionality as before", () => {
      process.env.TEST_VAR = "test-value"
      const result = expandEnvVars("\${TEST_VAR}")
      expect(result).toBe("test-value")
      delete process.env.TEST_VAR
    })

    it("handles ${VAR} with default values", () => {
      const result = expandEnvVars("\${NONEXISTENT:-default-value}")
      expect(result).toBe("default-value")
    })
  })

  describe("expandEnvVarsInObject", () => {
    it("recursively resolves file templates in nested objects", () => {
      const config = {
        auth: {
          token: `{file:${TEST_DIR}/secret-token.txt}`,
          config: `{file:${TEST_DIR}/config.json}`
        },
        server: {
          host: "localhost"
        }
      }
      
      const result = expandEnvVarsInObject(config)
      expect(result).toEqual({
        auth: {
          token: "secret-api-key-123",
          config: '{"host": "localhost", "port": 8080}'
        },
        server: {
          host: "localhost"
        }
      })
    })

    it("resolves file templates in arrays", () => {
      const config = {
        tokens: [
          `{file:${TEST_DIR}/secret-token.txt}`,
          "static-token"
        ]
      }
      
      const result = expandEnvVarsInObject(config)
      expect(result).toEqual({
        tokens: [
          "secret-api-key-123",
          "static-token"
        ]
      })
    })

    it("handles combination of {file:} and ${VAR} templates", () => {
      process.env.TEST_ENV = "env-value"
      const config = {
        secret: `{file:${TEST_DIR}/secret-token.txt}`,
        env: "\${TEST_ENV}",
        combined: `Token: {file:${TEST_DIR}/secret-token.txt} Env: \${TEST_ENV}`
      }
      
      const result = expandEnvVarsInObject(config)
      expect(result).toEqual({
        secret: "secret-api-key-123",
        env: "env-value",
        combined: "Token: secret-api-key-123 Env: env-value"
      })
      delete process.env.TEST_ENV
    })
  })
})
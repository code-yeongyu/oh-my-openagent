import { describe, test, expect } from "bun:test"
import { createBuiltinMcps, McpNameSchema } from "./index"
import { websearch_exa } from "./websearch-exa"
import { context7 } from "./context7"
import { grep_app } from "./grep-app"
import { honeycomb } from "./honeycomb"
import { cypress } from "./cypress"
import { vault } from "./vault"

describe("MCP configurations", () => {
  describe("McpNameSchema", () => {
    test("includes all built-in MCPs", () => {
      const validNames = [
        "websearch_exa",
        "context7",
        "grep_app",
        "honeycomb",
        "cypress",
        "vault",
      ]

      for (const name of validNames) {
        const result = McpNameSchema.safeParse(name)
        expect(result.success).toBe(true)
      }
    })

    test("rejects invalid MCP names", () => {
      const result = McpNameSchema.safeParse("invalid_mcp")
      expect(result.success).toBe(false)
    })
  })

  describe("websearch_exa", () => {
    test("has correct configuration", () => {
      expect(websearch_exa.type).toBe("remote")
      expect(websearch_exa.url).toContain("exa")
      expect(websearch_exa.enabled).toBe(true)
    })
  })

  describe("context7", () => {
    test("has correct configuration", () => {
      expect(context7.type).toBe("remote")
      expect(context7.url).toContain("context7")
      expect(context7.enabled).toBe(true)
    })
  })

  describe("grep_app", () => {
    test("has correct configuration", () => {
      expect(grep_app.type).toBe("remote")
      expect(grep_app.url).toContain("grep")
      expect(grep_app.enabled).toBe(true)
    })
  })

  describe("honeycomb", () => {
    test("has correct configuration", () => {
      expect(honeycomb.type).toBe("remote")
      expect(honeycomb.url).toContain("honeycomb")
      expect(honeycomb.enabled).toBe(true)
    })
  })

  describe("cypress", () => {
    test("has correct configuration", () => {
      expect(cypress.type).toBe("remote")
      expect(cypress.url).toContain("cypress")
      expect(cypress.enabled).toBe(true)
    })
  })

  describe("vault", () => {
    test("has correct configuration", () => {
      expect(vault.type).toBe("remote")
      expect(vault.url).toContain("vault")
      expect(vault.enabled).toBe(true)
    })
  })

  describe("createBuiltinMcps", () => {
    test("returns all MCPs when no disabled list", () => {
      const mcps = createBuiltinMcps()

      expect(Object.keys(mcps)).toContain("websearch_exa")
      expect(Object.keys(mcps)).toContain("context7")
      expect(Object.keys(mcps)).toContain("grep_app")
      expect(Object.keys(mcps)).toContain("honeycomb")
      expect(Object.keys(mcps)).toContain("cypress")
      expect(Object.keys(mcps)).toContain("vault")
    })

    test("excludes disabled MCPs", () => {
      const mcps = createBuiltinMcps(["honeycomb", "cypress", "vault"])

      expect(Object.keys(mcps)).toContain("websearch_exa")
      expect(Object.keys(mcps)).toContain("context7")
      expect(Object.keys(mcps)).toContain("grep_app")
      expect(Object.keys(mcps)).not.toContain("honeycomb")
      expect(Object.keys(mcps)).not.toContain("cypress")
      expect(Object.keys(mcps)).not.toContain("vault")
    })

    test("returns empty object when all disabled", () => {
      const mcps = createBuiltinMcps([
        "websearch_exa",
        "context7",
        "grep_app",
        "honeycomb",
        "cypress",
        "vault",
      ])

      expect(Object.keys(mcps).length).toBe(0)
    })

    test("each MCP has required properties", () => {
      const mcps = createBuiltinMcps()

      for (const [name, config] of Object.entries(mcps)) {
        expect(config.type).toBe("remote")
        expect(config.url).toBeDefined()
        expect(typeof config.url).toBe("string")
        expect(config.enabled).toBe(true)
      }
    })
  })
})

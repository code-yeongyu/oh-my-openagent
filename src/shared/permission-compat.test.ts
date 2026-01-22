import { describe, test, expect } from "bun:test"
import {
  createAgentToolRestrictions,
  createAgentToolAllowlist,
  migrateToolsToPermission,
  migrateAgentConfig,
} from "./permission-compat"

describe("permission-compat", () => {
  describe("createAgentToolRestrictions", () => {
    test("returns permission format with deny values", () => {
      // #given tools to restrict
      // #when creating restrictions
      const result = createAgentToolRestrictions(["write", "edit"])

      // #then returns permission format
      expect(result).toEqual({
        permission: { write: "deny", edit: "deny" },
      })
    })

    test("returns empty permission for empty array", () => {
      // #given empty tools array
      // #when creating restrictions
      const result = createAgentToolRestrictions([])

      // #then returns empty permission
      expect(result).toEqual({ permission: {} })
    })
  })

  describe("createAgentToolAllowlist", () => {
    test("returns wildcard deny with explicit allow", () => {
      // #given tools to allow
      // #when creating allowlist
      const result = createAgentToolAllowlist(["read"])

      // #then returns wildcard deny with read allow
      expect(result).toEqual({
        permission: { "*": "deny", read: "allow" },
      })
    })

    test("returns wildcard deny with multiple allows", () => {
      // #given multiple tools to allow
      // #when creating allowlist
      const result = createAgentToolAllowlist(["read", "glob"])

      // #then returns wildcard deny with both allows
      expect(result).toEqual({
        permission: { "*": "deny", read: "allow", glob: "allow" },
      })
    })
  })

  describe("migrateToolsToPermission", () => {
    test("converts boolean tools to permission values", () => {
      // #given tools config
      const tools = { write: false, edit: true, bash: false }

      // #when migrating
      const result = migrateToolsToPermission(tools)

      // #then converts correctly
      expect(result).toEqual({
        write: "deny",
        edit: "allow",
        bash: "deny",
      })
    })
  })

  describe("migrateAgentConfig", () => {
    test("migrates tools to permission", () => {
      // #given config with tools
      const config = {
        model: "test",
        tools: { write: false, edit: false },
      }

      // #when migrating
      const result = migrateAgentConfig(config)

      // #then converts to permission
      expect(result.tools).toBeUndefined()
      expect(result.permission).toEqual({ write: "deny", edit: "deny" })
      expect(result.model).toBe("test")
    })

    test("preserves other config fields", () => {
      // #given config with other fields
      const config = {
        model: "test",
        temperature: 0.5,
        prompt: "hello",
        tools: { write: false },
      }

      // #when migrating
      const result = migrateAgentConfig(config)

      // #then preserves other fields
      expect(result.model).toBe("test")
      expect(result.temperature).toBe(0.5)
      expect(result.prompt).toBe("hello")
    })

    test("merges existing permission with migrated tools", () => {
      // #given config with both tools and permission
      const config = {
        tools: { write: false },
        permission: { bash: "deny" as const },
      }

      // #when migrating
      const result = migrateAgentConfig(config)

      // #then merges permission (existing takes precedence)
      expect(result.tools).toBeUndefined()
      expect(result.permission).toEqual({ write: "deny", bash: "deny" })
    })

    test("returns unchanged config if no tools", () => {
      // #given config without tools
      const config = { model: "test", permission: { edit: "deny" as const } }

      // #when migrating
      const result = migrateAgentConfig(config)

      // #then returns unchanged
      expect(result).toEqual(config)
    })
  })
})

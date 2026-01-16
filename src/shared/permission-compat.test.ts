import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  createAgentToolRestrictions,
  createAgentToolAllowlist,
  migrateToolsToPermission,
  migratePermissionToTools,
  migrateAgentConfig,
} from "./permission-compat"
import { setVersionCache, resetVersionCache } from "./opencode-version"

describe("permission-compat", () => {
  beforeEach(() => {
    resetVersionCache()
  })

  afterEach(() => {
    resetVersionCache()
  })

  describe("createAgentToolRestrictions", () => {
    test("returns permission format for v1.1.1+", () => {
      // #given version is 1.1.1
      setVersionCache("1.1.1")

      // #when creating restrictions
      const result = createAgentToolRestrictions(["write", "edit"])

      // #then returns permission format
      expect(result).toEqual({
        permission: { write: "deny", edit: "deny" },
      })
    })

    test("returns tools format for versions below 1.1.1", () => {
      // #given version is below 1.1.1
      setVersionCache("1.0.150")

      // #when creating restrictions
      const result = createAgentToolRestrictions(["write", "edit"])

      // #then returns tools format
      expect(result).toEqual({
        tools: { write: false, edit: false },
      })
    })

    test("assumes new format when version unknown", () => {
      // #given version is null
      setVersionCache(null)

      // #when creating restrictions
      const result = createAgentToolRestrictions(["write"])

      // #then returns permission format (assumes new version)
      expect(result).toEqual({
        permission: { write: "deny" },
      })
    })
  })

  describe("createAgentToolAllowlist", () => {
    test("returns wildcard deny with explicit allow for v1.1.1+", () => {
      // #given version is 1.1.1
      setVersionCache("1.1.1")

      // #when creating allowlist
      const result = createAgentToolAllowlist(["read"])

      // #then returns wildcard deny with read allow
      expect(result).toEqual({
        permission: { "*": "deny", read: "allow" },
      })
    })

    test("returns wildcard deny with multiple allows for v1.1.1+", () => {
      // #given version is 1.1.1
      setVersionCache("1.1.1")

      // #when creating allowlist with multiple tools
      const result = createAgentToolAllowlist(["read", "glob"])

      // #then returns wildcard deny with both allows
      expect(result).toEqual({
        permission: { "*": "deny", read: "allow", glob: "allow" },
      })
    })

    test("returns explicit deny list for old versions", () => {
      // #given version is below 1.1.1
      setVersionCache("1.0.150")

      // #when creating allowlist
      const result = createAgentToolAllowlist(["read"])

      // #then returns tools format with common tools denied except read
      expect(result).toHaveProperty("tools")
      const tools = (result as { tools: Record<string, boolean> }).tools
      expect(tools.write).toBe(false)
      expect(tools.edit).toBe(false)
      expect(tools.bash).toBe(false)
      expect(tools.read).toBeUndefined()
    })

    test("excludes allowed tools from legacy deny list", () => {
      // #given version is below 1.1.1
      setVersionCache("1.0.150")

      // #when creating allowlist with glob
      const result = createAgentToolAllowlist(["read", "glob"])

      // #then glob is not in deny list
      const tools = (result as { tools: Record<string, boolean> }).tools
      expect(tools.glob).toBeUndefined()
      expect(tools.write).toBe(false)
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

  describe("migratePermissionToTools", () => {
    test("converts permission to boolean tools", () => {
      // #given permission config
      const permission = { write: "deny" as const, edit: "allow" as const }

      // #when migrating
      const result = migratePermissionToTools(permission)

      // #then converts correctly
      expect(result).toEqual({ write: false, edit: true })
    })

    test("excludes ask values", () => {
      // #given permission with ask
      const permission = {
        write: "deny" as const,
        edit: "ask" as const,
        bash: "allow" as const,
      }

      // #when migrating
      const result = migratePermissionToTools(permission)

      // #then ask is excluded
      expect(result).toEqual({ write: false, bash: true })
    })
  })

  describe("migrateAgentConfig", () => {
    test("migrates tools to permission for v1.1.1+", () => {
      // #given v1.1.1 and config with tools
      setVersionCache("1.1.1")
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

    test("migrates permission to tools for old versions", () => {
      // #given old version and config with permission
      setVersionCache("1.0.150")
      const config = {
        model: "test",
        permission: { write: "deny" as const, edit: "deny" as const },
      }

      // #when migrating
      const result = migrateAgentConfig(config)

      // #then converts to tools
      expect(result.permission).toBeUndefined()
      expect(result.tools).toEqual({ write: false, edit: false })
    })

    test("preserves other config fields", () => {
      // #given config with other fields
      setVersionCache("1.1.1")
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
  })
})

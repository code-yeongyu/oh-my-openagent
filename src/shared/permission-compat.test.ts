import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  createAgentToolRestrictions,
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

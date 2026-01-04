import { describe, test, expect } from "bun:test"
import {
  createToolDenyList,
  permissionValueToBoolean,
  booleanToPermissionValue,
  convertToolsToPermission,
  convertPermissionToTools,
  createAgentRestrictions,
} from "./permission-compat"

describe("permission-compat", () => {
  describe("createToolDenyList", () => {
    test("creates tools config with all values false", () => {
      // #given a list of tool names
      const tools = ["write", "edit", "task"]

      // #when creating deny list
      const result = createToolDenyList(tools)

      // #then all values are false
      expect(result).toEqual({ write: false, edit: false, task: false })
    })

    test("returns empty object for empty array", () => {
      // #given empty array
      // #when creating deny list
      const result = createToolDenyList([])

      // #then returns empty object
      expect(result).toEqual({})
    })
  })

  describe("permissionValueToBoolean", () => {
    test("converts allow to true", () => {
      expect(permissionValueToBoolean("allow")).toBe(true)
    })

    test("converts deny to false", () => {
      expect(permissionValueToBoolean("deny")).toBe(false)
    })

    test("converts ask to false", () => {
      expect(permissionValueToBoolean("ask")).toBe(false)
    })
  })

  describe("booleanToPermissionValue", () => {
    test("converts true to allow", () => {
      expect(booleanToPermissionValue(true)).toBe("allow")
    })

    test("converts false to deny", () => {
      expect(booleanToPermissionValue(false)).toBe("deny")
    })
  })

  describe("convertToolsToPermission", () => {
    test("converts boolean tools config to permission format", () => {
      // #given tools config with booleans
      const tools = { write: false, edit: true, bash: false }

      // #when converting to permission
      const result = convertToolsToPermission(tools)

      // #then converts to permission values
      expect(result).toEqual({ write: "deny", edit: "allow", bash: "deny" })
    })

    test("handles empty tools config", () => {
      // #given empty config
      // #when converting
      const result = convertToolsToPermission({})

      // #then returns empty object
      expect(result).toEqual({})
    })
  })

  describe("convertPermissionToTools", () => {
    test("converts permission to boolean tools config", () => {
      // #given permission config
      const permission = { write: "deny" as const, edit: "allow" as const }

      // #when converting to tools
      const result = convertPermissionToTools(permission)

      // #then converts to boolean values
      expect(result).toEqual({ write: false, edit: true })
    })

    test("excludes ask values", () => {
      // #given permission with ask value
      const permission = {
        write: "deny" as const,
        edit: "ask" as const,
        bash: "allow" as const,
      }

      // #when converting
      const result = convertPermissionToTools(permission)

      // #then ask is excluded
      expect(result).toEqual({ write: false, bash: true })
    })
  })

  describe("createAgentRestrictions", () => {
    test("creates restrictions with denied tools", () => {
      // #given deny tools list
      const config = { denyTools: ["write", "task"] }

      // #when creating restrictions
      const result = createAgentRestrictions(config)

      // #then creates tools config
      expect(result).toEqual({ tools: { write: false, task: false } })
    })

    test("creates restrictions with permission", () => {
      // #given permission config
      const config = {
        permission: { edit: "deny" as const, bash: "ask" as const },
      }

      // #when creating restrictions
      const result = createAgentRestrictions(config)

      // #then creates permission config
      expect(result).toEqual({
        permission: { edit: "deny", bash: "ask" },
      })
    })

    test("combines tools and permission", () => {
      // #given both deny tools and permission
      const config = {
        denyTools: ["task"],
        permission: { edit: "deny" as const },
      }

      // #when creating restrictions
      const result = createAgentRestrictions(config)

      // #then includes both
      expect(result).toEqual({
        tools: { task: false },
        permission: { edit: "deny" },
      })
    })

    test("returns empty object when no config provided", () => {
      // #given empty config
      // #when creating restrictions
      const result = createAgentRestrictions({})

      // #then returns empty object
      expect(result).toEqual({})
    })
  })
})

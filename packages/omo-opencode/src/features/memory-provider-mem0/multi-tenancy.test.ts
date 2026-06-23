import { describe, expect, it } from "bun:test"
import {
  buildProjectScopedUserId,
  hasPermission,
  PROJECT_ROLE_PERMISSIONS,
} from "./multi-tenancy"

describe("hasPermission", () => {
  it("#given READER role #when checking view #then returns true", () => {
    expect(hasPermission("READER", "view")).toBe(true)
  })

  it("#given READER role #when checking create #then returns false", () => {
    expect(hasPermission("READER", "create")).toBe(false)
  })

  it("#given MEMBER role #when checking update #then returns true", () => {
    expect(hasPermission("MEMBER", "update")).toBe(true)
  })

  it("#given MEMBER role #when checking manage_members #then returns false", () => {
    expect(hasPermission("MEMBER", "manage_members")).toBe(false)
  })

  it("#given OWNER role #when checking manage_settings #then returns true", () => {
    expect(hasPermission("OWNER", "manage_settings")).toBe(true)
  })

  it("#given unknown permission #when checked #then returns false", () => {
    expect(hasPermission("OWNER", "nonexistent")).toBe(false)
  })
})

describe("PROJECT_ROLE_PERMISSIONS", () => {
  it("#given role map #when inspected #then OWNER has strict superset of MEMBER", () => {
    const memberPerms = PROJECT_ROLE_PERMISSIONS.MEMBER
    const ownerPerms = PROJECT_ROLE_PERMISSIONS.OWNER
    for (const perm of memberPerms) {
      expect(ownerPerms).toContain(perm)
    }
  })

  it("#given role map #when inspected #then MEMBER has strict superset of READER", () => {
    const readerPerms = PROJECT_ROLE_PERMISSIONS.READER
    const memberPerms = PROJECT_ROLE_PERMISSIONS.MEMBER
    for (const perm of readerPerms) {
      expect(memberPerms).toContain(perm)
    }
  })
})

describe("buildProjectScopedUserId", () => {
  it("#given project and creator #when built #then returns project:creator format", () => {
    expect(buildProjectScopedUserId("proj-1", "alice")).toBe("proj-1:alice")
  })

  it("#given empty strings #when built #then returns colon separator", () => {
    expect(buildProjectScopedUserId("", "")).toBe(":")
  })
})

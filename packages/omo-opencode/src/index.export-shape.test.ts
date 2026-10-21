import { describe, expect, it } from "bun:test"
import pluginModule, { omoPlugin } from "./index"
import { createPermissionGateHook } from "./hooks/permission-gate"
import * as hooksBarrel from "./hooks"
import { HookNameSchema } from "./config/schema/hooks"

describe("oh-my-openagent plugin export shape", () => {
  it("keeps default module and named server exports aligned", () => {
    // given
    const defaultServer = pluginModule.server

    // when
    const namedServer = omoPlugin

    // then
    expect(typeof defaultServer).toBe("function")
    expect(namedServer).toBe(defaultServer)
  })

  it("exposes the OpenCode 2 id + setup entry beside the V1 server entry", async () => {
    // given
    const definition: Record<string, unknown> = pluginModule

    // when
    const setup = definition["setup"]

    // then
    expect(definition["id"]).toBe("oh-my-openagent")
    expect(typeof definition["server"]).toBe("function")
    expect(typeof setup).toBe("function")
    if (typeof setup !== "function") return
    expect(await setup({})).toBeUndefined()
  })

  it("re-exports the permission-gate hook factory from the hooks barrel", () => {
    // given
    const barrelExports = hooksBarrel as unknown as Record<string, unknown>

    // when
    const factory = barrelExports["createPermissionGateHook"]

    // then
    expect(typeof factory).toBe("function")
    expect(createPermissionGateHook).toBe(factory)
  })

  it("lists `permission-gate` in the HookNameSchema enum", () => {
    // given
    const schema = HookNameSchema

    // when / then
    expect(schema.options).toContain("permission-gate")
  })
})

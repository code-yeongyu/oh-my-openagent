import { describe, expect, test } from "bun:test"
import { createDefaultRemoteSurface } from "./default-remote"
import { createLazyRemoteSurface } from "./lazy-remote"

// The session's permission preset reaches `open_session` only through these factories (component -> default-remote ->
// lazy-remote -> `remote.permissionPreset`, read by remote-ops on create and fork). Dropping the pass-through anywhere
// makes every remote create/fork fall back to the engine's delegated default, silently.
const neverLoads = () => Promise.reject(new Error("the preset read must not load the device-service runtime"))

describe("the remote surface carries the session's permission preset (#6189)", () => {
  test("#given the default surface built with a preset getter #when read #then it answers the session's preset", () => {
    const remote = createDefaultRemoteSurface({ version: "0.0.0", permissionPreset: () => "ask" })
    expect(remote.permissionPreset?.()).toBe("ask")
  })

  test("#given the default surface built without a getter #when read #then it names no preset", () => {
    const remote = createDefaultRemoteSurface({ version: "0.0.0" })
    expect(remote.permissionPreset?.()).toBeUndefined()
  })

  test("#given a lazy surface with or without an alias registry #when read #then both forward the getter without loading the runtime", () => {
    const withRegistry = createLazyRemoteSurface({ version: "0.0.0", loadRuntime: neverLoads, loadAliasRegistry: neverLoads, permissionPreset: () => "full-access" })
    const withoutRegistry = createLazyRemoteSurface({ version: "0.0.0", loadRuntime: neverLoads, permissionPreset: () => "full-access" })
    expect(withRegistry.permissionPreset?.()).toBe("full-access")
    expect(withoutRegistry.permissionPreset?.()).toBe("full-access")
  })

  test("#given the session's preset changes #when the surface is read again #then it reports the new preset (read live, not captured)", () => {
    let preset = "ask"
    const remote = createDefaultRemoteSurface({ version: "0.0.0", permissionPreset: () => preset })
    expect(remote.permissionPreset?.()).toBe("ask")
    preset = "full-access"
    expect(remote.permissionPreset?.()).toBe("full-access")
  })
})

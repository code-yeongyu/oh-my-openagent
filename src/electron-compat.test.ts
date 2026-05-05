import { describe, test, expect } from "bun:test"

describe("electron-compat shim", () => {
  test("#given shim module #when inspected #then it exports no values (side-effect only)", async () => {
    // The shim is a side-effect module — no named exports
    const mod = await import("./electron-compat")
    expect(Object.keys(mod)).toHaveLength(0)
  })

  test("#given Bun runtime #when shim is loaded #then globalThis.Bun remains the real Bun", () => {
    // In Bun (our test environment), globalThis.Bun is already defined.
    // The shim must not overwrite it.
    expect(globalThis.Bun).toBeDefined()
    // Real Bun version looks like "1.x.x", not our shim string
    expect(globalThis.Bun.version).not.toBe("0.0.0-node-shim")
  })

  test("#given dist/index.js #when inspected #then compat shim appears before first globalThis.Bun destructure", async () => {
    // This test guards that build/prepend-electron-shim ran.
    // If the shim is missing, the plugin crashes on Electron at line 2876.
    const dist = await Bun.file("dist/index.js").text()
    const shimPos = dist.indexOf("[omo] Electron/Node compat shim")
    const firstDestructure = dist.indexOf("} = globalThis.Bun;")
    expect(shimPos).toBeGreaterThanOrEqual(0) // shim present
    expect(shimPos).toBeLessThan(firstDestructure) // shim before destructures
  })
})

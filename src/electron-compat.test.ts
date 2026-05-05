import { describe, test, expect } from "bun:test"

describe("electron-compat: dist/index.js globalThis.Bun safety", () => {
  test("#given dist/index.js #then no top-level globalThis.Bun destructures exist", async () => {
    // This guards the fix for https://github.com/code-yeongyu/oh-my-openagent/issues/3797.
    // Previously 'bun build --target bun' emitted 25 top-level
    //   var { spawn } = globalThis.Bun;
    // statements that crashed on Node/Electron where globalThis.Bun is undefined.
    // The fix replaces all 'from "bun"' spawn imports with a node:child_process
    // shim so the bundler no longer emits these destructures.
    const dist = await Bun.file("dist/index.js").text()
    const destructures = (dist.match(/\} = globalThis\.Bun;/g) ?? []).length
    expect(destructures).toBe(0)
  })

  test("#given Bun runtime #when shim module is loaded #then globalThis.Bun remains real Bun", () => {
    // On real Bun runtime, globalThis.Bun must not be overwritten by any shim
    expect(globalThis.Bun).toBeDefined()
    expect(typeof globalThis.Bun.spawn).toBe("function")
    // The shim version string is only set when globalThis.Bun was absent
    expect(globalThis.Bun.version).not.toBe("0.0.0-node-shim")
  })
})

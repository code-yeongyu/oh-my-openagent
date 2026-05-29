/// <reference types="bun-types" />

import { afterEach, describe, expect, it, mock } from "bun:test"

const originalWhich = Bun.which

afterEach(() => {
  Bun.which = originalWhich
  mock.restore()
})

describe("getPlannotatorInfo", () => {
  it("detects plannotator as installed when Bun.which finds it", async () => {
    // given
    Bun.which = mock(() => "C:\\bin\\plannotator.exe")
    mock.module("../spawn-with-timeout", () => ({
      spawnWithTimeout: mock((command: string[]) => {
        if (command.join(" ") === "plannotator --version") {
          return Promise.resolve({ stdout: "plannotator version 1.0.3\n", stderr: "", exitCode: 0, timedOut: false })
        }
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 1, timedOut: false })
      }),
    }))
    const { getPlannotatorInfo } = await import("./plannotator")

    // when
    const info = await getPlannotatorInfo()

    // then
    expect(info.installed).toBe(true)
    expect(info.version).toBe("1.0.3")
    expect(info.path).toBe("C:\\bin\\plannotator.exe")
  })

  it("detects plannotator even if Bun.which fails but execution succeeds", async () => {
    // given
    Bun.which = mock(() => null)
    mock.module("../spawn-with-timeout", () => ({
      spawnWithTimeout: mock((command: string[]) => {
        if (command.join(" ") === "plannotator --version") {
          return Promise.resolve({ stdout: "plannotator version 1.0.3\n", stderr: "", exitCode: 0, timedOut: false })
        }
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 1, timedOut: false })
      }),
    }))
    const { getPlannotatorInfo } = await import("./plannotator")

    // when
    const info = await getPlannotatorInfo()

    // then
    expect(info.installed).toBe(true)
    expect(info.version).toBe("1.0.3")
    expect(info.path).toBe(null)
  })

  it("returns not installed if binary cannot be found or executed", async () => {
    // given
    Bun.which = mock(() => null)
    mock.module("../spawn-with-timeout", () => ({
      spawnWithTimeout: mock(() => {
        return Promise.resolve({ stdout: "", stderr: "command not found", exitCode: 127, timedOut: false })
      }),
    }))
    const { getPlannotatorInfo } = await import("./plannotator")

    // when
    const info = await getPlannotatorInfo()

    // then
    expect(info.installed).toBe(false)
    expect(info.version).toBe(null)
    expect(info.path).toBe(null)
  })
})

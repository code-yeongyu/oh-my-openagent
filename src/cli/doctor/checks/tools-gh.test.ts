/// <reference types="bun-types" />

import { afterEach, describe, expect, it, mock } from "bun:test"

const originalWhich = Bun.which

afterEach(() => {
  Bun.which = originalWhich
  mock.restore()
})

describe("getGhCliInfo", () => {
  it("falls back to gh --version when Bun.which cannot find gh", async () => {
    // given
    Bun.which = mock(() => null)
    mock.module("../spawn-with-timeout", () => ({
      spawnWithTimeout: mock((command: string[]) => {
        if (command.join(" ") === "gh --version") {
          return Promise.resolve({ stdout: "gh version 2.82.1\n", stderr: "", exitCode: 0, timedOut: false })
        }

        return Promise.resolve({ stdout: "", stderr: "not logged in", exitCode: 1, timedOut: false })
      }),
    }))
    const { getGhCliInfo } = await import("./tools-gh")

    // when
    const info = await getGhCliInfo()

    // then
    expect(info.installed).toBe(true)
    expect(info.version).toBe("2.82.1")
    expect(info.path).toBe(null)
  })
})

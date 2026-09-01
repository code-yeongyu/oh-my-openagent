/// <reference types="bun-types" />

import { describe, expect, it, mock } from "bun:test"
import { getGhCliInfo } from "./tools-gh"

describe("getGhCliInfo", () => {
  it("falls back to gh --version when the path resolver cannot find gh", async () => {
    // given
    const which = mock(() => null)
    const spawn = mock((command: string[]) => {
      if (command.join(" ") === "gh --version") {
        return Promise.resolve({ stdout: "gh version 2.82.1\n", stderr: "", exitCode: 0, timedOut: false })
      }

      return Promise.resolve({ stdout: "", stderr: "not logged in", exitCode: 1, timedOut: false })
    })

    // when
    const info = await getGhCliInfo({ which, spawn })

    // then
    expect(info.installed).toBe(true)
    expect(info.version).toBe("2.82.1")
    expect(info.path).toBe(null)
  })
})

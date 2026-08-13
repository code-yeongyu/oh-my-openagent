import { describe, expect, test } from "bun:test"

import { bootstrapProcessOptions, modelChildWindowOptions } from "./supervisor-spawn-options"

describe("memory supervisor spawn options", () => {
  test("#given Windows #when spawning the model child #then the console window stays hidden", () => {
    expect(modelChildWindowOptions("win32")).toEqual({ windowsHide: true })
  })

  test("#given Windows #when spawning the bootstrap #then it stays attached and hidden", () => {
    expect(bootstrapProcessOptions("win32")).toEqual({
      detached: false,
      windowsHide: true,
    })
  })

  test("#given POSIX #when spawning the bootstrap #then process group isolation remains detached", () => {
    expect(bootstrapProcessOptions("posix")).toEqual({
      detached: true,
      windowsHide: true,
    })
  })
})

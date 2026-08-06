import { describe, expect, it } from "bun:test"

import { toSpawnTarget } from "./omo-command"

describe("omo-senpi ulw-loop omo-command spawn target", () => {
  it("#given a .cmd bin on win32 #when building the spawn target #then it wraps with cmd.exe /d /s /c", () => {
    const target = toSpawnTarget(
      "C:\\Users\\u\\.local\\bin\\omo.cmd",
      ["ulw-loop", "status", "--json"],
      "win32",
    )

    expect(target.command).toBe("cmd.exe")
    expect(target.args).toEqual([
      "/d",
      "/s",
      "/c",
      "C:\\Users\\u\\.local\\bin\\omo.cmd",
      "ulw-loop",
      "status",
      "--json",
    ])
  })

  it("#given an uppercase .BAT bin on win32 #when building the spawn target #then it still wraps", () => {
    const target = toSpawnTarget("D:\\tools\\OMO.BAT", ["--version"], "win32")

    expect(target.command).toBe("cmd.exe")
    expect(target.args).toEqual(["/d", "/s", "/c", "D:\\tools\\OMO.BAT", "--version"])
  })

  it("#given an .exe bin on win32 #when building the spawn target #then it spawns directly without cmd.exe", () => {
    const target = toSpawnTarget("C:\\bin\\omo.exe", ["status"], "win32")

    expect(target.command).toBe("C:\\bin\\omo.exe")
    expect(target.args).toEqual(["status"])
  })

  it("#given a plain bin on darwin #when building the spawn target #then it is unchanged", () => {
    const target = toSpawnTarget("/usr/local/bin/omo", ["ulw-loop", "status", "--json"], "darwin")

    expect(target).toEqual({
      command: "/usr/local/bin/omo",
      args: ["ulw-loop", "status", "--json"],
    })
  })

  it("#given a .cmd-looking path on non-win32 #when building the spawn target #then it is NOT wrapped (win32-only guard)", () => {
    const target = toSpawnTarget("/home/u/omo.cmd", ["status"], "linux")

    expect(target.command).toBe("/home/u/omo.cmd")
    expect(target.args).toEqual(["status"])
  })
})

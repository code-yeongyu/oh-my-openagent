import { describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { resolveOmoBin, toSpawnTarget } from "./omo-command"

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
    const target = toSpawnTarget("/usr/local/bin/omo-agent-toolkit", ["ulw-loop", "status", "--json"], "darwin")

    expect(target).toEqual({
      command: "/usr/local/bin/omo-agent-toolkit",
      args: ["ulw-loop", "status", "--json"],
    })
  })

  it("#given a .cmd-looking path on non-win32 #when building the spawn target #then it is NOT wrapped (win32-only guard)", () => {
    const target = toSpawnTarget("/home/u/omo.cmd", ["status"], "linux")

    expect(target.command).toBe("/home/u/omo.cmd")
    expect(target.args).toEqual(["status"])
  })
})

describe("omo-senpi ulw-loop omo-command bundled CLI resolution", () => {
  it("#given a staged CLI beside a packaged extension #when resolving with no env or PATH toolkit #then the bundled CLI wins", async () => {
    const pluginDir = await mkdtemp(join(tmpdir(), "omo-senpi-bundled-toolkit-"))
    try {
      await mkdir(join(pluginDir, "extensions"), { recursive: true })
      await mkdir(join(pluginDir, "runtime", "agent-toolkit"), { recursive: true })
      await writeFile(join(pluginDir, "extensions", "omo.js"), "")
      const stagedCli = join(pluginDir, "runtime", "agent-toolkit", "cli.js")
      await writeFile(stagedCli, "")

      const resolved = resolveOmoBin(
        { OMO_AGENT_TOOLKIT_BIN: undefined, OMO_BIN: undefined, PATH: "" },
        pathToFileURL(join(pluginDir, "extensions", "omo.js")).href,
      )

      expect(resolved).toBe(stagedCli)
    } finally {
      await rm(pluginDir, { recursive: true, force: true })
    }
  })
})

describe("omo-senpi ulw-loop omo-command .js spawn target", () => {
  it("#given a .js target on win32 #when building the spawn target #then it spawns via process.execPath with the target as argv1", () => {
    const target = toSpawnTarget(
      "C:\\tools\\omo-agent-toolkit.js",
      ["ulw-loop", "status", "--json"],
      "win32",
    )

    expect(target.command).toBe(process.execPath)
    expect(target.args).toEqual(["C:\\tools\\omo-agent-toolkit.js", "ulw-loop", "status", "--json"])
  })

  it("#given a .js target on darwin #when building the spawn target #then it spawns via process.execPath", () => {
    const target = toSpawnTarget("/usr/local/lib/omo-agent-toolkit.js", ["--version"], "darwin")

    expect(target.command).toBe(process.execPath)
    expect(target.args).toEqual(["/usr/local/lib/omo-agent-toolkit.js", "--version"])
  })

  it("#given a .js target with the default platform #when building the spawn target #then it spawns via process.execPath", () => {
    const target = toSpawnTarget("/opt/omo/bin/oh-my-opencode.js", ["doctor"])

    expect(target.command).toBe(process.execPath)
    expect(target.args).toEqual(["/opt/omo/bin/oh-my-opencode.js", "doctor"])
  })

  it("#given an uppercase .JS target on win32 #when building the spawn target #then it still spawns via process.execPath", () => {
    const target = toSpawnTarget("D:\\tools\\OMO-AGENT-TOOLKIT.JS", ["status"], "win32")

    expect(target.command).toBe(process.execPath)
    expect(target.args).toEqual(["D:\\tools\\OMO-AGENT-TOOLKIT.JS", "status"])
  })
})

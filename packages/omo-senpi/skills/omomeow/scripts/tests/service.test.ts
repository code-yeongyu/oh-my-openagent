import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildNudgeServiceSpec, installNudgeService, renderNudgeService, serviceFiles, uninstallNudgeService } from "../lib/service.mjs"

// Platform, uid, and the service-manager spawn are injected, so every branch runs on every OS.
let home: string
let env: Record<string, string>

type Reply = { status: number; stdout?: string; stderr?: string }
function fakeSpawn(replies: Record<string, Reply>) {
  const calls: string[] = []
  const spawn = (command: string, args: string[]) => {
    const line = [command, ...args].join(" ")
    calls.push(line)
    const key = Object.keys(replies).find((prefix) => line.startsWith(prefix))
    const reply = key === undefined ? { status: 0 } : replies[key]
    return { status: reply.status, stdout: reply.stdout ?? "", stderr: reply.stderr ?? "", error: undefined }
  }
  return { spawn, calls }
}

function spec() {
  return buildNudgeServiceSpec({ nodeBin: "/usr/bin/node", stateDir: join(home, "state"), intervalMinutes: 30, cwd: join(home, "work dir"), env })
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "omomeow-service-"))
  env = { HOME: home, PATH: "/usr/bin:/bin", XDG_CONFIG_HOME: join(home, "xdg") }
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe("renderNudgeService", () => {
  test("#given macOS #when rendered #then one launchd agent runs nudge --scheduled on a StartInterval", () => {
    const rendered = renderNudgeService(spec(), { platform: "darwin", env })

    expect(rendered.kind).toBe("launchd")
    expect(rendered.files.map((file: { path: string }) => file.path)).toEqual([join(home, "Library", "LaunchAgents", "ai.omo.omomeow-nudge.plist")])
    const plist = rendered.files[0].content
    expect(plist).toContain("<key>StartInterval</key>\n  <integer>1800</integer>")
    expect(plist).toContain(`<string>${join(home, "state", "runtime", "scripts", "omomeow.mjs")}</string>\n    <string>nudge</string>\n    <string>--scheduled</string>`)
    expect(plist).not.toContain("KeepAlive")
  })

  test("#given Linux #when rendered #then a oneshot service and a timer with the interval are written under XDG_CONFIG_HOME", () => {
    const rendered = renderNudgeService(spec(), { platform: "linux", env })

    expect(rendered.kind).toBe("systemd")
    const [service, timer] = rendered.files
    expect(service.path).toBe(join(home, "xdg", "systemd", "user", "omomeow-nudge.service"))
    expect(service.content).toContain("Type=oneshot")
    expect(service.content).toContain(`ExecStart="/usr/bin/node" "${join(home, "state", "runtime", "scripts", "omomeow.mjs")}" "nudge" "--scheduled"`)
    expect(timer.path).toBe(join(home, "xdg", "systemd", "user", "omomeow-nudge.timer"))
    expect(timer.content).toContain("OnUnitActiveSec=1800")
  })

  test("#given Windows #when rendered #then no service file is produced, only the command and interval to schedule", () => {
    const rendered = renderNudgeService(spec(), { platform: "win32", env })

    expect(rendered.kind).toBe("manual")
    expect(rendered.files).toEqual([])
    expect(rendered.manual.command).toEqual(["/usr/bin/node", join(home, "state", "runtime", "scripts", "omomeow.mjs"), "nudge", "--scheduled"])
    expect(rendered.manual.everySeconds).toBe(1800)
  })
})

describe("installNudgeService", () => {
  test("#given a loaded launchd agent #when installed #then it is booted out before the new file is bootstrapped", () => {
    const { spawn, calls } = fakeSpawn({})

    const result = installNudgeService({ spec: spec(), platform: "darwin", env, spawn, uid: 501 })

    expect(result.ok).toBe(true)
    expect(calls).toEqual([
      "launchctl print gui/501/ai.omo.omomeow-nudge",
      "launchctl bootout gui/501/ai.omo.omomeow-nudge",
      `launchctl bootstrap gui/501 ${join(home, "Library", "LaunchAgents", "ai.omo.omomeow-nudge.plist")}`,
    ])
  })

  test("#given bootstrap fails #when installed #then ok is false", () => {
    const { spawn } = fakeSpawn({ "launchctl print": { status: 113 }, "launchctl bootstrap": { status: 5, stderr: "Bootstrap failed: 5" } })

    const result = installNudgeService({ spec: spec(), platform: "darwin", env, spawn, uid: 501 })

    expect(result.ok).toBe(false)
  })

  test("#given launchctl print fails for an unknown reason #when installed #then it stops before bootstrap with ok false", () => {
    const { spawn, calls } = fakeSpawn({ "launchctl print": { status: 1 } })

    const result = installNudgeService({ spec: spec(), platform: "darwin", env, spawn, uid: 501 })

    expect(result.ok).toBe(false)
    expect(calls).toEqual(["launchctl print gui/501/ai.omo.omomeow-nudge"])
  })

  test("#given Windows #when installed #then it fails with the manual command instead of writing anything", () => {
    const { spawn, calls } = fakeSpawn({})

    const result = installNudgeService({ spec: spec(), platform: "win32", env, spawn })

    expect(result).toMatchObject({ kind: "manual", ok: false })
    expect(result.manual.everySeconds).toBe(1800)
    expect(calls).toEqual([])
  })
})

describe("uninstallNudgeService", () => {
  test("#given launchd bootout fails #when uninstalled #then the plist is kept and ok is false", () => {
    installNudgeService({ spec: spec(), platform: "darwin", env, spawn: fakeSpawn({}).spawn, uid: 501 })
    const { spawn } = fakeSpawn({ "launchctl bootout": { status: 5, stderr: "Boot-out failed: 5" } })

    const result = uninstallNudgeService({ platform: "darwin", env, spawn, uid: 501 })

    expect(result.ok).toBe(false)
    expect(result.kept).toEqual(serviceFiles("darwin", env))
    expect(existsSync(serviceFiles("darwin", env)[0])).toBe(true)
  })

  test("#given the launchd agent is not loaded #when uninstalled #then no bootout runs and the file is removed", () => {
    installNudgeService({ spec: spec(), platform: "darwin", env, spawn: fakeSpawn({}).spawn, uid: 501 })
    const { spawn, calls } = fakeSpawn({ "launchctl print": { status: 113 } })

    const result = uninstallNudgeService({ platform: "darwin", env, spawn, uid: 501 })

    expect(result.ok).toBe(true)
    expect(calls).toEqual(["launchctl print gui/501/ai.omo.omomeow-nudge"])
    expect(existsSync(serviceFiles("darwin", env)[0])).toBe(false)
  })

  test("#given launchctl print fails for an unknown reason #when uninstalled #then nothing is booted out or deleted and ok is false", () => {
    installNudgeService({ spec: spec(), platform: "darwin", env, spawn: fakeSpawn({}).spawn, uid: 501 })
    const { spawn, calls } = fakeSpawn({ "launchctl print": { status: 1, stderr: "Could not connect to launchd" } })

    const result = uninstallNudgeService({ platform: "darwin", env, spawn, uid: 501 })

    expect(result.ok).toBe(false)
    expect(calls).toEqual(["launchctl print gui/501/ai.omo.omomeow-nudge"])
    expect(existsSync(serviceFiles("darwin", env)[0])).toBe(true)
  })

  test("#given systemd cannot disable the timer #when uninstalled #then both unit files are kept", () => {
    installNudgeService({ spec: spec(), platform: "linux", env, spawn: fakeSpawn({}).spawn })
    const { spawn } = fakeSpawn({ "systemctl --user disable": { status: 1, stderr: "Failed to connect to bus" } })

    const result = uninstallNudgeService({ platform: "linux", env, spawn })

    expect(result.ok).toBe(false)
    for (const path of serviceFiles("linux", env)) expect(existsSync(path)).toBe(true)
  })

  test("#given nothing was installed on Linux #when uninstalled #then it succeeds without calling systemctl", () => {
    const { spawn, calls } = fakeSpawn({})

    const result = uninstallNudgeService({ platform: "linux", env, spawn })

    expect(result).toMatchObject({ ok: true, removed: [] })
    expect(calls).toEqual([])
  })
})

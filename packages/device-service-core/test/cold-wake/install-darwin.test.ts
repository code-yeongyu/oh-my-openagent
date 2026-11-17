import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { type ColdWakeHost, installColdWake, uninstallColdWake } from "../../src/cold-wake/index.ts"
import type { RunCommand } from "../../src/install.ts"
import { actions, fakeOmoHost, LAUNCH, OMO, ok, removeTempHomes, tempHome } from "./cold-wake-fakes.ts"

// omo#13594 on macOS: the session host is a LaunchAgent, and the device service's table lives in its own plist, so a
// table change reloads that job with a bootout and a bootstrap. The fake keeps the state launchd and plutil would keep.

afterEach(removeTempHomes)

const LABEL_PLIST = (home: string, label: string) => join(home, "Library", "LaunchAgents", `${label}.plist`)

/** launchctl and plutil over one in-memory table value; the relayd plist file only has to exist. */
function fakeLaunchd(options: { readonly bootstrapFailures?: number } = {}) {
  const home = tempHome("cwd-")
  const relayd = LABEL_PLIST(home, "ai.omo.relay-daemon")
  mkdirSync(dirname(relayd), { recursive: true })
  writeFileSync(relayd, "<plist/>")
  const state: { table: string | undefined; loaded: Set<string>; failures: number } = {
    table: undefined,
    loaded: new Set(),
    failures: options.bootstrapFailures ?? 0,
  }
  const runs: string[] = []
  const omo = fakeOmoHost(true)
  const run: RunCommand = async (argv) => {
    runs.push(argv.join(" "))
    if (argv[0] === "/usr/bin/env") return omo.answer(argv)
    const [tool, verb, target, value] = argv
    if (tool === "plutil" && verb === "-extract")
      return target === "EnvironmentVariables" || state.table !== undefined
        ? ok(`${state.table ?? ""}\n`)
        : { exitCode: 1, output: "No value at that key path" }
    if (tool === "plutil" && verb === "-replace") state.table = argv[4]
    if (tool === "plutil" && verb === "-remove") state.table = undefined
    if (tool === "launchctl" && verb === "print")
      return state.loaded.has(target ?? "") ? ok() : { exitCode: 113, output: "not found" }
    if (tool === "launchctl" && verb === "bootout") state.loaded.delete(target ?? "")
    if (tool === "launchctl" && verb === "bootstrap") {
      if (state.failures-- > 0) return { exitCode: 5, output: "Bootstrap failed: 5: Input/output error" }
      state.loaded.add(
        `${target}/${value?.endsWith("ai.omo.session-host.plist") ? "ai.omo.session-host" : "ai.omo.relay-daemon"}`,
      )
    }
    return ok()
  }
  const host: ColdWakeHost = { platform: "darwin", home, uid: 501, run, pause: async () => {} }
  return { host, home, runs, state, relayd, omo }
}

describe("cold wake on macOS", () => {
  test("loads the LaunchAgent (it runs at load), writes the entry into the device service's plist and reloads that job", async () => {
    const { host, home, runs, state, relayd } = fakeLaunchd()
    expect(await installColdWake(host, LAUNCH)).toEqual({ kind: "installed", serviceRestarted: true })
    const plist = LABEL_PLIST(home, "ai.omo.session-host")
    expect(readFileSync(plist, "utf8")).toContain("<string>ai.omo.session-host</string>")
    expect(JSON.parse(state.table ?? "")).toEqual({ omo: { launchd: "ai.omo.session-host", senders: [] } })
    expect(runs).toEqual([
      "launchctl bootout gui/501/ai.omo.session-host",
      "launchctl enable gui/501/ai.omo.session-host",
      `launchctl bootstrap gui/501 ${plist}`,
      `plutil -extract EnvironmentVariables.OMO_RELAYD_SERVICES raw -o - ${relayd}`,
      `plutil -extract EnvironmentVariables xml1 -o - ${relayd}`,
      `plutil -replace EnvironmentVariables.OMO_RELAYD_SERVICES -string ${state.table} ${relayd}`,
      "launchctl bootout gui/501/ai.omo.relay-daemon",
      `launchctl bootstrap gui/501 ${relayd}`,
    ])
  })

  test("a second install only checks: the job is loaded and the entry is there", async () => {
    const { host, runs, relayd } = fakeLaunchd()
    await installColdWake(host, LAUNCH)
    runs.length = 0
    expect(await installColdWake(host, LAUNCH)).toEqual({ kind: "installed", serviceRestarted: false })
    expect(runs).toEqual([
      "launchctl print gui/501/ai.omo.session-host",
      `plutil -extract EnvironmentVariables.OMO_RELAYD_SERVICES raw -o - ${relayd}`,
    ])
  })

  test("re-applies the entry a device service update dropped from its plist", async () => {
    const { host, state } = fakeLaunchd()
    await installColdWake(host, LAUNCH)
    state.table = undefined
    expect(await installColdWake(host, LAUNCH)).toEqual({ kind: "installed", serviceRestarted: true })
    expect(JSON.parse(state.table ?? "")).toEqual({ omo: { launchd: "ai.omo.session-host", senders: [] } })
  })

  test("retries a bootstrap that races the bootout before it succeeds", async () => {
    const { host, runs } = fakeLaunchd({ bootstrapFailures: 2 })
    expect(await installColdWake(host, LAUNCH)).toEqual({ kind: "installed", serviceRestarted: true })
    expect(runs.filter((r) => r.includes("bootstrap gui/501") && r.includes("session-host"))).toHaveLength(3)
  })

  test("uninstall with no LaunchAgent installed asks for no host and drains none", async () => {
    const { host, runs, omo } = fakeLaunchd()
    await uninstallColdWake(host, LAUNCH)
    expect(omo.state.running).toBe(true)
    expect(runs.filter((r) => r.startsWith("/usr/bin/env"))).toEqual([])
  })

  test("a drain that fails keeps the LaunchAgent plist, so the next uninstall tries again", async () => {
    const { host, home, omo } = fakeLaunchd()
    await installColdWake(host, LAUNCH)
    const failing: ColdWakeHost = {
      ...host,
      run: async (argv) =>
        argv.includes("stop") && argv[0] === "/usr/bin/env" ? { exitCode: 1, output: "busy\n" } : host.run(argv),
    }
    expect(await uninstallColdWake(failing, LAUNCH)).toEqual({ kind: "failed", step: "host_stop", detail: "busy" })
    expect(existsSync(LABEL_PLIST(home, "ai.omo.session-host"))).toBe(true)
    expect(await uninstallColdWake(host, LAUNCH)).toEqual({ kind: "removed", serviceRestarted: true })
    expect([existsSync(LABEL_PLIST(home, "ai.omo.session-host")), omo.state.running]).toEqual([false, false])
  })

  test("uninstall unloads and removes the LaunchAgent, drains its pinned host and removes the entry", async () => {
    const { host, home, state, runs, omo } = fakeLaunchd()
    await installColdWake(host, LAUNCH)
    runs.length = 0
    expect(await uninstallColdWake(host, LAUNCH)).toEqual({ kind: "removed", serviceRestarted: true })
    expect(existsSync(LABEL_PLIST(home, "ai.omo.session-host"))).toBe(false)
    expect(state.table).toBeUndefined()
    expect(omo.state.running).toBe(false)
    expect(runs.slice(0, 2)).toEqual(["launchctl bootout gui/501/ai.omo.session-host", `${OMO} status --json`])
    expect(runs[2]).toBe(`${OMO} stop --drain`)
    runs.length = 0
    expect(await uninstallColdWake(host, LAUNCH)).toEqual({ kind: "removed", serviceRestarted: false })
    expect(actions(runs).filter((r) => !r.includes("-extract"))).toEqual([])
  })
})

import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { type ColdWakeHost, installColdWake, uninstallColdWake } from "../../src/cold-wake/index.ts"
import { SessionHostLaunch } from "../../src/cold-wake/session-host-unit.ts"
import type { RunCommand } from "../../src/install.ts"

// omo#13594: install leaves the session host unit enabled and running, uninstall disables it, both are idempotent, and the
// device service is restarted only when its table changed (a restart drops every remote connection of the device). The
// fakes keep the state systemd, launchd and plutil would keep.

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const LAUNCH = SessionHostLaunch.from({ omoBin: "/opt/omo", execPath: "/opt/omo", agentDir: "/h/.omo/agent" })
const UNIT_DIR = (home: string) => join(home, ".config", "systemd", "user")
const DROP_IN = (home: string) => join(UNIT_DIR(home), "omo-relay-daemon.service.d", "50-omo-cold-wake.conf")

const ok = (output = "") => ({ exitCode: 0, output })

const OMO = "/usr/bin/env OMO_CODING_AGENT_DIR=/h/.omo/agent /opt/omo daemon"

/** `omo daemon status/stop` for the agent dir: one operator host, launched with or without the cold-start pin. */
function fakeOmoHost(pinned: boolean) {
  const state = { running: true, pinned }
  const answer = (argv: readonly string[]) => {
    if (argv.includes("status")) {
      const envKeys = ["HOME", "OMO_AGENT_DIR", ...(state.pinned ? ["SENPI_RPC_HOST_COLD_START"] : [])]
      const endpoint = { socket: "/h/.omo/agent/rpc/rpc.sock", reachable: state.running, pid: 7, env_keys: envKeys }
      return ok(JSON.stringify({ endpoints: state.running ? [endpoint] : [] }))
    }
    if (argv.includes("stop")) state.running = false
    return ok(JSON.stringify({ action: "drained" }))
  }
  return { state, answer }
}

/** systemctl --user over the files under `home`: the effective Environment is the drop-in's, quoted the way systemd shows it. */
function fakeSystemd(
  options: { readonly relayd?: boolean; readonly ownerTable?: string; readonly pinned?: boolean } = {},
) {
  const home = mkdtempSync(join(tmpdir(), "cwl-"))
  dirs.push(home)
  const runs: string[] = []
  const unit = { enabled: false, active: false }
  const omo = fakeOmoHost(options.pinned ?? true)
  const run: RunCommand = async (argv) => {
    runs.push(argv.join(" "))
    if (argv[0] === "/usr/bin/env") return omo.answer(argv)
    const verb = argv[2]
    if (argv.includes("UnitFileState"))
      return ok(
        `UnitFileState=${unit.enabled ? "enabled" : "disabled"}\nActiveState=${unit.active ? "active" : "inactive"}\n`,
      )
    if (argv.at(-1) === "omo-session-host.service") {
      if (verb === "enable") unit.enabled = true
      if (verb === "start" || verb === "restart") unit.active = true
      if (verb === "disable") Object.assign(unit, { enabled: false, active: false })
      return ok()
    }
    if (argv.includes("LoadState")) return ok(options.relayd === false ? "not-found\n" : "loaded\n")
    if (argv.includes("Environment")) {
      const dropIn = existsSync(DROP_IN(home)) ? readFileSync(DROP_IN(home), "utf8") : ""
      const quoted = /^Environment=(".*")$/m.exec(dropIn)?.[1]
      const owner =
        options.ownerTable === undefined ? [] : [JSON.stringify(`OMO_RELAYD_SERVICES=${options.ownerTable}`)]
      return ok(`${["LANG=C", ...owner, ...(quoted === undefined ? [] : [quoted])].join(" ")}\n`)
    }
    return ok()
  }
  const host: ColdWakeHost = { platform: "linux", home, uid: 1000, run, pause: async () => {} }
  return { host, home, runs, unit, omo }
}

const actions = (runs: readonly string[]) => runs.filter((r) => !r.includes(" show ") && !r.endsWith(" status --json"))

describe("cold wake on Linux", () => {
  test("installs, enables and starts the unit, adds the table entry and restarts the device service once", async () => {
    const { host, home, runs } = fakeSystemd()
    expect(await installColdWake(host, LAUNCH)).toEqual({ kind: "installed", serviceRestarted: true })
    expect(readFileSync(join(UNIT_DIR(home), "omo-session-host.service"), "utf8")).toContain('ExecStart="/opt/omo"')
    expect(readFileSync(DROP_IN(home), "utf8")).toBe(
      '[Service]\nEnvironment="OMO_RELAYD_SERVICES={\\"omo\\":{\\"systemd_user\\":\\"omo-session-host.service\\",\\"senders\\":[]}}"\n',
    )
    expect(runs.filter((r) => !r.includes(" show "))).toEqual([
      "systemctl --user daemon-reload",
      "systemctl --user restart omo-relay-daemon.service",
      "systemctl --user enable omo-session-host.service",
      "systemctl --user restart omo-session-host.service",
    ])
  })

  // systemd refuses a group- or world-writable unit; Windows has no POSIX modes (and no session host unit).
  test.skipIf(process.platform === "win32")("writes the unit 0644", async () => {
    const { host, home } = fakeSystemd()
    await installColdWake(host, LAUNCH)
    expect(statSync(join(UNIT_DIR(home), "omo-session-host.service")).mode & 0o777).toBe(0o644)
  })

  test("starts a unit that is not running without rewriting anything else", async () => {
    const { host, runs, unit } = fakeSystemd()
    await installColdWake(host, LAUNCH)
    unit.active = false
    runs.length = 0
    expect(await installColdWake(host, LAUNCH)).toEqual({ kind: "installed", serviceRestarted: false })
    expect(runs.filter((r) => !r.includes(" show "))).toEqual(["systemctl --user start omo-session-host.service"])
  })

  test("a second install with nothing changed writes nothing, reloads nothing and restarts nothing", async () => {
    const { host, runs } = fakeSystemd()
    await installColdWake(host, LAUNCH)
    runs.length = 0
    expect(await installColdWake(host, LAUNCH)).toEqual({ kind: "installed", serviceRestarted: false })
    expect(runs.filter((r) => !r.includes(" show "))).toEqual([])
  })

  test("merges the owner's table into the drop-in so its entries survive", async () => {
    const { host, home } = fakeSystemd({ ownerTable: '{"web":{"systemd_user":"web.service"}}' })
    await installColdWake(host, LAUNCH)
    const written = /^Environment="OMO_RELAYD_SERVICES=(.*)"$/m.exec(readFileSync(DROP_IN(home), "utf8"))?.[1] ?? ""
    expect(Object.keys(JSON.parse(written.replaceAll('\\"', '"')))).toEqual(["web", "omo"])
  })

  test("leaves an unreadable table alone and reports it, with the unit still installed", async () => {
    const { host, home, runs } = fakeSystemd({ ownerTable: "{broken" })
    const outcome = await installColdWake(host, LAUNCH)
    expect(outcome.kind).toBe("table_invalid")
    expect(existsSync(DROP_IN(home))).toBe(false)
    expect(existsSync(join(UNIT_DIR(home), "omo-session-host.service"))).toBe(true)
    expect(runs).not.toContain("systemctl --user restart omo-relay-daemon.service")
  })

  test("without a device service registration it installs the unit and says the service is not installed", async () => {
    const { host, home } = fakeSystemd({ relayd: false })
    expect(await installColdWake(host, LAUNCH)).toEqual({ kind: "service_not_installed" })
    expect(existsSync(DROP_IN(home))).toBe(false)
  })

  // omo#13595 review M1: the unit's host never idle-exits, so once the unit is gone nothing else would ever end it.
  test("uninstall disables the unit, drains the pinned host it started, and removes the unit and the entry", async () => {
    const { host, home, runs, unit, omo } = fakeSystemd()
    await installColdWake(host, LAUNCH)
    runs.length = 0
    expect(await uninstallColdWake(host, LAUNCH)).toEqual({ kind: "removed", serviceRestarted: true })
    expect(existsSync(join(UNIT_DIR(home), "omo-session-host.service"))).toBe(false)
    expect(existsSync(DROP_IN(home))).toBe(false)
    expect(unit).toEqual({ enabled: false, active: false })
    expect(omo.state.running).toBe(false)
    expect(actions(runs)).toEqual([
      "systemctl --user disable --now omo-session-host.service",
      `${OMO} stop --drain`,
      "systemctl --user daemon-reload",
      "systemctl --user restart omo-relay-daemon.service",
    ])
    runs.length = 0
    expect(await uninstallColdWake(host, LAUNCH)).toEqual({ kind: "removed", serviceRestarted: false })
    expect(actions(runs)).toEqual([])
  })

  // omo#13595 review M1 (second round): with remote sessions off, every omo start's bootstrap runs uninstall; with no
  // unit there it must neither ask for nor drain any host (a pinned host this device never had a unit for is not ours).
  test("uninstall with no unit installed asks for no host and drains none", async () => {
    const { host, runs, omo } = fakeSystemd()
    expect(await uninstallColdWake(host, LAUNCH)).toEqual({ kind: "removed", serviceRestarted: false })
    expect(omo.state.running).toBe(true)
    expect(runs.filter((r) => r.startsWith("/usr/bin/env"))).toEqual([])
  })

  test("a drain that fails keeps the unit file, so the next uninstall tries again", async () => {
    const { host, home, omo } = fakeSystemd()
    await installColdWake(host, LAUNCH)
    const failing: ColdWakeHost = {
      ...host,
      run: async (argv) =>
        argv.includes("stop") && argv[0] === "/usr/bin/env" ? { exitCode: 1, output: "busy\n" } : host.run(argv),
    }
    expect(await uninstallColdWake(failing, LAUNCH)).toEqual({ kind: "failed", step: "host_stop", detail: "busy" })
    expect(existsSync(join(UNIT_DIR(home), "omo-session-host.service"))).toBe(true)
    expect(await uninstallColdWake(host, LAUNCH)).toEqual({ kind: "removed", serviceRestarted: true })
    expect(omo.state.running).toBe(false)
  })

  test("uninstall leaves a host it did not pin to its own idle exit", async () => {
    const { host, runs, omo } = fakeSystemd({ pinned: false })
    await installColdWake(host, LAUNCH)
    runs.length = 0
    await uninstallColdWake(host, LAUNCH)
    expect(omo.state.running).toBe(true)
    expect(runs).not.toContain(`${OMO} stop --drain`)
  })

  test("a failed restart is reported with its step", async () => {
    const { host } = fakeSystemd()
    const failing: ColdWakeHost = {
      ...host,
      run: async (argv) => (argv.includes("restart") ? { exitCode: 1, output: "Failed to restart\n" } : host.run(argv)),
    }
    expect(await installColdWake(failing, LAUNCH)).toEqual({
      kind: "failed",
      step: "service_restart",
      detail: "Failed to restart",
    })
  })
})

const LABEL_PLIST = (home: string, label: string) => join(home, "Library", "LaunchAgents", `${label}.plist`)

/** launchctl and plutil over one in-memory table value; the relayd plist file only has to exist. */
function fakeLaunchd(options: { readonly bootstrapFailures?: number } = {}) {
  const home = mkdtempSync(join(tmpdir(), "cwd-"))
  dirs.push(home)
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

  test("a second install runs the loaded job's ensure again and checks the entry", async () => {
    const { host, runs, relayd } = fakeLaunchd()
    await installColdWake(host, LAUNCH)
    runs.length = 0
    expect(await installColdWake(host, LAUNCH)).toEqual({ kind: "installed", serviceRestarted: false })
    expect(runs).toEqual([
      "launchctl print gui/501/ai.omo.session-host",
      "launchctl kickstart gui/501/ai.omo.session-host",
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

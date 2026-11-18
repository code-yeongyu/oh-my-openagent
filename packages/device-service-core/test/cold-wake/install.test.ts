import { afterEach, describe, expect, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import { chmodSync, existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { type ColdWakeHost, installColdWake, uninstallColdWake } from "../../src/cold-wake/index.ts"
import {
  actions,
  DROP_IN,
  fakeLaunchd,
  fakeSystemd,
  LABEL_PLIST,
  LAUNCH,
  OMO,
  removeTempHomes,
  UNIT_DIR,
} from "./cold-wake-fakes.ts"

// omo#13594: install leaves the session host unit enabled and running, uninstall disables it, both are idempotent, and the
// device service is restarted only when its table changed (a restart drops every remote connection of the device). The
// fakes keep the state systemd, launchd and plutil would keep.

afterEach(removeTempHomes)

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

  // systemd refuses a group- or world-writable unit, and a 0600 one is unreadable to a manager running as another user;
  // Windows has no POSIX modes (and no session host unit). The install runs in a child that sets umask 077 itself, so
  // the mode cannot come from the runner's umask (omo#14247: a creation mode is ANDed with ~umask).
  test.skipIf(process.platform === "win32")("writes the unit 0644 even under umask 077", () => {
    const at = (file: string) => JSON.stringify(new URL(file, import.meta.url).pathname)
    const script = [
      "process.umask(0o077)",
      `const { installColdWake } = await import(${at("../../src/cold-wake/index.ts")})`,
      `const { fakeSystemd, LAUNCH, UNIT_DIR, removeTempHomes } = await import(${at("./cold-wake-fakes.ts")})`,
      'const { statSync } = await import("node:fs")',
      "const { host, home } = fakeSystemd()",
      "await installColdWake(host, LAUNCH)",
      'process.stdout.write((statSync(UNIT_DIR(home) + "/omo-session-host.service").mode & 0o777).toString(8))',
      "removeTempHomes()",
    ].join("\n")
    const child = Bun.spawnSync([process.execPath, "-e", script], { stderr: "pipe" })
    expect(child.stderr.toString()).toBe("")
    expect(child.exitCode).toBe(0)
    expect(child.stdout.toString()).toBe("644")
  })

  // A unit an older build wrote 0600 is repaired by the next install even though its text is unchanged (omo#14247).
  test.skipIf(process.platform === "win32")("repairs an unchanged unit left 0600", async () => {
    const { host, home, runs } = fakeSystemd()
    await installColdWake(host, LAUNCH)
    const unit = join(UNIT_DIR(home), "omo-session-host.service")
    chmodSync(unit, 0o600)
    runs.length = 0
    expect(await installColdWake(host, LAUNCH)).toEqual({ kind: "installed", serviceRestarted: false })
    expect(statSync(unit).mode & 0o777).toBe(0o644)
    expect(runs.filter((r) => !r.includes(" show "))).toEqual([])
  })

  // The repair is best effort: a unit this user cannot chmod (another owner's, a read-only filesystem) still installs.
  test.skipIf(process.platform === "win32")("installs an unchanged unit whose mode cannot be repaired", async () => {
    const { host, home } = fakeSystemd()
    await installColdWake(host, LAUNCH)
    chmodSync(join(UNIT_DIR(home), "omo-session-host.service"), 0o600)
    const denied = spyOn(fs, "chmodSync").mockImplementation(() => {
      throw Object.assign(new Error("EPERM: operation not permitted, chmod"), { code: "EPERM" })
    })
    try {
      expect(await installColdWake(host, LAUNCH)).toEqual({ kind: "installed", serviceRestarted: false })
    } finally {
      denied.mockRestore()
    }
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

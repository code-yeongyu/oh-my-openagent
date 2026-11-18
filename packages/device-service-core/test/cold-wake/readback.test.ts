import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type ColdWakeHost, readColdWake } from "../../src/cold-wake/index.ts"
import { SessionHostLaunch } from "../../src/cold-wake/session-host-unit.ts"
import type { RunCommand } from "../../src/install.ts"

// omo#13594: `omo remote status` reads both units back from the service manager itself (not from what omo last wrote),
// and whether the agent dir's host carries the pin. A unit between two runs of its ensure counts as running.

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const LAUNCH = SessionHostLaunch.from({ omoBin: "/opt/omo", execPath: "/opt/omo", agentDir: "/h/.omo/agent" })
const ENTRY_LINUX = JSON.stringify({ omo: { systemd_user: "omo-session-host.service", senders: [] } })
const ENTRY_DARWIN = JSON.stringify({ omo: { launchd: "ai.omo.session-host", senders: [] } })

const ok = (output = "") => ({ exitCode: 0, output })

// `fail`: `omo daemon status` itself failed (non-zero, unparseable), so whether a host runs is not known.
const hostStatus = (pinned: boolean | "fail" | undefined) =>
  pinned === undefined
    ? { exitCode: 3, output: "" }
    : pinned === "fail"
      ? { exitCode: 1, output: "garbage" }
      : ok(
          JSON.stringify({
            endpoints: [
              {
                socket: "/h/.omo/agent/rpc/rpc.sock",
                reachable: true,
                env_keys: pinned ? ["HOME", "SENPI_RPC_HOST_COLD_START"] : ["HOME"],
              },
            ],
          }),
        )

function linuxHost(answers: {
  readonly sessionHost: string
  readonly relayd: string
  readonly table?: string
  readonly pinned?: boolean | "fail"
}): ColdWakeHost {
  const run: RunCommand = async (argv) => {
    if (argv[0] === "/usr/bin/env") return hostStatus(answers.pinned)
    if (argv.includes("Environment"))
      return ok(
        answers.table === undefined ? "LANG=C\n" : `${JSON.stringify(`OMO_RELAYD_SERVICES=${answers.table}`)}\n`,
      )
    return ok(argv.includes("omo-session-host.service") ? answers.sessionHost : answers.relayd)
  }
  return { platform: "linux", home: "/h", uid: 1000, run, pause: async () => {} }
}

describe("reading back the units on Linux", () => {
  test("an enabled session host between runs, its pinned host, a running device service and the entry", async () => {
    const host = linuxHost({
      sessionHost: "LoadState=loaded\nActiveState=activating\nUnitFileState=enabled\n",
      relayd: "LoadState=loaded\nActiveState=active\n",
      table: ENTRY_LINUX,
      pinned: true,
    })
    expect(await readColdWake(host, LAUNCH)).toEqual({
      sessionHost: { unit: "omo-session-host.service", state: "running", enabled: true },
      pinnedHost: true,
      deviceService: { unit: "omo-relay-daemon.service", state: "running" },
      coldWakeEntry: true,
    })
  })

  // The unit is one ensure per start (oneshot), so between starts it reads inactive while the host it started runs.
  test("an enabled oneshot session host after its ensure ran, with its pinned host up, is running", async () => {
    const host = linuxHost({
      sessionHost: "LoadState=loaded\nActiveState=inactive\nUnitFileState=enabled\n",
      relayd: "LoadState=loaded\nActiveState=active\n",
      table: ENTRY_LINUX,
      pinned: true,
    })
    expect((await readColdWake(host, LAUNCH)).sessionHost).toEqual({
      unit: "omo-session-host.service",
      state: "running",
      enabled: true,
    })
  })

  // The ensure reuses a host another omo started (no pin): that host serves the agent dir, so the unit is running.
  test("an enabled oneshot session host whose ensure reused an unpinned host is running, not pinned", async () => {
    const host = linuxHost({
      sessionHost: "LoadState=loaded\nActiveState=inactive\nUnitFileState=enabled\n",
      relayd: "LoadState=loaded\nActiveState=active\n",
      table: ENTRY_LINUX,
      pinned: false,
    })
    const status = await readColdWake(host, LAUNCH)
    expect(status.sessionHost.state).toBe("running")
    expect(status.pinnedHost).toBe(false)
  })

  // #13669 review L1: a unit whose latest ensure failed is not reported running because a host happens to be up.
  test("a failed oneshot session host stays stopped even with a pinned host up", async () => {
    const host = linuxHost({
      sessionHost: "LoadState=loaded\nActiveState=failed\nUnitFileState=enabled\n",
      relayd: "LoadState=loaded\nActiveState=active\n",
      table: ENTRY_LINUX,
      pinned: true,
    })
    expect((await readColdWake(host, LAUNCH)).sessionHost.state).toBe("stopped")
  })

  // #13669 review M2: a failed host read says nothing about the host, so the unit between ensures is unknown.
  test("an enabled oneshot session host whose host cannot be read is unknown", async () => {
    const host = linuxHost({
      sessionHost: "LoadState=loaded\nActiveState=inactive\nUnitFileState=enabled\n",
      relayd: "LoadState=loaded\nActiveState=active\n",
      table: ENTRY_LINUX,
      pinned: "fail",
    })
    const status = await readColdWake(host, LAUNCH)
    expect(status.sessionHost.state).toBe("unknown")
    expect(status.pinnedHost).toBe("unknown")
  })

  test("an enabled oneshot session host with no host up is stopped", async () => {
    const host = linuxHost({
      sessionHost: "LoadState=loaded\nActiveState=inactive\nUnitFileState=enabled\n",
      relayd: "LoadState=loaded\nActiveState=active\n",
      table: ENTRY_LINUX,
    })
    expect((await readColdWake(host, LAUNCH)).sessionHost.state).toBe("stopped")
  })

  test("nothing installed: no unit, no host, no entry", async () => {
    const host = linuxHost({
      sessionHost: "LoadState=not-found\nActiveState=inactive\nUnitFileState=\n",
      relayd: "LoadState=not-found\nActiveState=inactive\n",
    })
    expect(await readColdWake(host, LAUNCH)).toEqual({
      sessionHost: { unit: "omo-session-host.service", state: "not_installed", enabled: false },
      pinnedHost: false,
      deviceService: { unit: "omo-relay-daemon.service", state: "not_installed" },
      coldWakeEntry: false,
    })
  })

  test("a host another omo started is not reported as pinned", async () => {
    const host = linuxHost({
      sessionHost: "LoadState=loaded\nActiveState=failed\nUnitFileState=disabled\n",
      relayd: "LoadState=loaded\nActiveState=active\n",
      table: ENTRY_LINUX,
      pinned: false,
    })
    expect(await readColdWake(host, LAUNCH)).toMatchObject({
      sessionHost: { state: "stopped", enabled: false },
      pinnedHost: false,
    })
  })
})

// Both LaunchAgents loaded; `printed` is what `launchctl print` says about the session host job.
function darwinHost(printed: string, pinned: boolean | "fail" | undefined): ColdWakeHost {
  const home = mkdtempSync(join(tmpdir(), "cwr-"))
  dirs.push(home)
  const agents = join(home, "Library", "LaunchAgents")
  mkdirSync(agents, { recursive: true })
  for (const label of ["ai.omo.session-host", "ai.omo.relay-daemon"])
    writeFileSync(join(agents, `${label}.plist`), "<plist/>")
  const run: RunCommand = async (argv) => {
    if (argv[0] === "/usr/bin/env") return hostStatus(pinned)
    if (argv[0] === "plutil") return ok(`${ENTRY_DARWIN}\n`)
    return ok(argv.at(-1)?.endsWith("relay-daemon") ? "\tstate = running\n" : printed)
  }
  return { platform: "darwin", home, uid: 501, run, pause: async () => {} }
}

const IDLE_JOB = "\tstate = not running\n\tlast exit code = 0\n"

describe("reading back the units on macOS", () => {
  // #13669: without KeepAlive a loaded job says nothing about the host; the host read decides between ensures.
  test.each([
    ["no host up", IDLE_JOB, undefined, "stopped"],
    ["an unpinned host its ensure reused", IDLE_JOB, false, "running"],
    ["a host that cannot be read", IDLE_JOB, "fail", "unknown"],
    ["its ensure still running, no host yet", "\tstate = running\n", undefined, "running"],
    ["a last ensure that failed, with a host up", "\tstate = not running\n\tlast exit code = 1\n", true, "stopped"],
  ] as const)("a loaded LaunchAgent with %s reads %s", async (_case, printed, pinned, state) => {
    const status = await readColdWake(darwinHost(printed, pinned), LAUNCH)
    expect(status.sessionHost).toEqual({ unit: "ai.omo.session-host", state, enabled: true })
  })

  test("a loaded LaunchAgent with its pinned host up is running and enabled, and the plist entry is read", async () => {
    expect(await readColdWake(darwinHost(IDLE_JOB, true), LAUNCH)).toEqual({
      sessionHost: { unit: "ai.omo.session-host", state: "running", enabled: true },
      pinnedHost: true,
      deviceService: { unit: "ai.omo.relay-daemon", state: "running" },
      coldWakeEntry: true,
    })
  })
})

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

const hostStatus = (pinned: boolean | undefined) =>
  pinned === undefined
    ? { exitCode: 3, output: "" }
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
  readonly pinned?: boolean
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

describe("reading back the units on macOS", () => {
  test("a loaded LaunchAgent counts as running and enabled, and the plist entry is read", async () => {
    const home = mkdtempSync(join(tmpdir(), "cwr-"))
    dirs.push(home)
    const agents = join(home, "Library", "LaunchAgents")
    mkdirSync(agents, { recursive: true })
    for (const label of ["ai.omo.session-host", "ai.omo.relay-daemon"])
      writeFileSync(join(agents, `${label}.plist`), "<plist/>")
    const run: RunCommand = async (argv) => {
      if (argv[0] === "/usr/bin/env") return hostStatus(true)
      if (argv[0] === "plutil") return ok(`${ENTRY_DARWIN}\n`)
      return ok(argv.at(-1)?.endsWith("relay-daemon") ? "\tstate = running\n" : "\tstate = spawn scheduled\n")
    }
    expect(await readColdWake({ platform: "darwin", home, uid: 501, run, pause: async () => {} }, LAUNCH)).toEqual({
      sessionHost: { unit: "ai.omo.session-host", state: "running", enabled: true },
      pinnedHost: true,
      deviceService: { unit: "ai.omo.relay-daemon", state: "running" },
      coldWakeEntry: true,
    })
  })
})

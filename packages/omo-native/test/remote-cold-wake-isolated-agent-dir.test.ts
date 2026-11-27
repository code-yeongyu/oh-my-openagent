import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { olderRuntime } from "../release-version"
import { refreshColdWakeAtLaunch } from "../remote-cold-wake"

// omo#15029: a launch refreshes only the session host unit that serves ITS OWN agent directory. A launch with an
// isolated agent directory (a test or QA run beside the device's shared host) must neither rewrite the device-wide unit
// nor call the service manager. The unit lives under a scratch home, and `systemctl` is a stand-in on PATH that only
// records its argv: no real unit and no real service call is ever touched.

const scratch: string[] = []
let savedPath: string | undefined

const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(dir)
  return dir
}

beforeEach(() => {
  savedPath = process.env.PATH
})

afterEach(() => {
  process.env.PATH = savedPath
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A `systemctl` that records every call and answers as an enabled user unit would. */
const serviceManagerStandIn = (): { calls: () => string[] } => {
  const bin = tempDir("cwi-bin-")
  const log = join(bin, "calls.log")
  const script = join(bin, "systemctl")
  writeFileSync(
    script,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\ncase "$*" in *UnitFileState*) echo UnitFileState=enabled;; esac\nexit 0\n`,
  )
  chmodSync(script, 0o755)
  process.env.PATH = `${bin}:${savedPath ?? ""}`
  return { calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []) }
}

const installedUnit = (version: string): { home: string; unit: string; agentDir: string } => {
  const home = tempDir("cwi-home-")
  const agentDir = join(home, ".omo", "agent")
  const unit = join(home, ".config", "systemd", "user", "omo-session-host.service")
  mkdirSync(join(unit, ".."), { recursive: true })
  writeFileSync(
    unit,
    `[Service]\nType=simple\nExecStart="${home}/.omo/binary-runtime/${version}/omo" "daemon" "run" "--pinned"\nEnvironment="OMO_CODING_AGENT_DIR=${agentDir}"\nRestart=always\n`,
  )
  return { home, unit, agentDir }
}

const launch = async (home: string, version: string, agentDir: string): Promise<string[]> => {
  const lines: string[] = []
  await refreshColdWakeAtLaunch(
    {
      runtime: join(home, ".omo", "binary-runtime", version, "omo"),
      isOlder: (installed) => olderRuntime(installed, version),
      platform: "linux",
      home,
      agentDir,
    },
    (line) => lines.push(line),
  )
  return lines
}

describe.skipIf(process.platform !== "linux")("a launch refreshes only its own agent directory's unit (#15029)", () => {
  test("a newer launch for the unit's own agent directory still refreshes it", async () => {
    const manager = serviceManagerStandIn()
    const { home, unit, agentDir } = installedUnit("5.1.75")

    expect(await launch(home, "5.1.77", agentDir)).toEqual([])

    expect(readFileSync(unit, "utf8")).toContain(`${home}/.omo/binary-runtime/5.1.77/omo`)
    expect(manager.calls()).toContain("--user daemon-reload")
  })

  test("a newer launch with an isolated agent directory writes no unit and makes no service call", async () => {
    const manager = serviceManagerStandIn()
    const { home, unit } = installedUnit("5.1.75")
    const before = readFileSync(unit, "utf8")
    const isolated = join(tempDir("cwi-qa-"), "agent")

    expect(await launch(home, "5.1.77", isolated)).toEqual([])

    expect(readFileSync(unit, "utf8")).toBe(before)
    expect(manager.calls()).toEqual([])
  })

  test("an older launch for the unit's own agent directory never downgrades it", async () => {
    const manager = serviceManagerStandIn()
    const { home, unit, agentDir } = installedUnit("5.1.80")
    const before = readFileSync(unit, "utf8")

    expect(await launch(home, "5.1.77", agentDir)).toEqual([])

    expect(readFileSync(unit, "utf8")).toBe(before)
    expect(manager.calls()).toEqual([])
  })

  test("a same-version launch for the unit's own agent directory leaves it byte-identical", async () => {
    const manager = serviceManagerStandIn()
    const { home, unit, agentDir } = installedUnit("5.1.77")
    const before = readFileSync(unit, "utf8")

    expect(await launch(home, "5.1.77", agentDir)).toEqual([])

    expect(readFileSync(unit, "utf8")).toBe(before)
    expect(manager.calls()).toEqual([])
  })
})

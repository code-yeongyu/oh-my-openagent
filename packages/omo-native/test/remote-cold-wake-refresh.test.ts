import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { olderRuntime, runtimeGate } from "../release-version"
import { refreshColdWakeAtLaunch } from "../remote-cold-wake"

// omo#14191 / #14194 review L1: the launch-time wrapper's own contract. Its version gate decides which installed unit a
// launch may touch, and every path that is not a refresh returns before any service manager call; a unit it cannot
// rebuild costs the launch one stderr line, never a throw.

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const homeWithUnit = (version: string, agentDir: string): { home: string; unit: string } => {
  const home = mkdtempSync(join(tmpdir(), "cwr-"))
  homes.push(home)
  const unit = join(home, ".config", "systemd", "user", "omo-session-host.service")
  mkdirSync(join(unit, ".."), { recursive: true })
  writeFileSync(
    unit,
    `[Service]\nType=simple\nExecStart="${home}/.omo/binary-runtime/${version}/omo" "daemon" "run" "--pinned"\nEnvironment="OMO_CODING_AGENT_DIR=${agentDir}"\nRestart=always\n`,
  )
  return { home, unit }
}

const refreshAt = async (home: string, version: string) => {
  const lines: string[] = []
  await refreshColdWakeAtLaunch(
    {
      runtime: join(home, ".omo", "binary-runtime", version, "omo"),
      isOlder: (installed) => olderRuntime(installed, version),
      platform: "linux",
      home,
    },
    (line) => lines.push(line),
  )
  return lines
}

describe("the launch-time version gate", () => {
  test.each([
    ["5.1.75", "5.1.77", true],
    ["5.1.77", "5.1.77", false],
    ["5.1.80", "5.1.77", false],
    ["0.0.0-a", "0.0.0-omob.a6f2cef.807b0ac", true],
    ["dev", "5.1.77", false],
    ["5.1.75", "dev", false],
  ])("%s installed under a %s launch is older: %p", (installed, version, older) => {
    expect(olderRuntime(installed, version)).toBe(older)
  })

  // #14194 delta review L1: a non-release launch (`dev`, a local build) gets no gate, so the launch never refreshes and
  // never even reads the unit file; a release launch gets the older-runtime predicate for its own version.
  test("a non-release launch gets no gate; a release launch gets its own older-runtime predicate", () => {
    expect(runtimeGate("dev")).toBeUndefined()
    expect(runtimeGate("")).toBeUndefined()
    expect(["5.1.75", "5.1.77", "5.1.80"].map((installed) => runtimeGate("5.1.77")?.(installed))).toEqual([
      true,
      false,
      false,
    ])
  })
})

describe.skipIf(process.platform === "win32")("refreshing at launch", () => {
  test("a same-version unit and a non-release launch leave the unit as it is and say nothing", async () => {
    const { home, unit } = homeWithUnit("5.1.77", "/srv/profile-b/agent")
    const before = readFileSync(unit, "utf8")
    expect(await refreshAt(home, "5.1.77")).toEqual([])
    expect(await refreshAt(home, "dev")).toEqual([])
    expect(readFileSync(unit, "utf8")).toBe(before)
  })

  test("no installed unit: nothing is written and nothing is said", async () => {
    const home = mkdtempSync(join(tmpdir(), "cwr-"))
    homes.push(home)
    expect(await refreshAt(home, "5.1.77")).toEqual([])
  })

  test("an older unit that cannot be rebuilt costs the launch one stderr line and keeps its text", async () => {
    const { home, unit } = homeWithUnit("5.1.75", "relative/agent")
    const before = readFileSync(unit, "utf8")
    const lines = await refreshAt(home, "5.1.77")
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("unit")
    expect(readFileSync(unit, "utf8")).toBe(before)
  })
})

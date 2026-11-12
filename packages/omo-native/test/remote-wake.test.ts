import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { connectDeviceService } from "../../device-service-core/src/index.ts"
import { startFakeOwner, type FakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld } from "../../device-service-core/test/local-api/conformance/world.ts"
import { REMOTE_EXIT, runRemoteVerb } from "../remote-cli"

// omo#13037 A7.2.5: `omo remote wake [on|off|default]` reads and sets the device service's wake switch. It is gated on
// welcome.service_version of the connection the verb itself opens (never a capability word); below the gate, or while
// the gate constant is unset, it sends nothing and names the wake.

const owners: FakeOwner[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const owner of owners.splice(0)) await owner.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const GATE = "1.4.0"

async function owner(serviceVersion = GATE, overridden = false): Promise<FakeOwner> {
  const dir = mkdtempSync(join(tmpdir(), "rwake-"))
  chmodSync(dir, 0o700)
  dirs.push(dir)
  const world = defaultWorld()
  const started = await startFakeOwner({
    stateDir: dir,
    world: { ...world, service_version: serviceVersion, wake_overridden: overridden },
  })
  owners.push(started)
  return started
}

async function wake(args: readonly string[], stateDir: string, wakeMark: string | null = GATE) {
  const out: string[] = []
  const err: string[] = []
  const code = await runRemoteVerb(
    {
      accountShow: async () => ({ exitCode: 0, stdout: JSON.stringify({ signedIn: true }) }),
      stateDir,
      connect: () => connectDeviceService({ version: "5.1.70", stateDir, minimums: { wakeMark, singleLocate: null } }),
      now: () => 1_790_000_400_000,
      output: (line) => out.push(line),
      write: () => {},
      error: (line) => err.push(line),
    } as Parameters<typeof runRemoteVerb>[0],
    ["wake", ...args],
  )
  return { code, out, err }
}

const stored = (owner: FakeOwner) => owner.state.sessionWake
const sent = (owner: FakeOwner) => owner.state.log.filter((type) => type.startsWith("control.session_wake")).length

describe("omo remote wake", () => {
  test("#given a service at the gate #when read with no value #then it prints the effective and the stored value", async () => {
    const svc = await owner()
    const read = await wake(["--json"], svc.stateDir)
    expect(read.code).toBe(REMOTE_EXIT.ok)
    expect(JSON.parse(read.out[0] ?? "{}")).toMatchObject({ enabled: false, stored: null, overridden: false })
    expect((await wake([], svc.stateDir)).out.length).toBeGreaterThan(0)
  })

  test.each([
    ["on", true],
    ["off", false],
    ["default", null],
  ] as const)("#given a service at the gate #when set %s #then the service stores %p", async (value, expected) => {
    const svc = await owner()
    const set = await wake([value, "--json"], svc.stateDir)
    expect(set.code).toBe(REMOTE_EXIT.ok)
    expect(stored(svc).stored).toBe(expected)
    expect(JSON.parse(set.out[0] ?? "{}")).toMatchObject({ stored: expected })
  })

  test("#given a run of the service that cannot list the feature #when read #then it says so", async () => {
    const svc = await owner(GATE, true)
    const read = await wake(["--json"], svc.stateDir)
    expect(JSON.parse(read.out[0] ?? "{}")).toMatchObject({ overridden: true })
  })

  test.each([
    ["the gate constant is unset", GATE, null],
    ["the service is older than the gate", "1.3.9", GATE],
  ] as const)("#given %s #when set on #then nothing is sent and the line names the wake", async (_case, version, gate) => {
    const svc = await owner(version)
    const set = await wake(["on"], svc.stateDir, gate)
    expect(set.code).toBe(REMOTE_EXIT.unavailable)
    expect(set.err.join("\n")).toMatch(/wake/i)
    expect(sent(svc)).toBe(0)
  })

  test("#given a set through a service at the gate, then a reconnect to an older one #when set again #then the second run sends nothing", async () => {
    const current = await owner()
    expect((await wake(["on"], current.stateDir)).code).toBe(REMOTE_EXIT.ok)
    const older = await owner("1.3.9")
    const again = await wake(["off"], older.stateDir)
    expect(again.code).toBe(REMOTE_EXIT.unavailable)
    expect(sent(older)).toBe(0)
  })

  test("#given an unknown value #then it is a usage error naming the values", async () => {
    const svc = await owner()
    const bad = await wake(["maybe"], svc.stateDir)
    expect(bad.code).toBe(REMOTE_EXIT.usage)
    expect(sent(svc)).toBe(0)
  })
})

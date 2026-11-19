import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { connectDeviceService } from "../../device-service-core/src/index.ts"
import { startFakeOwner, type FakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld, type World } from "../../device-service-core/test/local-api/conformance/world.ts"
import { createRemoteThreadFixture } from "../../omo-senpi/src/components/thread/thread-remote-fixture"
import { REMOTE_EXIT, runRemoteVerb } from "../remote-cli"

// #13432: the session verbs take a device the way the device table prints it - its id, its NAME (compared as thread
// names are), or a unique id prefix - through thread_create's one device resolver (thread/remote/plan-create.ts).
// #14305: `sessions --device` takes the same spellings, through the shared address module.

const SIGNED_IN = {
  exitCode: 0,
  stdout: JSON.stringify({ signedIn: true, device: { id: "dev-self", name: "This Mac" }, refreshState: "ok" }),
}
const fixture = createRemoteThreadFixture()
const dirs: string[] = []
const owners: FakeOwner[] = []
afterEach(async () => {
  fixture.cleanup()
  for (const owner of owners.splice(0)) await owner.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function run(args: readonly string[], world: World = defaultWorld()) {
  const a = fixture.account()
  const stateDir = mkdtempSync(join(tmpdir(), "omo-13432-owner-"))
  chmodSync(stateDir, 0o700)
  dirs.push(stateDir)
  const owner = await startFakeOwner({ stateDir, world })
  owners.push(owner)
  const err: string[] = []
  const out: string[] = []
  const code = await runRemoteVerb(
    {
      accountShow: async () => SIGNED_IN,
      stateDir: owner.stateDir,
      connect: () => connectDeviceService({ version: "5.1.52", stateDir: owner.stateDir }),
      now: () => 0,
      output: (line) => out.push(line),
      write: () => {},
      error: (line) => err.push(line),
      bootstrap: {
        pinVersion: "1.4.0",
        install: async () => ({ ok: false, state: "service_degraded", action: "none" }),
        refresher: { binaryPath: "/x", version: "0" },
        agentDir: "/x",
      },
      coldWake: {
        install: async () => ({ kind: "installed", serviceRestarted: false }),
        uninstall: async () => ({ kind: "removed", serviceRestarted: false }),
        status: async () => undefined,
      },
      linkDevice: async () => "linked",
      optOut: { read: () => false, record: () => {}, clear: () => {} },
      remote: () => a.remote,
      localPermissionPreset: () => "workspace",
    },
    args,
  )
  const opened = a.sent.filter((entry) => entry.rpc?.["type"] === "open_session").map((entry) => entry.device)
  return { code, err, out, opened, sent: a.sent }
}

describe("omo remote session verbs take the device the table prints", () => {
  test("#given the NAME column's value #when open runs #then the session opens on that device", async () => {
    expect(await run(["open", "studio"])).toMatchObject({ code: REMOTE_EXIT.ok, opened: ["b"] })
  })

  test("#given the name in another case #when open runs #then it opens on that device", async () => {
    expect(await run(["open", "Studio"])).toMatchObject({ code: REMOTE_EXIT.ok, opened: ["b"] })
  })

  test("#given the device id #when open runs #then it still opens there", async () => {
    expect(await run(["open", "b"])).toMatchObject({ code: REMOTE_EXIT.ok, opened: ["b"] })
  })

  test("#given a name/session address #when close runs #then the close reaches the session on that device", async () => {
    const result = await run(["close", "studio/rk-on-b", "--json"])
    expect(result.sent.filter((entry) => entry.device === "b" && entry.session === "rk-on-b").length).toBeGreaterThan(0)
    expect(result.sent.filter((entry) => entry.device === "studio")).toEqual([])
  })

  test("#given a name/session address #when close runs #then the output names the device by its id", async () => {
    const result = await run(["close", "studio/dur-on-b"])
    expect(result.code).toBe(REMOTE_EXIT.ok)
    expect(result.out).toEqual(["Closed b/dur-on-b."])
  })

  test("#given a device no row matches #when open runs #then it fails with not_found and opens nothing", async () => {
    const result = await run(["open", "nowhere", "--json"])
    expect(result.code).toBe(REMOTE_EXIT.failed)
    expect(result.opened).toEqual([])
    expect(JSON.parse(result.out[0] ?? "{}")).toMatchObject({ kind: "error", error: { code: "not_found" } })
  })
})

describe("omo remote sessions takes the device the table prints (#14305)", () => {
  test("#given the NAME column's value in another case #when sessions --device runs #then it lists that device's rows", async () => {
    const result = await run(["sessions", "--device", "studio", "--json"])
    expect(result.code).toBe(REMOTE_EXIT.ok)
    const listing = JSON.parse(result.out.join("")) as { rows: { device: { id: string } }[] }
    expect(listing.rows.length).toBeGreaterThan(0)
    expect(new Set(listing.rows.map((row) => row.device.id))).toEqual(new Set(["dev-peer-1"]))
  })

  test("#given two online devices sharing a name #when sessions --device names it #then it lists nothing and the refusal names both devices", async () => {
    const world = defaultWorld()
    const twin = {
      device: "dev-peer-3",
      label: "Studio",
      kind: "desktop" as const,
      platform: "linux" as const,
      last_seen_ms: 1_790_000_000_000,
      online: true,
    }
    const result = await run(["sessions", "--device", "Studio", "--json"], { ...world, devices: [...world.devices, twin] })
    // The exit the CLI unit pins for a typed ambiguous answer (remote-cli.test.ts): failed, with the answer on stdout.
    expect(result.code).toBe(REMOTE_EXIT.failed)
    const answer = JSON.parse(result.out.join("")) as {
      code: string
      rows?: unknown
      details: { candidates: { device: string }[] }
    }
    expect(answer.code).toBe("ambiguous_target")
    expect(answer.rows).toBeUndefined()
    expect(answer.details.candidates.map((candidate) => candidate.device).sort()).toEqual(["dev-peer-1", "dev-peer-3"])
  })
})

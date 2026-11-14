import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { connectDeviceService } from "../../device-service-core/src/index.ts"
import { startFakeOwner, type FakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld } from "../../device-service-core/test/local-api/conformance/world.ts"
import { createRemoteThreadFixture } from "../../omo-senpi/src/components/thread/thread-remote-fixture"
import { REMOTE_EXIT, runRemoteVerb } from "../remote-cli"

// #13432: the session verbs take a device the way the device table prints it - its id, its NAME, or a unique prefix of
// either - through the one device resolver the thread tools use; a name two devices share is ambiguous_device.

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

async function run(args: readonly string[]) {
  const a = fixture.account()
  const stateDir = mkdtempSync(join(tmpdir(), "omo-13432-owner-"))
  chmodSync(stateDir, 0o700)
  dirs.push(stateDir)
  const owner = await startFakeOwner({ stateDir, world: defaultWorld() })
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

  test("#given a unique prefix of the name #when open runs #then it opens on that device", async () => {
    expect(await run(["open", "stu"])).toMatchObject({ code: REMOTE_EXIT.ok, opened: ["b"] })
  })

  test("#given the device id #when open runs #then it still opens there", async () => {
    expect(await run(["open", "b"])).toMatchObject({ code: REMOTE_EXIT.ok, opened: ["b"] })
  })

  test("#given a name/session address #when close runs #then the close reaches the session on that device", async () => {
    const result = await run(["close", "studio/s1", "--json"])
    expect(result.sent.filter((entry) => entry.device === "b" && entry.session === "s1").length).toBeGreaterThan(0)
    expect(result.sent.filter((entry) => entry.device === "studio")).toEqual([])
  })

  test("#given a device no row matches #when open runs #then it fails with device_unknown and opens nothing", async () => {
    const result = await run(["open", "nowhere", "--json"])
    expect(result.code).toBe(REMOTE_EXIT.failed)
    expect(result.opened).toEqual([])
    expect(JSON.parse(result.out[0] ?? "{}")).toMatchObject({ kind: "error", error: { code: "device_unknown" } })
  })
})

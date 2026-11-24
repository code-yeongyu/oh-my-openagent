import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { closeClients, type FakeClock, fakeClock, startModeOwner, startOwner } from "../remote/testing/fake-service"
import { createOmoSdk, type OmoResult, type OmoSdk } from "."

// devices.list is the remote module's devices.list (omo#13413, one listing path): the omo SDK builds a session client
// through the remote barrel against this machine's device service and answers the rows in its own LiveDevice shape.
// Every run uses the device-service conformance owner in a temp state dir; no real device service is reached.

const sdks: OmoSdk[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const sdk of sdks.splice(0)) sdk.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  await closeClients()
})

const sdkOn = (stateDir: string, clock: FakeClock = fakeClock()): OmoSdk => {
  const sdk = createOmoSdk({
    env: { OMO_DEVICE_SERVICE_STATE_DIR: stateDir },
    cwd: tmpdir(),
    // A credential store that would answer signed_out: the listing must not read the account sign-in at all.
    ports: { desktopLaunch: () => false, credentialStore: { read: async () => null }, remoteTimers: clock },
  })
  sdks.push(sdk)
  return sdk
}

const errorOf = <T>(result: OmoResult<T>) => {
  if (result.kind !== "error") throw new Error(`expected an error, got ${JSON.stringify(result)}`)
  return result.error
}

describe("omo SDK devices.list through the remote module", () => {
  test("#given a connected device service #when devices.list runs #then this device is current and each peer keeps its kind, platform and last seen time", async () => {
    const owner = await startOwner()
    const clock = fakeClock()

    const result = await sdkOn(owner.stateDir, clock).devices.list()

    expect(result).toEqual({
      kind: "ok",
      value: [
        {
          id: "dev-self",
          name: "This Mac",
          platform: process.platform,
          lastSeenAt: new Date(clock.now()).toISOString(),
          current: true,
        },
        {
          id: "dev-peer-1",
          name: "Studio",
          kind: "desktop",
          platform: "darwin",
          lastSeenAt: new Date(1_790_000_000_000).toISOString(),
          current: false,
        },
        {
          id: "dev-peer-2",
          name: "Laptop",
          kind: "cli",
          platform: "linux",
          lastSeenAt: new Date(1_789_000_000_000).toISOString(),
          current: false,
        },
      ],
    })
    expect([...owner.state.conns].map((conn) => conn.client()?.name)).toEqual(["omo"])
  })

  test("#given no device service on this machine #when devices.list runs #then it answers device_service_unavailable, never a made-up local device", async () => {
    const empty = mkdtempSync(join(tmpdir(), "omo-sdk-no-service-"))
    dirs.push(empty)

    expect(errorOf(await sdkOn(empty).devices.list())).toMatchObject({
      code: "device_service_unavailable",
      details: { code: "not_installed" },
    })
  })

  test("#given a device service that never completes its handshake #when the deadline passes #then the module's failure maps to device_service_unavailable with its code", async () => {
    const { owner, withheld } = await startModeOwner("silent-handshake")
    const clock = fakeClock()
    const listing = sdkOn(owner.stateDir, clock).devices.list()
    await withheld("welcome")

    clock.advance(60_000)

    const error = errorOf(await listing)

    expect(error.code).toBe("device_service_unavailable")
    expect(error.details).toMatchObject({ code: "host_unavailable" })
  })

  test("#given a closed SDK #when devices.list runs #then it answers internal_error and opens no connection", async () => {
    const owner = await startOwner()
    const sdk = sdkOn(owner.stateDir)
    sdk.close()

    expect(errorOf(await sdk.devices.list()).code).toBe("internal_error")
    expect(owner.state.conns.size).toBe(0)
  })
})

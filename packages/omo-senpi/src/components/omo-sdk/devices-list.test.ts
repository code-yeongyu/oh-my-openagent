import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Credentials } from "@oh-my-opencode/omo-opencode/service-auth"
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

const SIGNED_IN: Credentials = {
  accessToken: "access-token-fixture",
  accessTokenExpiresAt: "2026-11-19T15:00:00.000Z",
  refreshToken: "refresh-token-fixture",
  device: { id: "dev-self", name: "This Mac" },
  signingPrivateKey: "signing-key-fixture",
  sealingPrivateKey: "sealing-key-fixture",
}

// By default a credential store that would answer signed_out: a listing the device service answers never reads the
// account sign-in. Only a listing with no device service asks it, to tell a signed-out device from a missing service.
const sdkOn = (stateDir: string, clock: FakeClock = fakeClock(), stored: Credentials | null = null): OmoSdk => {
  const sdk = createOmoSdk({
    env: { OMO_DEVICE_SERVICE_STATE_DIR: stateDir },
    cwd: tmpdir(),
    ports: { desktopLaunch: () => false, credentialStore: { read: async () => stored }, remoteTimers: clock },
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

  test("#given no device service on a signed-in device #when devices.list runs #then it answers device_service_unavailable, never a made-up local device", async () => {
    const empty = mkdtempSync(join(tmpdir(), "omo-sdk-no-service-"))
    dirs.push(empty)

    expect(errorOf(await sdkOn(empty, fakeClock(), SIGNED_IN).devices.list())).toMatchObject({
      code: "device_service_unavailable",
      details: { code: "not_installed" },
    })
  })

  test("#given no device service on a device that is not signed in #when devices.list runs #then it answers signed_out, the reason no service runs", async () => {
    const empty = mkdtempSync(join(tmpdir(), "omo-sdk-no-service-"))
    dirs.push(empty)

    expect(errorOf(await sdkOn(empty).devices.list()).code).toBe("signed_out")
  })

  test("#given a device service that never completes its handshake #when the deadline passes #then the module's failure maps to device_service_unavailable with its code", async () => {
    const { owner, withheld } = await startModeOwner("silent-handshake")
    const clock = fakeClock()
    const listing = sdkOn(owner.stateDir, clock, SIGNED_IN).devices.list()
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

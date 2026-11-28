import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type Credentials, KeychainLockedError } from "@oh-my-opencode/omo-opencode/service-auth"
import { closeClients, type FakeClock, fakeClock, startModeOwner, startOwner } from "../remote/testing/fake-service"
import { deviceServiceStateDir } from "@oh-my-opencode/device-service-core/state-dir"
import { createOmoSdk, type OmoErrorCode, type OmoResult, type OmoSdk } from "."

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

type Account = { readonly read: () => Promise<Credentials | null>; readonly desktopLaunch: boolean }
const SIGNED_IN_ACCOUNT: Account = { read: async () => SIGNED_IN, desktopLaunch: false }

// By default a signed-in device: devices.list keeps the account precondition it always had (closed, desktop launch,
// signed out, credential store) before it opens any device-service connection.
const sdkOn = (stateDir: string, clock: FakeClock = fakeClock(), account: Account = SIGNED_IN_ACCOUNT): OmoSdk => {
  const sdk = createOmoSdk({
    env: { OMO_DEVICE_SERVICE_STATE_DIR: stateDir },
    cwd: tmpdir(),
    ports: {
      desktopLaunch: () => account.desktopLaunch,
      credentialStore: { read: account.read },
      remoteTimers: clock,
    },
  })
  sdks.push(sdk)
  return sdk
}

// The service's own dir under a temp home, created as the service creates it (private), so a fake owner can listen there.
const serviceDirUnder = (env: Readonly<Record<string, string>>, home: string): string => {
  const dir = deviceServiceStateDir(process.platform, env, home)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
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

    expect(errorOf(await sdkOn(empty).devices.list())).toMatchObject({
      code: "device_service_unavailable",
      details: { code: "not_installed" },
    })
  })

  const refusals: ReadonlyArray<readonly [string, Account, OmoErrorCode]> = [
    ["a device that is not signed in", { read: async () => null, desktopLaunch: false }, "signed_out"],
    ["a desktop launch", { read: async () => SIGNED_IN, desktopLaunch: true }, "desktop_sign_in"],
    [
      "a locked credential store",
      {
        read: async () => {
          throw new KeychainLockedError("locked")
        },
        desktopLaunch: false,
      },
      "credential_store_locked",
    ],
  ]
  test.each(refusals)(
    "#given %s and a running device service #when devices.list runs #then it answers the account's refusal and opens no connection",
    async (_given, account, code) => {
      const owner = await startOwner()

      const error = errorOf(await sdkOn(owner.stateDir, fakeClock(), account).devices.list())

      expect(error.code).toBe(code)
      expect(error.next_action).not.toBe("")
      expect(owner.state.conns.size).toBe(0)
    },
  )

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

  // A root built with an environment reaches the device service that environment names, never the process's own home:
  // a sandbox env (a test, a script) must not reach the machine's real device service (credential safety).
  test("#given an env whose home is a temp home and no home option #when devices.list runs #then the service under that home answers", async () => {
    const home = mkdtempSync(join(tmpdir(), "omo-sdk-env-home-"))
    dirs.push(home)
    const env = { HOME: home, USERPROFILE: home }
    const owner = await startOwner(undefined, serviceDirUnder(env, home))
    const sdk = createOmoSdk({
      env,
      cwd: tmpdir(),
      ports: {
        desktopLaunch: () => false,
        credentialStore: { read: SIGNED_IN_ACCOUNT.read },
        remoteTimers: fakeClock(),
      },
    })
    sdks.push(sdk)

    const result = await sdk.devices.list()

    expect(result.kind).toBe("ok")
    expect([...owner.state.conns].map((conn) => conn.client()?.name)).toEqual(["omo"])
  })

  test("#given a state dir in the process env and a root given its own env without one #when devices.list runs #then the process's state dir does not leak in", async () => {
    const home = mkdtempSync(join(tmpdir(), "omo-sdk-env-home-"))
    const leaked = mkdtempSync(join(tmpdir(), "omo-sdk-process-state-"))
    dirs.push(home, leaked)
    const env = { HOME: home, USERPROFILE: home }
    const own = await startOwner(undefined, serviceDirUnder(env, home))
    const other = await startOwner(undefined, leaked)
    const before = process.env["OMO_DEVICE_SERVICE_STATE_DIR"]
    process.env["OMO_DEVICE_SERVICE_STATE_DIR"] = leaked
    try {
      const sdk = createOmoSdk({
        env,
        cwd: tmpdir(),
        ports: {
          desktopLaunch: () => false,
          credentialStore: { read: SIGNED_IN_ACCOUNT.read },
          remoteTimers: fakeClock(),
        },
      })
      sdks.push(sdk)

      expect((await sdk.devices.list()).kind).toBe("ok")
      expect(own.state.conns.size).toBe(1)
      expect(other.state.conns.size).toBe(0)
    } finally {
      if (before === undefined) delete process.env["OMO_DEVICE_SERVICE_STATE_DIR"]
      else process.env["OMO_DEVICE_SERVICE_STATE_DIR"] = before
    }
  })

  test("#given an env that names no home and no state dir #when devices.list runs #then it refuses instead of reaching the process's own home", async () => {
    const sdk = createOmoSdk({
      env: { PATH: "/usr/bin" },
      cwd: tmpdir(),
      ports: {
        desktopLaunch: () => false,
        credentialStore: { read: SIGNED_IN_ACCOUNT.read },
        remoteTimers: fakeClock(),
      },
    })
    sdks.push(sdk)

    expect(errorOf(await sdk.devices.list())).toMatchObject({
      code: "device_service_unavailable",
      details: { code: "no_home" },
    })
  })

  test("#given a closed SDK #when devices.list runs #then it answers internal_error and opens no connection", async () => {
    const owner = await startOwner()
    const sdk = sdkOn(owner.stateDir)
    sdk.close()

    expect(errorOf(await sdk.devices.list()).code).toBe("internal_error")
    expect(owner.state.conns.size).toBe(0)
  })
})

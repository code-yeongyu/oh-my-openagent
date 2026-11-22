import { afterEach, describe, expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  connectDeviceService,
  type DeviceService,
  deviceServiceEndpointPath,
} from "../../device-service-core/src/index.ts"
import { startFakeOwner, type FakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld } from "../../device-service-core/test/local-api/conformance/world.ts"
import { credentialId, type CredentialStore } from "../../omo-opencode/src/cli/service-auth/keystore"
import type { Credentials } from "../../omo-opencode/src/cli/service-auth/protocol"
import { createSession, type DeviceServiceHandoff } from "../../omo-opencode/src/cli/service-auth/session"
import { signedOutMarkerPath, writeSignedOutMarker } from "../../omo-opencode/src/cli/service-auth/signed-out-marker"
import { ACCOUNT_EXIT, runAccountVerb } from "../account-cli"
import { cliDeviceServiceHandoff } from "../device-service-handoff"

// Design D r9 sections 4-5, the omo CLI side: `omo login` and `omo account adopt` hand the keys they hold to the
// device service after the signed-out marker is gone; `omo account forget` (both forms) tells it to forget.

const owners: FakeOwner[] = []
const services: DeviceService[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const service of services.splice(0)) service.close()
  for (const owner of owners.splice(0)) await owner.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "omo-dsh-"))
  chmodSync(dir, 0o700)
  dirs.push(dir)
  return dir
}

const signedIn = (accountId?: string): Credentials => ({
  accessToken: "access-1",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  refreshToken: "refresh-1",
  device: { id: "dev-self", name: "This Mac" },
  signingPrivateKey: generateKeyPairSync("ed25519")
    .privateKey.export({ format: "der", type: "pkcs8" })
    .toString("base64"),
  sealingPrivateKey: generateKeyPairSync("x25519")
    .privateKey.export({ format: "der", type: "pkcs8" })
    .toString("base64"),
  ...(accountId === undefined ? {} : { accountId }),
})

async function runningService(version = "0.1.3") {
  const stateDir = join(temp(), "ds")
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const owner = await startFakeOwner({ stateDir, world: { ...defaultWorld(), service_version: version } })
  owners.push(owner)
  const connect = async () => {
    const service = await connectDeviceService({ version: "5.1.60", stateDir })
    services.push(service)
    return service
  }
  return { owner, stateDir, connect }
}

const me: typeof fetch = Object.assign(
  async (input: Parameters<typeof fetch>[0]) =>
    String(input).endsWith("/v1/me")
      ? Response.json({ account: { id: "acct_from_me" } })
      : new Response("{}", { status: 404 }),
  { preconnect: fetch.preconnect },
)

describe("the omo CLI device service hand-off", () => {
  test("a sign-in that names its account hands account and keys to the service", async () => {
    const s = await runningService()
    const credential = signedIn("acct_42")
    await cliDeviceServiceHandoff({
      api: "http://127.0.0.1:9",
      stateDir: s.stateDir,
      connect: s.connect,
      fetch: me,
      log: () => {},
    }).adopt(credential)
    expect(s.owner.state.adoptRequests).toEqual([
      expect.objectContaining({
        account: "acct_42",
        device: credential.device,
        signing_private_key: credential.signingPrivateKey,
      }),
    ])
  })

  test("a sign-in that names no account asks the service API with the in-memory token, never the store", async () => {
    const s = await runningService()
    await cliDeviceServiceHandoff({
      api: "http://127.0.0.1:9",
      stateDir: s.stateDir,
      connect: s.connect,
      fetch: me,
      log: () => {},
    }).adopt(signedIn())
    expect(s.owner.state.adoptRequests.map((request) => request["account"])).toEqual(["acct_from_me"])
  })

  test("with no running service a sign-in asks nothing and reports nothing", async () => {
    const lines: string[] = []
    let fetched = 0
    const counting: typeof fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        fetched += 1
        return me(input)
      },
      { preconnect: fetch.preconnect },
    )
    await cliDeviceServiceHandoff({
      api: "http://127.0.0.1:9",
      stateDir: join(temp(), "ds"),
      fetch: counting,
      log: (line) => lines.push(line),
    }).adopt(signedIn())
    expect([fetched, lines]).toEqual([0, []])
  })

  test("forget tells a running service to forget the device", async () => {
    const s = await runningService()
    await cliDeviceServiceHandoff({
      api: "http://127.0.0.1:9",
      stateDir: s.stateDir,
      connect: s.connect,
      fetch: me,
      log: () => {},
    }).forget()
    expect(s.owner.state.log).toEqual(["device.forget"])
  })

  // #6503: the machine's device service holds its one account device; omo login reads it instead of minting another.
  test("machineDevice names the device a running service holds, parked included, and absent when no service runs", async () => {
    const s = await runningService()
    const handoff = cliDeviceServiceHandoff({
      api: "http://127.0.0.1:9",
      stateDir: s.stateDir,
      connect: s.connect,
      fetch: me,
      log: () => {},
    })
    expect(await handoff.machineDevice?.()).toEqual({ kind: "held", device: { id: "dev-self", name: "This Mac" } })
    s.owner.state.status = { ...s.owner.state.status, state: "sign_in_required" }
    expect(await handoff.machineDevice?.()).toEqual({ kind: "held", device: { id: "dev-self", name: "This Mac" } })
    const none = cliDeviceServiceHandoff({
      api: "http://127.0.0.1:9",
      stateDir: join(temp(), "ds"),
      fetch: me,
      log: () => {},
    })
    expect(await none.machineDevice?.()).toEqual({ kind: "absent" })
  })

  test("#given an endpoint file nothing answers #when machineDevice reads it #then it is not-responding, not absent", async () => {
    const stateDir = join(temp(), "ds")
    mkdirSync(stateDir, { recursive: true, mode: 0o700 })
    await Bun.write(deviceServiceEndpointPath(stateDir), "")
    const lines: string[] = []
    const handoff = cliDeviceServiceHandoff({
      api: "http://127.0.0.1:9",
      stateDir,
      fetch: me,
      log: (line) => lines.push(line),
      connect: async () => {
        throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })
      },
    })
    const state = await handoff.machineDevice?.()
    expect(state?.kind).toBe("unknown")
    expect(state && state.kind === "unknown" ? state.reason : "").toContain("dead_endpoint")
    // #13096 review LOW: the sign-in refusal names the leftover file to remove, and nothing on stderr claims the opposite
    // ("treated as not running") just before it.
    expect(state && state.kind === "unknown" ? state.endpoint : "").toBe(deviceServiceEndpointPath(stateDir))
    expect(lines.filter((line) => line.includes("treated as not running"))).toEqual([])
  })

  test("a failure is reported on the log and never fails the sign-in or sign-out", async () => {
    const stateDir = join(temp(), "ds")
    mkdirSync(stateDir, { recursive: true, mode: 0o700 })
    // An endpoint file that exists but answers nothing a client can use.
    await Bun.write(deviceServiceEndpointPath(stateDir), "")
    const lines: string[] = []
    const handoff = cliDeviceServiceHandoff({
      api: "http://127.0.0.1:9",
      stateDir,
      fetch: me,
      log: (line) => lines.push(line),
      connect: async () => {
        throw new Error("handshake refused")
      },
    })
    await handoff.adopt(signedIn("acct_42"))
    await handoff.forget()
    expect(lines).toHaveLength(2)
  })
})

describe.skipIf(process.platform === "win32")("a relayd that died and left its endpoint file behind", () => {
  test("sign-in, omo account adopt and every sign-out still succeed, each with one log line", async () => {
    const stateDir = join(temp(), "ds")
    mkdirSync(stateDir, { recursive: true, mode: 0o700 })
    const endpoint = deviceServiceEndpointPath(stateDir)
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(endpoint, resolve))
    linkSync(endpoint, `${endpoint}.kept`)
    await new Promise<void>((resolve) => server.close(() => resolve()))
    renameSync(`${endpoint}.kept`, endpoint)
    chmodSync(endpoint, 0o600)
    const lines: string[] = []
    const deviceService = cliDeviceServiceHandoff({
      api: "http://127.0.0.1:9",
      stateDir,
      fetch: me,
      log: (line) => lines.push(line),
      connect: () => connectDeviceService({ version: "5.1.60", stateDir }),
    })
    let value = null as Credentials | null
    const store: CredentialStore = {
      read: async () => value,
      readAuthoritative: async () => value,
      write: async (next) => {
        value = next
      },
      clear: async () => {
        value = null
      },
    }
    const home = temp()
    const session = createSession({
      api: "http://127.0.0.1:9",
      store,
      home,
      beforeKeysDiscarded: async () => undefined,
      deviceService,
    })
    const signedInCredential = signedIn("acct_42")
    await session.save(signedInCredential)
    expect(value).toEqual(signedInCredential)
    await session.forget()
    expect(value).toBeNull()
    const adopt = await runAccountVerb(
      {
        api: "http://127.0.0.1:9",
        store,
        home,
        deviceService,
        pinDir: () => join(home, "pins"),
        readStdin: async () => JSON.stringify(signedIn("acct_42")),
        output: () => {},
        error: () => {},
      },
      ["adopt"],
    )
    expect(adopt).toBe(ACCOUNT_EXIT.ok)
    expect(lines).toHaveLength(3)
  })
})

describe("omo account verbs and the device service", () => {
  function machine(initial: Credentials | null) {
    const home = temp()
    const api = "http://127.0.0.1:9"
    let value = initial
    const store: CredentialStore = {
      read: async () => value,
      readAuthoritative: async () => value,
      write: async (next) => {
        value = next
      },
      clear: async () => {
        value = null
      },
    }
    const markerPath = signedOutMarkerPath(home, credentialId(api))
    const events: string[] = []
    const handed: Credentials[] = []
    const deviceService: DeviceServiceHandoff = {
      adopt: async (credentials) => {
        events.push(`adopt marker=${existsSync(markerPath) ? "present" : "absent"}`)
        handed.push(credentials)
      },
      forget: async () => {
        events.push("forget")
      },
    }
    const account = (args: string[], stdin = "") =>
      runAccountVerb(
        {
          api,
          store,
          home,
          deviceService,
          pinDir: () => join(home, "pins"),
          readStdin: async () => stdin,
          output: () => {},
          error: () => {},
        },
        args,
      )
    return { account, markerPath, events, handed }
  }

  test("adopt deletes the signed-out marker, then hands the adopted keys over", async () => {
    const m = machine(null)
    await writeSignedOutMarker(m.markerPath, "dev-old")
    const incoming = signedIn("acct_42")
    expect(await m.account(["adopt"], JSON.stringify(incoming))).toBe(ACCOUNT_EXIT.ok)
    expect(m.events).toEqual(["adopt marker=absent"])
    expect(m.handed.map((credential) => credential.device.id)).toEqual(["dev-self"])
  })

  test("forget forgets the device", async () => {
    const m = machine(signedIn("acct_42"))
    expect(await m.account(["forget"])).toBe(ACCOUNT_EXIT.ok)
    expect(m.events).toEqual(["forget"])
  })

  test("forget --device forgets the device", async () => {
    const m = machine(signedIn("acct_42"))
    expect(await m.account(["forget", "--device", "dev-self"])).toBe(ACCOUNT_EXIT.ok)
    expect(m.events).toEqual(["forget"])
  })

  test("forget --device naming another device is no sign-out and forgets nothing", async () => {
    const m = machine(signedIn("acct_42"))
    expect(await m.account(["forget", "--device", "dev-other"])).toBe(ACCOUNT_EXIT.conflict)
    expect(m.events).toEqual([])
  })
})

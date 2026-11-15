import { afterEach, describe, expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { chmodSync, linkSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  connectDeviceService,
  type DeviceService,
  deviceServiceEndpointPath,
  forgetDeviceService,
  handDeviceKeys,
  type HeldDeviceCredential,
  LocalApiError,
} from "../src/index.ts"
import { writeToken } from "../src/local-api/access.ts"
import { startFakeOwner, type FakeOwner } from "./local-api/conformance/fake-owner.ts"
import { testSecure } from "./local-api/support.ts"
import { defaultWorld } from "./local-api/conformance/world.ts"

// Design D r9 sections 3-4: keys reach the device service only from a credential a client already holds in memory.
// The hand-off never installs a service; the re-adopt sends only while the service reports no adopted device.

const owners: FakeOwner[] = []
const services: DeviceService[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const service of services.splice(0)) service.close()
  for (const owner of owners.splice(0)) await owner.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const held = (): HeldDeviceCredential => ({
  device: { id: "dev-self", name: "This Mac" },
  account: "acct_42",
  signingPrivateKey: generateKeyPairSync("ed25519")
    .privateKey.export({ format: "der", type: "pkcs8" })
    .toString("base64"),
  sealingPrivateKey: generateKeyPairSync("x25519")
    .privateKey.export({ format: "der", type: "pkcs8" })
    .toString("base64"),
})

const stateDirOf = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-"))
  chmodSync(dir, 0o700)
  dirs.push(dir)
  return join(dir, "ds")
}

const ownerAt = async (stateDir: string, adopted: boolean): Promise<FakeOwner> => {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const world = defaultWorld()
  const status = adopted
    ? { ...world.status, device: { id: "dev-self", name: "This Mac" } }
    : { ...world.status, device: null, state: "sign_in_required" as const }
  const owner = await startFakeOwner({ stateDir, world: { ...world, service_version: "0.1.3", status } })
  owners.push(owner)
  return owner
}

const connector = (stateDir: string) => {
  const calls = { connect: 0 }
  const connect = async () => {
    calls.connect += 1
    const service = await connectDeviceService({ version: "5.1.60", stateDir })
    services.push(service)
    return service
  }
  return { connect, calls }
}

/** A relayd that died and left its socket behind: the endpoint file exists, nothing listens on it. */
const deadEndpoint = async (stateDir: string): Promise<void> => {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const endpoint = deviceServiceEndpointPath(stateDir)
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(endpoint, resolve))
  linkSync(endpoint, `${endpoint}.kept`)
  await new Promise<void>((resolve) => server.close(() => resolve()))
  renameSync(`${endpoint}.kept`, endpoint)
  chmodSync(endpoint, 0o600)
  // A dead service leaves its per-boot token too, so the connect reaches the socket and nothing answers.
  await writeToken(stateDir, testSecure)
}

/** The cause word the not-running log line starts with (after the fixed prefix). */
const causeOf = (line: string | undefined): string | undefined =>
  /^OmO device service: ([a-z_]+),/.exec(line ?? "")?.[1]

describe.skipIf(process.platform === "win32")("a relayd that died and left its endpoint file behind", () => {
  test("the hand-off reads it as no relayd running, logs it, and never throws", async () => {
    const stateDir = stateDirOf()
    await deadEndpoint(stateDir)
    const lines: string[] = []
    const outcome = await handDeviceKeys({
      stateDir,
      credential: held(),
      when: "always",
      log: (line) => lines.push(line),
      connect: () => connectDeviceService({ version: "5.1.60", stateDir }),
    })
    expect(outcome).toBe("not_running")
    expect(lines.map(causeOf)).toEqual(["dead_endpoint"])
  })

  test("an endpoint that is not a socket is named unreadable, not dead", async () => {
    const stateDir = stateDirOf()
    mkdirSync(stateDir, { recursive: true, mode: 0o700 })
    await Bun.write(deviceServiceEndpointPath(stateDir), "")
    const lines: string[] = []
    const outcome = await handDeviceKeys({
      stateDir,
      credential: held(),
      when: "always",
      log: (line) => lines.push(line),
      connect: () => connectDeviceService({ version: "5.1.60", stateDir }),
    })
    expect(outcome).toBe("not_running")
    expect(lines.map(causeOf)).toEqual(["unreadable"])
  })

  // read_failed is raised only when a session-history read on a live attach fails (client-assembly.ts #failRead): the
  // service answered, so it is a plain failure, never an unreadable state dir; insecure_state_dir is the unreadable one.
  test.each([
    ["read_failed", "failed"],
    ["insecure_state_dir", "unreadable"],
  ] as const)("a %s connect failure is named %s", async (code, cause) => {
    const stateDir = stateDirOf()
    await deadEndpoint(stateDir)
    const lines: string[] = []
    const outcome = await handDeviceKeys({
      stateDir,
      credential: held(),
      when: "always",
      log: (line) => lines.push(line),
      connect: async () => {
        throw new LocalApiError(code, "synthetic")
      },
    })
    expect(outcome).toBe("not_running")
    expect(lines.map(causeOf)).toEqual([cause])
  })

  test("forget reads it as no relayd running, logs it, and never throws", async () => {
    const stateDir = stateDirOf()
    await deadEndpoint(stateDir)
    const lines: string[] = []
    const outcome = await forgetDeviceService({
      stateDir,
      log: (line) => lines.push(line),
      connect: () => connectDeviceService({ version: "5.1.60", stateDir }),
    })
    expect(outcome).toBe("not_running")
    expect(lines.map(causeOf)).toEqual(["dead_endpoint"])
  })
})

describe("handing held device keys to the device service", () => {
  test("no running service: nothing is installed or connected", async () => {
    const stateDir = stateDirOf()
    const { connect, calls } = connector(stateDir)
    expect(await handDeviceKeys({ stateDir, connect, credential: held(), when: "always" })).toBe("not_running")
    expect(calls.connect).toBe(0)
  })

  test("a service that reports no adopted device gets device.adopt with the account and keys", async () => {
    const stateDir = stateDirOf()
    const owner = await ownerAt(stateDir, false)
    const credential = held()
    expect(
      await handDeviceKeys({ stateDir, connect: connector(stateDir).connect, credential, when: "not_adopted" }),
    ).toBe("adopted")
    expect(owner.state.adoptRequests).toEqual([
      expect.objectContaining({
        account: "acct_42",
        device: credential.device,
        signing_private_key: credential.signingPrivateKey,
        sealing_private_key: credential.sealingPrivateKey,
      }),
    ])
  })

  test("an adopted service is left alone by the re-adopt", async () => {
    const stateDir = stateDirOf()
    const owner = await ownerAt(stateDir, true)
    expect(
      await handDeviceKeys({ stateDir, connect: connector(stateDir).connect, credential: held(), when: "not_adopted" }),
    ).toBe("already_adopted")
    expect(owner.state.adoptions).toBe(0)
  })

  test("a fresh sign-in hands its keys even to an adopted service", async () => {
    const stateDir = stateDirOf()
    const owner = await ownerAt(stateDir, true)
    expect(
      await handDeviceKeys({ stateDir, connect: connector(stateDir).connect, credential: held(), when: "always" }),
    ).toBe("adopted")
    expect(owner.state.adoptions).toBe(1)
  })
})

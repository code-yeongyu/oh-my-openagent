import { afterEach, describe, expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bootstrapDeviceService, type BootstrapDependencies, forgetDeviceService } from "../src/bootstrap.ts"
import { connectDeviceService, type DeviceCredential, type DeviceService } from "../src/index.ts"
import type { AccountShowResult } from "../src/account-state.ts"
import { writeToken } from "../src/local-api/access.ts"
import { LocalApiError } from "../src/local-api/errors.ts"
import { startFakeOwner, type FakeOwner } from "./local-api/conformance/fake-owner.ts"
import { defaultWorld } from "./local-api/conformance/world.ts"
import { testSecure } from "./local-api/support.ts"

const PIN = "1.4.0"
const AGENT_DIR = "/home/user/.omo/agent"
const REFRESHER = { binaryPath: "/opt/omo/omo-cli", version: "5.1.52" }

const owners: FakeOwner[] = []
const services: DeviceService[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const service of services.splice(0)) service.close()
  for (const owner of owners.splice(0)) await owner.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const SIGNED_IN: AccountShowResult = { exitCode: 0, stdout: JSON.stringify({ signedIn: true, device: { id: "dev-self", name: "This Mac" }, refreshState: "ok" }) }

const credential = (): DeviceCredential => ({
  device: { id: "dev-self", name: "This Mac" },
  signingPrivateKey: generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  sealingPrivateKey: generateKeyPairSync("x25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
})

const home = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "dsb-"))
  chmodSync(dir, 0o700)
  dirs.push(dir)
  return join(dir, "ds")
}

const ownerAt = async (stateDir: string, version: string): Promise<FakeOwner> => {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const owner = await startFakeOwner({ stateDir, world: { ...defaultWorld(), service_version: version } })
  owners.push(owner)
  return owner
}

type Harness = { readonly deps: BootstrapDependencies; readonly calls: { install: number; connect: number }; readonly credentialReads: () => number }

const harness = (stateDir: string, overrides: Partial<BootstrapDependencies> = {}): Harness => {
  const calls = { install: 0, connect: 0 }
  // Design D r9 section 3: the bootstrap's own credential read is OFF relay's path. A credential reader is still
  // offered here (as omo 1dc315f1cc wired one), and the bootstrap must never call it.
  let reads = 0
  const offered = { credential: async (): Promise<DeviceCredential> => { reads += 1; return credential() } }
  const deps: BootstrapDependencies = {
    ...offered,
    accountShow: async () => SIGNED_IN,
    stateDir,
    pinVersion: PIN,
    install: async () => {
      calls.install += 1
      await ownerAt(stateDir, PIN)
      return { ok: true }
    },
    connect: async () => {
      calls.connect += 1
      const service = await connectDeviceService({ version: REFRESHER.version, stateDir })
      services.push(service)
      return service
    },
    refresher: REFRESHER,
    agentDir: AGENT_DIR,
    ...overrides,
  }
  return { deps, calls, credentialReads: () => reads }
}

describe("device service bootstrap", () => {
  test("signed in proceeds: an installed service at the pin is connected without an acquisition", async () => {
    const stateDir = home()
    const owner = await ownerAt(stateDir, PIN)
    const { deps, calls, credentialReads } = harness(stateDir)
    const outcome = await bootstrapDeviceService(deps)
    expect(outcome.kind).toBe("connected")
    expect(calls.install).toBe(0)
    expect(owner.state.adoptions).toBe(0)
    expect(credentialReads()).toBe(0)
  })

  test("a clean home signed in ends connected against the fake owner with the sequence asserted", async () => {
    const stateDir = home()
    const { deps, calls, credentialReads } = harness(stateDir)
    const outcome = await bootstrapDeviceService(deps)
    expect(outcome).toMatchObject({ kind: "connected", status: { state: "connected" } })
    expect(calls).toEqual({ install: 1, connect: 1 })
    const owner = owners[0]
    // No device.adopt: keys reach the service only from a credential a client already holds in memory.
    expect(owner?.state.log).toEqual(["refresher.register", "endpoints.register", "status.get"])
    expect(credentialReads()).toBe(0)
    expect(owner?.state.refresher).toEqual({ binary_path: REFRESHER.binaryPath, version: REFRESHER.version })
    expect([...(owner?.state.endpoints ?? [])]).toEqual([AGENT_DIR])
  })

  // D1 (#12051): the per-device opt-out belongs to the user; starting omo must never turn remote control back on.
  test("a connected bootstrap leaves a detached host detached", async () => {
    const stateDir = home()
    const owner = await ownerAt(stateDir, PIN)
    const { deps } = harness(stateDir)
    const setter = await deps.connect()
    await setter.setAttachControl(false)
    expect(await bootstrapDeviceService(deps)).toMatchObject({ kind: "connected" })
    expect(owner.state.attach.attached).toBe(false)
    expect(owner.state.log.filter(type => type === "control.attach.set")).toHaveLength(1)
  })

  test("acquisition runs again when welcome.service_version is older than the pin", async () => {
    const stateDir = home()
    const old = await ownerAt(stateDir, "1.3.9")
    const { deps, calls } = harness(stateDir, {
      install: async () => {
        await old.stop()
        await ownerAt(stateDir, PIN)
        return { ok: true }
      },
    })
    const outcome = await bootstrapDeviceService(deps)
    expect(outcome.kind).toBe("connected")
    expect(outcome.kind === "connected" ? outcome.service.serviceVersion : "").toBe(PIN)
    expect(calls.connect).toBe(2)
    expect(old.state.adoptions).toBe(0)
  })

  test.each([
    ["signedIn false stops with omo login hint", { exitCode: 0, stdout: JSON.stringify({ signedIn: false }) }, "signed_out", "omo login"],
    ["locked store reports keychain_locked and installs nothing", { exitCode: 7, stdout: JSON.stringify({ keychain: "locked" }) }, "keychain_locked", "Unlock"],
    // No store means no proof of a sign-in: its own state, which the start-up component keeps quiet (a never-signed-in
    // machine without a keyring must not warn at every start).
    ["store unavailable reports store_unavailable", { exitCode: 9, stdout: JSON.stringify({ error: "store-unavailable" }) }, "store_unavailable", "credential store"],
    ["keychain unavailable (exit 8) reports store_unavailable", { exitCode: 8, stdout: JSON.stringify({ keychain: "unavailable" }) }, "store_unavailable", "credential store"],
    ["invalid json is account_unavailable", { exitCode: 0, stdout: "{signedIn: true" }, "account_unavailable", "omo login"],
  ])("%s", async (_name, account, state, hint) => {
    const { deps, calls } = harness(home(), { accountShow: async () => account })
    const outcome = await bootstrapDeviceService(deps)
    expect(outcome).toMatchObject({ kind: "stopped", state, exitCode: 3 })
    expect(outcome.kind === "stopped" ? outcome.notice : "").toContain(hint)
    expect(calls).toEqual({ install: 0, connect: 0 })
  })

  test("a refused acquisition stops with its own state and action and never connects", async () => {
    const { deps, calls } = harness(home(), {
      install: async () => ({ ok: false, state: "update_required", action: "Update OmO to use the device service." }),
    })
    expect(await bootstrapDeviceService(deps)).toEqual({
      kind: "stopped",
      state: "update_required",
      notice: "Update OmO to use the device service.",
      exitCode: 3,
    })
    expect(calls.connect).toBe(0)
  })

  test.skipIf(process.platform === "win32")("a running service that only times out its handshake is never reinstalled", async () => {
    const stateDir = home()
    const owner = await ownerAt(stateDir, PIN)
    const { deps, calls } = harness(stateDir, {
      connect: async () => {
        calls.connect += 1
        throw new LocalApiError("handshake_timeout", "the owner did not complete the handshake")
      },
    })
    expect(await bootstrapDeviceService(deps)).toMatchObject({ kind: "stopped", state: "service_degraded" })
    expect(calls).toEqual({ install: 0, connect: 2 })
    expect(owner.state.adoptions).toBe(0)
  })

  test.skipIf(process.platform === "win32")("one slow handshake is retried and the running service is used, not replaced", async () => {
    const stateDir = home()
    const owner = await ownerAt(stateDir, PIN)
    let slow = true
    const { deps, calls } = harness(stateDir, {
      connect: async () => {
        calls.connect += 1
        if (slow) {
          slow = false
          throw new LocalApiError("handshake_timeout", "the owner did not complete the handshake")
        }
        const service = await connectDeviceService({ version: REFRESHER.version, stateDir })
        services.push(service)
        return service
      },
    })
    expect((await bootstrapDeviceService(deps)).kind).toBe("connected")
    expect(calls).toEqual({ install: 0, connect: 2 })
    expect(owner.state.adoptions).toBe(0)
  })

  test("a bad server_proof drops the connection with zero adopts and installs nothing", async () => {
    const stateDir = home()
    const owner = await ownerAt(stateDir, PIN)
    await writeToken(stateDir, testSecure)
    const { deps, calls } = harness(stateDir)
    expect(await bootstrapDeviceService(deps)).toMatchObject({ kind: "stopped", state: "service_degraded", exitCode: 3 })
    expect(owner.state.adoptions).toBe(0)
    expect(owner.state.log).toEqual([])
    expect(calls.install).toBe(0)
  })
})

describe("omo logout and the device service", () => {
  test("omo logout calls device.forget on a running service", async () => {
    const stateDir = home()
    const owner = await ownerAt(stateDir, PIN)
    const { deps } = harness(stateDir)
    expect(await forgetDeviceService({ stateDir, connect: deps.connect })).toBe("forgotten")
    expect(owner.state.log).toEqual(["device.forget"])
    expect(owner.state.status.device).toBeNull()
  })

  test("with no service on this device logout connects to nothing", async () => {
    const { deps, calls } = harness(home())
    expect(await forgetDeviceService({ stateDir: deps.stateDir, connect: deps.connect })).toBe("not_running")
    expect(calls.connect).toBe(0)
  })
})

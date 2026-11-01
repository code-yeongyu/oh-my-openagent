import { afterEach, describe, expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type AdoptionCredential, bootstrapDeviceService, type BootstrapDependencies, forgetDeviceService } from "../src/bootstrap.ts"
import { connectDeviceService, type DeviceService } from "../src/index.ts"
import type { AccountShowResult } from "../src/account-state.ts"
import { writeToken } from "../src/local-api/access.ts"
import { startFakeOwner, type FakeOwner } from "./local-api/conformance/fake-owner.ts"
import { defaultWorld } from "./local-api/conformance/world.ts"
import { testSecure } from "./local-api/support.ts"

const PIN = "1.4.0"
const AGENT_DIR = "/home/user/.omo/agent"
const REFRESHER = { binaryPath: "/home/user/.omo/bin/omo", version: "5.1.52" }

const owners: FakeOwner[] = []
const services: DeviceService[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const service of services.splice(0)) service.close()
  for (const owner of owners.splice(0)) await owner.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const SIGNED_IN: AccountShowResult = { exitCode: 0, stdout: JSON.stringify({ signedIn: true, device: { id: "dev-self", name: "This Mac" }, refreshState: "ok" }) }

const credential = (): AdoptionCredential => ({
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

type Harness = { readonly deps: BootstrapDependencies; readonly calls: { install: number; connect: number } }

const harness = (stateDir: string, overrides: Partial<BootstrapDependencies> = {}): Harness => {
  const calls = { install: 0, connect: 0 }
  const deps: BootstrapDependencies = {
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
    credential: async () => credential(),
    refresher: REFRESHER,
    agentDir: AGENT_DIR,
    ...overrides,
  }
  return { deps, calls }
}

describe("device service bootstrap", () => {
  test("signed in proceeds: an installed service at the pin is connected without an acquisition", async () => {
    const stateDir = home()
    const owner = await ownerAt(stateDir, PIN)
    const { deps, calls } = harness(stateDir)
    const outcome = await bootstrapDeviceService(deps)
    expect(outcome.kind).toBe("connected")
    expect(calls.install).toBe(0)
    expect(owner.state.adoptions).toBe(1)
  })

  test("a clean home signed in ends connected against the fake owner with the sequence asserted", async () => {
    const stateDir = home()
    const { deps, calls } = harness(stateDir)
    const outcome = await bootstrapDeviceService(deps)
    expect(outcome).toMatchObject({ kind: "connected", status: { state: "connected" } })
    expect(calls).toEqual({ install: 1, connect: 1 })
    const owner = owners[0]
    expect(owner?.state.log).toEqual(["refresher.register", "device.adopt", "endpoints.register", "status.get"])
    expect(owner?.state.refresher).toEqual({ binary_path: REFRESHER.binaryPath, version: REFRESHER.version })
    expect([...(owner?.state.endpoints ?? [])]).toEqual([AGENT_DIR])
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
    ["store unavailable reports service_degraded", { exitCode: 9, stdout: JSON.stringify({ error: "store-unavailable" }) }, "service_degraded", "credential store"],
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

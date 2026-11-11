import { describe, expect, test } from "bun:test"
import type { CredentialStore } from "./keystore"
import { MachineAlreadySignedIn, refuseSecondMachineDevice } from "./machine-device"
import type { Credentials } from "./protocol"
import { createSession, type DeviceServiceHandoff } from "./session"
import { fakeApi, grant, privateKeys, refusal, temporaryHome } from "./test-support"

// #6503: a device is the physical machine, and the machine's one device service holds it. `omo login` must never mint
// a second account device for a machine that already has one, whether the CLI's own store or the device service holds it.

const stored: Credentials = { ...grant, ...privateKeys, accountId: "acct_42", device: { id: "dev-machine", name: "Studio Mac" } }

function memoryStore(initial: Credentials | null): CredentialStore {
  let value = initial
  return {
    read: async () => value,
    readAuthoritative: async () => value,
    write: async next => { value = next },
    clear: async () => { value = null },
  }
}

const service = (held: { readonly id: string; readonly name: string } | null): DeviceServiceHandoff => ({
  adopt: async () => undefined,
  forget: async () => undefined,
  machineDevice: async () => held,
})

async function sessionWith(initial: Credentials | null, api = fakeApi(() => new Response(null, { status: 204 }))) {
  return createSession({ api, store: memoryStore(initial), home: await temporaryHome(), beforeKeysDiscarded: async () => undefined })
}

describe("omo login reuses this machine's device instead of registering another", () => {
  test("a usable stored sign-in refuses a new device and names the machine's device", async () => {
    const session = await sessionWith(stored)
    const refused = refuseSecondMachineDevice(session, service(null))
    await expect(refused).rejects.toBeInstanceOf(MachineAlreadySignedIn)
    await expect(refused).rejects.toThrow("Studio Mac")
  })

  test("a device the device service already holds refuses a new device even with an empty store", async () => {
    const session = await sessionWith(null)
    const refused = refuseSecondMachineDevice(session, service({ id: "dev-desktop", name: "OmO Desktop on Studio" }))
    await expect(refused).rejects.toBeInstanceOf(MachineAlreadySignedIn)
    await expect(refused).rejects.toThrow("OmO Desktop on Studio")
  })

  test("a machine with no device anywhere may enroll", async () => {
    await expect(refuseSecondMachineDevice(await sessionWith(null), service(null))).resolves.toBeUndefined()
    await expect(refuseSecondMachineDevice(await sessionWith(null), undefined)).resolves.toBeUndefined()
  })

  test("a stored sign-in the service has revoked no longer counts, so the machine may enroll again", async () => {
    const api = fakeApi(() => refusal("device_revoked", undefined, 401))
    const session = await sessionWith({ ...stored, accessTokenExpiresAt: "2000-01-01T00:00:00.000Z" }, api)
    await expect(refuseSecondMachineDevice(session, service(null))).resolves.toBeUndefined()
  })
})

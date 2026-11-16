import { describe, expect, test } from "bun:test"
import { type CredentialStore, InvalidCredentialState, KeychainLockedError } from "./keystore"
import { MachineAlreadySignedIn, MachineCredentialUnreadable, refuseSecondMachineDevice } from "./machine-device"
import type { Credentials } from "./protocol"
import { createSession, type DeviceServiceHandoff, type MachineDeviceState } from "./session"
import { fakeApi, grant, memorySecrets, privateKeys, refusal, temporaryHome } from "./test-support"

// #6503: a device is the physical machine, and the machine's one device service holds it. `omo login` must never mint
// a second account device for a machine that already has one, whether the CLI's own store or the device service holds it.

const stored: Credentials = {
  ...grant,
  ...privateKeys,
  accountId: "acct_42",
  device: { id: "dev-machine", name: "Studio Mac" },
}

function memoryStore(initial: Credentials | null): CredentialStore {
  let value = initial
  return {
    read: async () => value,
    readAuthoritative: async () => value,
    write: async (next) => {
      value = next
    },
    clear: async () => {
      value = null
    },
  }
}

const service = (state: MachineDeviceState): DeviceServiceHandoff => ({
  adopt: async () => undefined,
  forget: async () => undefined,
  machineDevice: async () => state,
})
const absent: MachineDeviceState = { kind: "absent" }

async function sessionWith(initial: Credentials | null, api = fakeApi(() => new Response(null, { status: 204 }))) {
  return createSession({
    api,
    store: memoryStore(initial),
    home: await temporaryHome(),
    beforeKeysDiscarded: async () => undefined,
  })
}

describe("omo login reuses this machine's device instead of registering another", () => {
  test("a usable stored sign-in refuses a new device and names the machine's device", async () => {
    const session = await sessionWith(stored)
    const refused = refuseSecondMachineDevice(session, service(absent))
    await expect(refused).rejects.toBeInstanceOf(MachineAlreadySignedIn)
    await expect(refused).rejects.toThrow("Studio Mac")
  })

  test("a device the device service already holds refuses a new device even with an empty store", async () => {
    const session = await sessionWith(null)
    const refused = refuseSecondMachineDevice(
      session,
      service({ kind: "held", device: { id: "dev-desktop", name: "OmO Desktop on Studio" } }),
    )
    await expect(refused).rejects.toBeInstanceOf(MachineAlreadySignedIn)
    await expect(refused).rejects.toThrow("OmO Desktop on Studio")
  })

  test("a device service that exists but cannot be read is not absence", async () => {
    const refused = refuseSecondMachineDevice(
      await sessionWith(null),
      service({ kind: "unknown", reason: "timed_out" }),
    )
    await expect(refused).rejects.toBeInstanceOf(MachineAlreadySignedIn)
  })

  // The real refresh path throws refresh_recovery_expired for a stored refreshState "uncertain". Forget would also end a
  // device the device service holds, so the recovery follows that state: the desktop share leads when one is held.
  test("an uncertain refresh leads with the desktop share when the device service holds the device", async () => {
    const session = await sessionWith({ ...stored, refreshState: "uncertain" })
    const absentRefusal = refuseSecondMachineDevice(session, service(absent))
    await expect(absentRefusal).rejects.toMatchObject({
      constructor: MachineAlreadySignedIn,
      message:
        "This computer's OmO sign-in has a refresh whose outcome is unknown. omo kept its credential and keys and did not register another device. To start over, remove this computer's device on the Devices page if it is still listed, then run omo account forget, then sign in again. omo account forget ends this computer's local sign-in and has its device service forget the device, without signing the device out on the OmO service.",
    })
    const heldRefusal = refuseSecondMachineDevice(
      session,
      service({ kind: "held", device: { id: "dev-desktop", name: "OmO Desktop on Studio" } }),
    )
    // The non-destructive share leads; the start-over steps are only its fallback, with what they also end.
    const heldMessage = await heldRefusal.then(
      () => "",
      (error: unknown) => (error instanceof MachineAlreadySignedIn ? error.message : ""),
    )
    expect(heldMessage).toContain("OmO Desktop on Studio")
    expect(heldMessage.indexOf("share it with omo")).toBeGreaterThan(-1)
    expect(heldMessage.indexOf("share it with omo")).toBeLessThan(heldMessage.indexOf("omo account forget"))
    expect(heldMessage).toContain("so these steps also sign out the device service")
    const unknownRefusal = refuseSecondMachineDevice(session, service({ kind: "unknown", reason: "timed_out" }))
    await expect(unknownRefusal).rejects.toThrow("is installed but did not answer (timed_out)")
    await expect(unknownRefusal).rejects.not.toThrow("forget")
  })

  // A locked or unreadable credential store is not "nothing stored": its item may be this machine's device, so neither
  // registers another one (#13265 design gate: the service refuses a second device per machine, or keeps two live ones
  // for a row enrolled before machine binding). There is no --new-device escape.
  test("a locked store blocks a new device and names the unlock", async () => {
    const locked = new KeychainLockedError("locked")
    const store: CredentialStore = {
      read: async () => {
        throw locked
      },
      readAuthoritative: async () => {
        throw locked
      },
      write: async () => {
        throw new Error("nothing may be written")
      },
      clear: async () => {
        throw new Error("nothing may be cleared")
      },
    }
    const session = createSession({
      api: fakeApi(() => new Response(null, { status: 204 })),
      store,
      home: await temporaryHome(),
      beforeKeysDiscarded: async () => undefined,
    })
    const refused = refuseSecondMachineDevice(session, service(absent))
    await expect(refused).rejects.toBeInstanceOf(MachineCredentialUnreadable)
    await expect(refused).rejects.toThrow("Unlock the credential store, then sign in again.")
    await expect(refused).rejects.not.toThrow("--new-device")
  })

  // #13265 design gate (A1, A2 corrected, D1): the error comes from the REAL parse path, so the refusal is checked
  // against the message production builds, and the whole rendered text is asserted: the store's own recovery sentence
  // must not leak into it.
  test("an unreadable stored sign-in refuses with one recovery, chosen by what the device service holds", async () => {
    const secrets = memorySecrets()
    const store = secrets.store("https://api.omo.dev")
    await store.write(stored)
    for (const key of secrets.values.keys()) secrets.values.set(key, "{ damaged")
    await expect(store.read()).rejects.toBeInstanceOf(InvalidCredentialState)
    const session = createSession({
      api: fakeApi(() => new Response(null, { status: 204 })),
      store,
      home: await temporaryHome(),
      beforeKeysDiscarded: async () => undefined,
    })
    const steps =
      "To start over, remove this computer's device on the Devices page if it is still listed, then run omo account forget, then sign in again. omo account forget ends this computer's local sign-in and has its device service forget the device, without signing the device out on the OmO service."
    const absentMessage = `omo could not read this computer's stored OmO sign-in, so it did not register another device. ${steps}`
    await expect(refuseSecondMachineDevice(session, service(absent))).rejects.toMatchObject({
      constructor: MachineCredentialUnreadable,
      message: absentMessage,
    })
    await expect(refuseSecondMachineDevice(session, undefined)).rejects.toMatchObject({ message: absentMessage })
    await expect(
      refuseSecondMachineDevice(
        session,
        service({ kind: "held", device: { id: "dev-desktop", name: "OmO Desktop on Studio" } }),
      ),
    ).rejects.toMatchObject({
      constructor: MachineCredentialUnreadable,
      message: `omo could not read this computer's stored OmO sign-in, so it did not register another device. ${steps} This computer's OmO device service holds that device, OmO Desktop on Studio, so these steps also sign out the device service, and the OmO desktop app if it is installed, on this computer.`,
    })
    const unknownRefusal = refuseSecondMachineDevice(session, service({ kind: "unknown", reason: "timed_out" }))
    await expect(unknownRefusal).rejects.toBeInstanceOf(MachineAlreadySignedIn)
    await expect(unknownRefusal).rejects.toThrow("is installed but did not answer (timed_out)")
  })

  test("a machine with no device anywhere may enroll", async () => {
    await expect(refuseSecondMachineDevice(await sessionWith(null), service(absent))).resolves.toBeUndefined()
    await expect(refuseSecondMachineDevice(await sessionWith(null), undefined)).resolves.toBeUndefined()
  })

  test("a stored sign-in the service has revoked no longer counts, so the machine may enroll again", async () => {
    const api = fakeApi(() => refusal("device_revoked", undefined, 401))
    const session = await sessionWith({ ...stored, accessTokenExpiresAt: "2000-01-01T00:00:00.000Z" }, api)
    await expect(refuseSecondMachineDevice(session, service(absent))).resolves.toBeUndefined()
  })
})

import { describe, expect, test } from "bun:test"
import { beginLogin } from "./commands"
import type { CredentialStore } from "./keystore"
import { MachineAlreadySignedIn } from "./machine-device"
import type { Credentials } from "./protocol"
import { createSession, type DeviceServiceHandoff, type MachineDeviceState } from "./session"
import { fakeApi, grant, privateKeys, temporaryHome } from "./test-support"

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

async function sessionFor(initial: Credentials | null, handler: (request: Request) => Response) {
  const api = fakeApi(handler)
  const session = createSession({
    api,
    store: memoryStore(initial),
    home: await temporaryHome(),
    beforeKeysDiscarded: async () => undefined,
  })
  return { api, session }
}

describe("login checks the machine before accounts health", () => {
  test("#given a stored sign-in #when login starts and accounts are down #then it reports the existing device and does not ask health", async () => {
    let health = 0
    const { api, session } = await sessionFor(stored, (request) => {
      if (new URL(request.url).pathname === "/v1/health") health += 1
      return new Response("down", { status: 503 })
    })
    const refused = beginLogin(session, service({ kind: "absent" }), api)
    await expect(refused).rejects.toBeInstanceOf(MachineAlreadySignedIn)
    await expect(refused).rejects.toThrow("Studio Mac")
    expect(health).toBe(0)
  })

  test("#given no sign-in and no device service #when accounts cannot be reached #then the report is that outage, not an existing sign-in", async () => {
    const { api, session } = await sessionFor(null, () => new Response("down", { status: 503 }))
    const refused = beginLogin(session, undefined, api)
    await expect(refused).rejects.toThrow("Can't reach OmO accounts")
    await expect(refused).rejects.not.toBeInstanceOf(MachineAlreadySignedIn)
  })
})

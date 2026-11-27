import { afterEach, describe, expect, test } from "bun:test"
import {
  defaultWorld,
  OFFLINE_PEER,
  PEER,
  SESSION_ID,
  type World,
} from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { resolveTypedAddress } from "./device-address"
import { personSurface } from "./person-surface"
import { clientOn, closeClients, fakeClock, startOwner } from "./testing/fake-service"

// Seam 5 (#13414 4c-2) over the device service's conformance owner: the person client's surface carries the one
// typed-address resolver. The relay check (relayUnavailable) is remoteAvailable itself, exercised where a verb answers it.

afterEach(closeClients)

const surfaceOn = async (world: World = defaultWorld()) => {
  const owner = await startOwner(world)
  const client = clientOn(owner.stateDir, fakeClock())
  return { owner, client, surface: personSurface(client, "5.1.70") }
}

describe("personSurface", () => {
  test("#given the person client #when a typed <device name>/<session> resolves over its surface #then it names the session's row and address", async () => {
    const { surface } = await surfaceOn()
    const resolved = await resolveTypedAddress(surface, `Studio/${SESSION_ID}`, { need: "online" })
    if (resolved.kind === "error") throw new Error(JSON.stringify(resolved.error))
    expect([resolved.where.row.device, resolved.where.row.session_id]).toEqual([PEER, SESSION_ID])
  })

  test("#given an offline device #when the address needs it online #then device_offline, and it resolves when only the address is needed", async () => {
    const { surface } = await surfaceOn()
    const online = await resolveTypedAddress(surface, `Laptop/${SESSION_ID}`, { need: "online" })
    expect(online.kind === "error" ? online.error.code : online.kind).toBe("device_offline")
    const address = await resolveTypedAddress(surface, `Laptop/${SESSION_ID}`, { need: "address" })
    expect(address.kind === "ok" ? address.where.row.device : address.error.code).toBe(OFFLINE_PEER)
  })

  test("#given its sessions port was closed #when the client is used next #then the client's shared connection is still open", async () => {
    const { client, surface } = await surfaceOn()
    await resolveTypedAddress(surface, `${PEER}/${SESSION_ID}`, { need: "online" })
    await surface.sessions.close?.()
    expect((await client.devices.list()).kind).toBe("ok")
  })
})

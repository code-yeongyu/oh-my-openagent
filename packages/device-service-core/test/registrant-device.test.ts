import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { connectDeviceService, type DeviceService, LocalApiError } from "../src/index.ts"
import { AGENT_DIR, credential, otherClient, ownerAt, recorder, registeredFor, registers, root, SELF, start, useRegistrantWorld } from "./registrant-support.ts"

// #12379: one register per new (proven connection, device id) pair on one held
// connection; a refused register never marks the pair registered.

useRegistrantWorld()

describe("agent dir registrant: the device pair rule (#12379)", () => {
  test("a different device id on the same connection (forget, then another sign-in) registers again; the same id does not", async () => {
    const stateDir = join(root(), "device-service")
    const owner = await ownerAt(stateDir)
    const seen = recorder()
    const first = seen.next(registeredFor(SELF), "the register for the adopted device")
    start({ stateDir, onEvent: seen.onEvent })
    await first
    const other = await otherClient(stateDir)

    const sameId = seen.next(event => event.kind === "status" && event.deviceId === "dev-self", "the status naming the same device")
    await other.setEnabled(true)
    await sameId
    expect(registers(owner)).toBe(2)

    const newDevice = seen.next(event => event.kind === "registered" && event.deviceId === "dev-new", "the register for the new device")
    await other.forget()
    await other.adopt(credential("dev-new"))

    await newDevice
    expect(registers(owner)).toBe(3)
    expect(owner.connections()).toBe(2)
  })


  test("a device change with no signed-out state in between (X -> Y) registers again on the same connection", async () => {
    const stateDir = join(root(), "device-service")
    const owner = await ownerAt(stateDir)
    const seen = recorder()
    const first = seen.next(registeredFor(SELF), "the register for the adopted device")
    start({ stateDir, onEvent: seen.onEvent })
    await first

    const newDevice = seen.next(event => event.kind === "registered" && event.deviceId === "dev-y", "the register for device Y")
    await (await otherClient(stateDir)).adopt(credential("dev-y"))

    await newDevice
    expect(registers(owner)).toBe(3)
  })


  test("the same device adopted again after a signed-out state (X -> null -> X) registers again", async () => {
    const stateDir = join(root(), "device-service")
    const owner = await ownerAt(stateDir)
    const seen = recorder()
    const first = seen.next(registeredFor(SELF), "the register for the adopted device")
    start({ stateDir, onEvent: seen.onEvent })
    await first
    const other = await otherClient(stateDir)

    const signedOut = seen.next(event => event.kind === "status" && event.deviceId === null, "the signed-out status")
    await other.forget()
    await signedOut
    const again = seen.next(event => event.kind === "registered" && event.deviceId === "dev-self", "the register for the re-adopted device")
    await other.adopt(credential("dev-self"))

    await again
    expect(registers(owner)).toBe(3)
  })


  test("a refused register never marks the pair registered: the next status for that device registers", async () => {
    const stateDir = join(root(), "device-service")
    const owner = await ownerAt(stateDir)
    let refusing = true
    const connect = async (): Promise<DeviceService> => {
      const service = await connectDeviceService({ version: "5.1.60", stateDir })
      return {
        ...service,
        registerEndpoints: async agentDir => {
          if (refusing) throw new LocalApiError("internal", "the owner could not store the list")
          await service.registerEndpoints(agentDir)
        },
      }
    }
    const seen = recorder()
    const refusedForDevice = seen.next(
      event => event.kind === "register_failed" && event.deviceId === SELF,
      "the refused register for the adopted device",
    )
    start({ stateDir, onEvent: seen.onEvent, connect })
    await refusedForDevice
    expect(owner.state.endpoints.size).toBe(0)

    refusing = false
    const registered = seen.next(registeredFor(SELF), "the register on the next status for the same device")
    await (await otherClient(stateDir)).setEnabled(true)

    await registered
    expect([...owner.state.endpoints]).toEqual([AGENT_DIR])
  })

})

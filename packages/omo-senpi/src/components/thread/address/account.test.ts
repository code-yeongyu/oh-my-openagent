import { afterEach, describe, expect, test } from "bun:test"
import { OFFLINE_PEER, PEER } from "../../../../../device-service-core/test/local-api/conformance/world.ts"
import { clientOn, closeClients, fakeClock, startOwner } from "../../remote/testing/fake-service"
import { accountDevices, accountState } from "./account"

// The account reads over a real remote client and the conformance fake owner, whose account device list does not name
// this device (as a live device service lists only the account's other devices).

afterEach(closeClients)

describe("account reads through the remote client", () => {
  test("#given a device service whose device list omits this device #when the account devices are read #then this device is named from its own id and the other devices are listed", async () => {
    const client = clientOn((await startOwner()).stateDir, fakeClock())
    const read = await accountDevices(client)
    expect(read.here).toBe("dev-self")
    expect(read.devices.map((device) => [device.device, device.online])).toEqual([
      ["dev-self", true],
      [PEER, true],
      [OFFLINE_PEER, false],
    ])
    expect(await accountState(client)).toEqual({ state: "connected", here: "dev-self" })
  })
})

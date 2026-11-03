import { afterEach, describe, expect, test } from "bun:test"
import { connect } from "@bunshin/bunshin-ts"
import { createRelayTransport, relayStatus } from "@sisyphuslabs/bunshin-ts-relay"

import { FAKE_DEVICES, startFakeDeviceService, type FakeDeviceService } from "./bunshin-ts-fake-service"

const services: FakeDeviceService[] = []
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop()
})

async function started(): Promise<FakeDeviceService> {
  const service = await startFakeDeviceService()
  services.push(service)
  return service
}

describe("bunshin-ts QA fake device service", () => {
  test("#given the fake #when the real relay client probes it #then the mutual proof verifies and the status answers connected", async () => {
    const service = await started()
    expect(await relayStatus({ stateDir: service.stateDir })).toEqual({ state: "connected", device: { id: "fake-dev-self", name: "QA device" }, connected: true })
    expect(service.authenticated()).toBe(1)
  })

  test("#given the fake #when the SDK lists machines and runs a shell op #then both devices answer over relay and each op streams host_applied before its result", async () => {
    const service = await started()
    const client = await connect({ transport: createRelayTransport({ stateDir: service.stateDir }) })
    try {
      const machines = await client.listMachines()
      expect(machines.map((machine) => [machine.alias, machine.transport])).toEqual(FAKE_DEVICES.map((device) => [device.label, "relay"]))
      const builder = await client.getMachine("builder")
      expect((await builder.shell("hostname")).stdout).toBe("builder: hostname")
    } finally {
      await client.close()
    }
    const opEvents = service.sent
      .map(({ message }) => message)
      .filter((message) => message["kind"] === "machine.op_state" || message["kind"] === "machine.op_result")
      .map((message) => (message["kind"] === "machine.op_state" ? message["state"] : "result"))
    expect(opEvents.slice(-2)).toEqual(["host_applied", "result"])
  })
})

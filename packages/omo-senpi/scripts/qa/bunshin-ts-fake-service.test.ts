import { afterEach, describe, expect, test } from "bun:test"
import { connect } from "../../vendor/bunshin-ts/index.js"
import { createRelayTransport, relayStatus } from "../../vendor/bunshin-ts-relay/index.js"

import { FAKE_DEVICES, startFakeDeviceService, type FakeDevice, type FakeDeviceService } from "./bunshin-ts-fake-service"

const services: FakeDeviceService[] = []
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop()
})

const STALLED: FakeDevice = {
  device: "fake-dev-stalled",
  label: "stalled",
  os: "linux",
  tags: [],
  describeRefusal: { code: "unsupported", reason: "fake-dev-stalled did not answer machine.describe within 10 s" },
}

async function started(devices: readonly FakeDevice[] = FAKE_DEVICES): Promise<FakeDeviceService> {
  const service = await startFakeDeviceService({ devices })
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
      expect(machines.map((machine) => [machine.alias, machine.transport])).toEqual([...FAKE_DEVICES.map((device) => [device.label, "relay"]), ["QA device", "relay"]])
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

  test("#given one device whose describe the service refuses #when the SDK connects, lists and fans out #then every machine is listed, that one and this device unsupported, and fanout skips them while the others answer", async () => {
    const service = await started([...FAKE_DEVICES, STALLED])
    const client = await connect({ transport: createRelayTransport({ stateDir: service.stateDir }) })
    try {
      const machines = await client.listMachines()
      expect(machines.map((machine) => [machine.alias, machine.unsupported === true])).toEqual([
        ["builder", false],
        ["laptop", false],
        ["stalled", true],
        ["QA device", true],
      ])
      expect(machines.find((machine) => machine.alias === "stalled")?.attention).toMatch(
        /^unreachable after \d+ ms: unsupported: fake-dev-stalled did not answer machine\.describe within 10 s$/,
      )
      const result = await client.fanout("all", (machine) => machine.shell("hostname"))
      expect(result.fulfilled.map((outcome) => [outcome.machine.alias, outcome.value.stdout])).toEqual([
        ["builder", "builder: hostname"],
        ["laptop", "laptop: hostname"],
      ])
      expect(result.rejected).toEqual([])
      expect((result.skipped ?? []).map((outcome) => [outcome.machine.alias, outcome.reason])).toEqual([
        ["stalled", "machine_unsupported"],
        ["QA device", "machine_unsupported"],
      ])
    } finally {
      await client.close()
    }
  })
})

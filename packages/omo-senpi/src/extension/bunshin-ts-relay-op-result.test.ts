import { afterEach, describe, expect, it } from "bun:test"

import { connect } from "../../vendor/bunshin-ts/index.js"
import { createRelayTransport } from "../../vendor/bunshin-ts-relay/index.js"
import {
  startFakeDeviceService,
  type FakeDeviceService,
  type OpExecutor,
} from "../../scripts/qa/bunshin-ts-fake-service"

import { createLazyBunshinClient } from "./bunshin-ts-default-client"
import { BunshinSessionError } from "./bunshin-ts-errors"

const services: FakeDeviceService[] = []
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop()
})

async function started(execute?: OpExecutor): Promise<FakeDeviceService> {
  const service = await startFakeDeviceService(execute === undefined ? {} : { execute })
  services.push(service)
  return service
}

const frozenDevice: OpExecutor = () => ({
  state: "timed_out",
  error: { code: "timeout", message: "the device did not answer before the deadline", uncertain: true },
})

describe("bunshin-ts relay op results through the vendored relay transport", () => {
  it("#given a frozen device whose op result is an uncertain timeout #when the SDK runs an op #then it fails typed as timeout with uncertain true and a resultOf next action", async () => {
    const service = await started(frozenDevice)
    const client = createLazyBunshinClient(async () =>
      connect({ transport: createRelayTransport({ stateDir: service.stateDir }) }),
    )
    try {
      const builder = await client.getMachine("builder")
      const caught: unknown = await builder.shell("hostname").then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(caught).toBeInstanceOf(BunshinSessionError)
      const failure = caught as BunshinSessionError
      expect(failure.code).toBe("timeout")
      expect(failure.uncertain).toBe(true)
      expect(failure.next_action).toContain("bunshin.resultOf(")
      expect(failure.toJSON().uncertain).toBe(true)
    } finally {
      await client.close()
    }
  })

  it("#given a 15 s terminal timeout #when the relay transport sends the op #then deadline_ms on the wire is an absolute time, not the duration", async () => {
    const service = await started()
    const transport = createRelayTransport({ stateDir: service.stateDir })
    await transport.connect()
    try {
      const builder = (await transport.listMachines()).find((machine) => machine.alias === "builder")
      if (builder === undefined) throw new Error("the fake lists no builder")
      const before = Date.now()
      await transport.invoke(builder.id, "shell", { kind: "shell", command: "hostname" }, undefined, 15_000)
      const after = Date.now()
      const ops = service.requests
        .filter((request) => request["type"] === "machine.batch")
        .flatMap((request) => (Array.isArray(request["ops"]) ? request["ops"] : []))
      expect(ops).toHaveLength(1)
      const deadline: unknown = ops[0]?.["deadline_ms"]
      expect(typeof deadline).toBe("number")
      expect(deadline as number).toBeGreaterThanOrEqual(before + 15_000)
      expect(deadline as number).toBeLessThanOrEqual(after + 15_000)
    } finally {
      await transport.close()
    }
  })
})

import { describe, expect, test } from "bun:test"
import type { CommandResult, DeviceService, RemoteAttach } from "@oh-my-opencode/device-service-core"
import { createDeviceServiceSessions } from "./device-service"

// omo#13037 A6 addendum 3: the wake mark follows the service this connection reached. A reconnect to an older service
// (its welcome below the gate) stops the mark at once; nothing is remembered from the connection before.

type Fake = { readonly service: DeviceService; readonly close: () => void; readonly marks: unknown[] }

function fakeService(carriesWakeMark: boolean): Fake {
  let close!: () => void
  const closed = new Promise<void>((resolve) => {
    close = resolve
  })
  const marks: unknown[] = []
  const applied: CommandResult = {
    outcome: { kind: "session.command_state", command_id: "c", state: "engine_applied", retryable: false },
    response: { type: "response", success: true, data: { kind: "started", turnId: "1" } },
  } as unknown as CommandResult
  const attached = {
    detached: new Promise(() => {}),
    onEvent: () => () => {},
    command: async (_rpc: unknown, options?: unknown) => {
      marks.push(options)
      return applied
    },
  } as unknown as RemoteAttach
  const service = {
    serviceVersion: carriesWakeMark ? "1.4.0" : "1.3.9",
    carriesWakeMark,
    takesSingleLocate: carriesWakeMark,
    closed,
    attach: async () => attached,
    close: () => close(),
  } as unknown as DeviceService
  return { service, close, marks }
}

describe("omo#13037: the wake gate is read per connection", () => {
  test("#given a connection to a service that carries the mark, then a reconnect to an older one #then the delivery is marked on the first and not on the second", async () => {
    const services = [fakeService(true), fakeService(false)]
    let next = 0
    const port = createDeviceServiceSessions({
      version: "5.1.70",
      connect: async () => {
        const fake = services[next]
        next += 1
        if (fake === undefined) throw new Error("no more connections")
        return fake.service
      },
    })
    const admit = { type: "admit_external_message", sessionId: "s", deliveryId: "d", text: "t" }
    expect(await port.canWake?.()).toBe(true)
    await port.sessionCommand("b", "s", admit)
    services[0]?.close()
    await services[0]?.service.closed
    expect(await port.canWake?.()).toBe(false)
    await port.sessionCommand("b", "s", admit)
    expect(services.map((fake) => fake.marks)).toEqual([[{ accepts: ["session-wake:v1"] }], [undefined]])
  })
})

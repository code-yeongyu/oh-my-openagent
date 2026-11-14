import { afterEach, describe, expect, test } from "bun:test"
import { connectDeviceService, type DeviceService, LocalApiError } from "../src/index.ts"
import { type FakeClock, fakeClock } from "./local-api/conformance/fake-clock.ts"
import type { FakeOwner } from "./local-api/conformance/fake-owner.ts"
import { defaultWorld, PEER, SESSION_ID, type World } from "./local-api/conformance/world.ts"
import { cleanup, startModeOwner as startMode } from "./local-api/support.ts"

// The device service's clock seam (design one-remote-module v6 section 9): every wait of a connection, the local API's
// handshake and request bounds included, runs on the `timers` it was given, so each bound fires on a fake clock.

const services: DeviceService[] = []

afterEach(async () => {
  for (const service of services.splice(0)) service.close()
  await cleanup()
})

const serviceOn = async (owner: FakeOwner, clock: FakeClock): Promise<DeviceService> => {
  const service = await connectDeviceService({ version: "5.1.70", stateDir: owner.stateDir, timers: clock })
  services.push(service)
  return service
}

const outcomeOf = (promise: Promise<unknown>): Promise<string> =>
  promise.then(
    () => "settled",
    (error: unknown) =>
      error instanceof LocalApiError ? error.code : error instanceof Error ? error.message : String(error),
  )

describe("device service clock seam", () => {
  test("the handshake bound runs on the given timers", async () => {
    const clock = fakeClock()
    const { owner, withheld } = await startMode("silent-handshake")
    const connecting = outcomeOf(connectDeviceService({ version: "5.1.70", stateDir: owner.stateDir, timers: clock }))
    await withheld("welcome")
    clock.advance(10_000)
    expect(await connecting).toBe("handshake_timeout")
  })

  test("the request bound runs on the given timers", async () => {
    const clock = fakeClock()
    const { owner, withheld } = await startMode("silent-requests")
    const service = await serviceOn(owner, clock)
    const asking = outcomeOf(service.devices())
    await withheld("response")
    clock.advance(30_000)
    expect(await asking).toBe("request_timeout")
  })

  test("an endpoint command with no final state fails at its 120 s bound on the given timers", async () => {
    const clock = fakeClock()
    const world: World = {
      ...defaultWorld(),
      endpoints: { [PEER]: ["ZW5kcG9pbnQta2V5LTAwMQ"] },
      endpointCommand: { data: {}, outcome: defaultWorld().sessions[0]?.outcome ?? [] },
    }
    const { owner, withheld } = await startMode("ack-no-final", world)
    const service = await serviceOn(owner, clock)
    const sending = outcomeOf(service.endpointCommand(PEER, { type: "prompt", message: "hi" }))
    await withheld("final_state")
    await service.status()
    clock.advance(119_999)
    expect(clock.armed()).toBe(1)
    clock.advance(1)
    expect(await sending).toMatch(/^no final state for endpoint command \S+ within 120000 ms$/)
  })

  test("a command in flight when its attach ends waits 30 s on the given timers", async () => {
    const clock = fakeClock()
    const { owner, withheld } = await startMode("ack-no-final")
    const service = await serviceOn(owner, clock)
    const attach = await service.attach(PEER, SESSION_ID)
    await attach.snapshot
    const commanding = outcomeOf(attach.command({ type: "get_state" }))
    await withheld("final_state")
    await attach.detach()
    clock.advance(29_999)
    expect(clock.armed()).toBe(1)
    clock.advance(1)
    expect(await commanding).toBe("the attach ended before the command settled: detached")
  })
})

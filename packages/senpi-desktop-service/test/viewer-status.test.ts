import { afterEach, describe, expect, it } from "vitest"
import { DesktopService } from "../src/service/service"
import { fakeEngineFactory, type SpawnLog } from "./harness"

// Every case waits on real child-process I/O; the guard only catches a hang, it never times behavior.
const HANG_GUARD = { timeout: 30_000 }

const services: DesktopService[] = []

async function openedOver(log: SpawnLog): Promise<DesktopService> {
  const service = new DesktopService({ createChild: log.factory })
  services.push(service)
  await service.open({})
  return service
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()))
})

describe("DesktopService viewer status", HANG_GUARD, () => {
  it("has no viewer status from an engine that answers -32601 for session.viewerStatus", async () => {
    // Given
    const log = fakeEngineFactory({ FAKE_ENGINE_PICTURE_STATE: "unsupported" })
    const service = await openedOver(log)

    // When
    const status = await service.viewerStatus()

    // Then
    expect({ status, asked: (await log.nthRequest("session.viewerStatus", 1)).method }).toEqual({
      status: undefined,
      asked: "session.viewerStatus",
    })
  })

  it("sends no viewer status read for a tool call that was already aborted", async () => {
    // Given
    const log = fakeEngineFactory()
    const service = await openedOver(log)

    // When
    const status = await service.viewerStatus(AbortSignal.abort())

    // Then
    expect({ status, sent: log.requests.some((request) => request.method === "session.viewerStatus") }).toEqual({
      status: undefined,
      sent: false,
    })
  })

  it("settles an in-flight viewer status read with no status when the tool call aborts", async () => {
    // Given: the engine holds the read until it is cancelled, so only the abort can settle it before the timeout.
    const log = fakeEngineFactory({ FAKE_ENGINE_STALL: "session.viewerStatus" })
    const service = await openedOver(log)
    const abort = new AbortController()
    const pending = service.viewerStatus(abort.signal)
    const sent = await log.nthRequest("session.viewerStatus", 1)

    // When
    abort.abort()

    // Then
    expect(await pending).toBeUndefined()
    expect((await log.nthRequest("$/cancel", 1)).params).toEqual({ id: sent.id })
  })
})

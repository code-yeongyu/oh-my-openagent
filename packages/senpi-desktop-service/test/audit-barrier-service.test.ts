import { afterEach, describe, expect, it, vi } from "vitest"
import { RpcClient } from "../src/service/rpc-client"
import { DesktopService } from "../src/service/service"
import { fakeEngineFactory } from "./harness"

const services: DesktopService[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(services.splice(0).map((service) => service.close()))
})

describe("DesktopService.auditBarrier", () => {
  it("sends its engine round trip with the call's signal and remaining time", async () => {
    // Given: an open session whose requests are observed at the rpc client
    const service = new DesktopService({ createChild: fakeEngineFactory({ FAKE_ENGINE_DESKTOP: "1" }).factory })
    services.push(service)
    await service.open({})
    const request = vi.spyOn(RpcClient.prototype, "request")
    const signal = new AbortController().signal

    // When
    await service.auditBarrier({ signal, timeoutMs: 1234 })

    // Then
    expect(request).toHaveBeenCalledWith("stopPath.status", {}, { signal, timeoutMs: 1234 })
  })
})

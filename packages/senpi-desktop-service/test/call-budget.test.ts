import { afterEach, describe, expect, it } from "vitest"
import { DesktopCallBudgetError } from "../src/service/call-budget"
import { DesktopService } from "../src/service/service"
import { fakeEngineFactory, rejectionOf } from "./harness"

const services: DesktopService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()))
})

describe("per-session desktop call budget", { timeout: 30_000 }, () => {
  it("refuses the first request past the budget with a typed error and sends it nowhere", async () => {
    // Given: a session allowed two desktop requests
    const log = fakeEngineFactory({ FAKE_ENGINE_DESKTOP: "1" })
    const service = new DesktopService({ createChild: log.factory, callBudget: 2 })
    services.push(service)
    await service.open({})
    await service.call("windows", {})
    await service.call("displays", {})

    // When
    const error = await rejectionOf(service.call("windows", {}))

    // Then
    expect(error).toBeInstanceOf(DesktopCallBudgetError)
    expect(error).toMatchObject({ reason: "CallBudgetExceeded", limit: 2 })
    expect(log.requests.filter((request) => request.method === "windows")).toHaveLength(1)
  })

  it("refuses before an engine starts when the budget is spent", async () => {
    // Given: a session with no budget at all
    const log = fakeEngineFactory({ FAKE_ENGINE_DESKTOP: "1" })
    const service = new DesktopService({ createChild: log.factory, callBudget: 0 })
    services.push(service)

    // When
    const error = await rejectionOf(service.call("windows", {}))

    // Then
    expect(error).toMatchObject({ reason: "CallBudgetExceeded", limit: 0 })
    expect(log.children).toHaveLength(0)
  })
})

import { afterEach, describe, expect, it, vi } from "vitest"
import { ComputerError, connect } from "../src/index"
import type { SpawnLaunch } from "../src/connect"
import { type FakePort, fakeEnginePort } from "./fake-port"

const ports: FakePort[] = []

function fakeLaunch(): SpawnLaunch & { readonly mock: { readonly calls: readonly unknown[][] } } {
  return vi.fn<SpawnLaunch>(async () => {
    const port = fakeEnginePort()
    ports.push(port)
    return port
  })
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(ports.splice(0).map((port) => port.close()))
})

describe("connect spawn", () => {
  it("#given an injected launch over the fake engine #when listing windows #then the child's windows come back", async () => {
    vi.stubEnv("SENPI_DESKTOP_HOST", "")
    const launch = fakeLaunch()
    const settings = { reportMode: "object" }

    const computer = await connect({ kind: "spawn", launch, settings })
    const windows = await computer.windows()

    expect(launch).toHaveBeenCalledTimes(1)
    expect(launch.mock.calls[0]).toEqual([settings])
    expect(windows.map((window) => [window.id, window.app])).toEqual([
      ["101", "Code"],
      ["202", "Mail"],
    ])
    await computer.close()
  })

  it("#given a spawned computer #when closed #then the port it owns is closed too", async () => {
    vi.stubEnv("SENPI_DESKTOP_HOST", "")
    const close = vi.fn(async () => undefined)
    const launch: SpawnLaunch = async () => {
      const port = fakeEnginePort()
      ports.push(port)
      return { ...port, close: async () => close() }
    }

    const computer = await connect({ kind: "spawn", launch })
    await computer.close()

    expect(close).toHaveBeenCalledTimes(1)
    await expect(computer.windows()).rejects.toMatchObject({ code: "Closed", nothingSent: true })
  })

  it("#given the in-session marker #when spawning #then ControlRequired spawn_inside_session is thrown before launch runs", async () => {
    vi.stubEnv("SENPI_DESKTOP_HOST", "1")
    const launch = fakeLaunch()

    const refused = await connect({ kind: "spawn", launch }).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(refused).toBeInstanceOf(ComputerError)
    expect(refused).toMatchObject({
      code: "ControlRequired",
      nothingSent: true,
      data: { reason: "spawn_inside_session" },
    })
    expect(launch).toHaveBeenCalledTimes(0)
  })

  it("#given a launch that rejects #when spawning #then a not-delivered Internal ComputerError carries the cause", async () => {
    vi.stubEnv("SENPI_DESKTOP_HOST", "")
    const cause = new Error("engine binary missing")

    const refused = await connect({ kind: "spawn", launch: async () => Promise.reject(cause) }).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(refused).toBeInstanceOf(ComputerError)
    expect(refused).toMatchObject({ code: "Internal", nothingSent: true, data: { reason: "launch_failed" }, cause })
  })
})

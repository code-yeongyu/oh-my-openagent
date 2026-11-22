import { afterAll, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { deviceServiceStateDir } from "@oh-my-opencode/device-service-core/state-dir"

import type { MachineHubTransport } from "../../vendor/bunshin-ts/index.js"

import { BunshinSessionError, pickTransport, type PickTransportDeps } from "./bunshin-ts-pick-transport"

const hubTransport = { kind: "hub" } as const satisfies Partial<MachineHubTransport>

const home = mkdtempSync(join(tmpdir(), "pick-transport-"))
afterAll(() => rmSync(home, { recursive: true, force: true }))

function deps(options: {
  connected: boolean
  hub?: "bundled" | "bundled-without-config"
  home?: string
}): PickTransportDeps & { probes: string[] } {
  const probes: string[] = []
  return {
    probes,
    home: options.home ?? home,
    relayStatus: async (status) => {
      probes.push(status?.stateDir ?? "<default>")
      return { connected: options.connected }
    },
    ...(options.hub === undefined
      ? {}
      : {
          hub: {
            configResolves: async () => options.hub === "bundled",
            create: () => hubTransport as unknown as MachineHubTransport,
          },
        }),
  }
}

async function errorCode(run: Promise<unknown>): Promise<string> {
  const error = await run.then(
    () => undefined,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(BunshinSessionError)
  return (error as BunshinSessionError).code
}

describe("bunshin-ts pickTransport", () => {
  it("#given no choice and a connected device service #when picked #then the relay transport is returned", async () => {
    const seams = deps({ connected: true, hub: "bundled" })
    const transport = await pickTransport({ OMO_DEVICE_SERVICE_STATE_DIR: "/state" }, seams)
    expect(transport.kind).toBe("relay")
    expect(seams.probes).toEqual(["/state"])
  })

  it("#given no choice, a disconnected service and a bundled hub with config #when picked #then the hub transport is returned", async () => {
    const transport = await pickTransport({ BUNSHIN_TS_TRANSPORT: "auto" }, deps({ connected: false, hub: "bundled" }))
    expect(transport.kind).toBe("hub")
  })

  it("#given no choice, a disconnected service and no usable hub #when picked #then no_transport is thrown", async () => {
    expect(await errorCode(pickTransport({}, deps({ connected: false })))).toBe("no_transport")
    expect(await errorCode(pickTransport({}, deps({ connected: false, hub: "bundled-without-config" })))).toBe(
      "no_transport",
    )
  })

  it("#given relay forced while the service is disconnected #when picked #then a relay transport is returned without a probe", async () => {
    const seams = deps({ connected: false })
    const transport = await pickTransport({ BUNSHIN_TS_TRANSPORT: "relay" }, seams)
    expect(transport.kind).toBe("relay")
    expect(seams.probes).toEqual([])
  })

  it("#given hub forced in a build without the hub transport #when picked #then hub_not_bundled is thrown", async () => {
    expect(await errorCode(pickTransport({ BUNSHIN_TS_TRANSPORT: "hub" }, deps({ connected: true })))).toBe(
      "hub_not_bundled",
    )
  })

  it("#given a relative OMO_DEVICE_SERVICE_STATE_DIR #when picked #then the probe asks the default state dir", async () => {
    const seams = deps({ connected: true })
    await pickTransport({ OMO_DEVICE_SERVICE_STATE_DIR: "rel/dir" }, seams)
    expect(seams.probes).toEqual([deviceServiceStateDir(process.platform, {}, home)])
  })

  it("#given no variable and a discovery file naming a state dir #when picked #then the probe asks that dir", async () => {
    const own = mkdtempSync(join(home, "h-"))
    const alt = join(own, "alt")
    mkdirSync(alt)
    const serviceHome = dirname(deviceServiceStateDir(process.platform, {}, own))
    mkdirSync(serviceHome, { recursive: true })
    writeFileSync(join(serviceHome, "device-service.location.json"), JSON.stringify({ v: 1, state_dir: alt }))
    const seams = deps({ connected: true, home: own })
    await pickTransport({}, seams)
    expect(seams.probes).toEqual([alt])
  })

  it("#given an unknown choice #when picked #then bad_choice is thrown", async () => {
    expect(await errorCode(pickTransport({ BUNSHIN_TS_TRANSPORT: "nonsense" }, deps({ connected: true })))).toBe(
      "bad_choice",
    )
  })
})

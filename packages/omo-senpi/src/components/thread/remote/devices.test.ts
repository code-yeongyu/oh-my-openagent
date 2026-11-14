import { describe, expect, test } from "bun:test"

import { matchDevice, withOneDeviceListing } from "./devices"
import type { RemoteThreadSurface } from "./ports"

// #13432: one device resolver for the thread tools and omo remote: the id, else the name, else a unique prefix of
// either. Two devices that answer the same way are ambiguous_device naming each; no match is device_unknown.

const rows = [
  { device: "dev-7f3a", label: "studio", online: true },
  { device: "dev-91c2", label: "laptop", online: false },
  { device: "dev-a001", label: "lab-1", online: true },
  { device: "dev-a002", label: "lab-2", online: true },
] as const

describe("matchDevice", () => {
  test("#given an exact id no other device has as its name #when matched #then that device", () => {
    expect(matchDevice(rows, "dev-91c2")).toMatchObject({ kind: "ok", row: { device: "dev-91c2" } })
  })

  test("#given an id that is also another device's name #when matched #then ambiguous_device naming both", () => {
    const hit = matchDevice(
      [
        { device: "studio", label: "old box", online: false },
        { device: "dev-7f3a", label: "studio", online: true },
      ],
      "studio",
    )
    expect(hit).toMatchObject({ kind: "error", error: { code: "ambiguous_device" } })
    if (hit.kind !== "error") throw new Error("expected a refusal")
    expect(hit.error.details?.["candidates"]).toEqual([
      { device: "studio", label: "old box" },
      { device: "dev-7f3a", label: "studio" },
    ])
  })

  test("#given a name that is also a prefix of another device #when matched #then ambiguous_device naming both", () => {
    const hit = matchDevice(
      [
        { device: "d1", label: "mac", online: true },
        { device: "d2", label: "macbook", online: true },
      ],
      "mac",
    )
    expect(hit).toMatchObject({ kind: "error", error: { code: "ambiguous_device" } })
    if (hit.kind !== "error") throw new Error("expected a refusal")
    expect(hit.error.details?.["candidates"]).toEqual([
      { device: "d1", label: "mac" },
      { device: "d2", label: "macbook" },
    ])
  })

  test("#given an id that prefixes another id #when matched #then the id still names its device", () => {
    const hit = matchDevice(
      [
        { device: "dev-1", label: "one", online: true },
        { device: "dev-10", label: "ten", online: true },
      ],
      "dev-1",
    )
    expect(hit).toMatchObject({ kind: "ok", row: { device: "dev-1" } })
  })

  test("#given a name no id equals #when matched #then the device with that name", () => {
    expect(matchDevice(rows, "laptop")).toMatchObject({ kind: "ok", row: { device: "dev-91c2" } })
  })

  test("#given a unique prefix of an id or a name #when matched #then that device", () => {
    expect(matchDevice(rows, "dev-7")).toMatchObject({ kind: "ok", row: { device: "dev-7f3a" } })
    expect(matchDevice(rows, "lap")).toMatchObject({ kind: "ok", row: { device: "dev-91c2" } })
  })

  test("#given a prefix two devices share #when matched #then ambiguous_device naming each, never a pick", () => {
    const hit = matchDevice(rows, "lab")
    expect(hit).toMatchObject({ kind: "error", error: { code: "ambiguous_device" } })
    if (hit.kind !== "error") throw new Error("expected a refusal")
    expect(hit.error.details?.["candidates"]).toEqual([
      { device: "dev-a001", label: "lab-1" },
      { device: "dev-a002", label: "lab-2" },
    ])
    expect(hit.error.next_action.length).toBeGreaterThan(0)
  })

  test("#given a name two devices share #when matched #then ambiguous_device", () => {
    const twins = [
      { device: "d1", label: "mac", online: true },
      { device: "d2", label: "mac", online: true },
    ]
    expect(matchDevice(twins, "mac")).toMatchObject({ kind: "error", error: { code: "ambiguous_device" } })
  })

  test("#given nothing matches or an empty name #when matched #then device_unknown", () => {
    expect(matchDevice(rows, "nowhere")).toMatchObject({
      kind: "error",
      error: { code: "device_unknown", details: { device: "nowhere" } },
    })
    expect(matchDevice(rows, "")).toMatchObject({ kind: "error", error: { code: "device_unknown" } })
  })
})

describe("withOneDeviceListing", () => {
  test("#given a wrapped surface #when listed twice and spread #then one listing and every other method kept", async () => {
    let listings = 0
    const sessions = {
      devices: async () => {
        listings++
        return [{ device: "b", label: "studio", online: true }]
      },
      thisDevice: async () => "here",
    } as unknown as RemoteThreadSurface["sessions"]
    const wrapped = withOneDeviceListing({ sessions, chain: { stamp: (record) => record } } as RemoteThreadSurface)
    await wrapped.sessions.devices()
    await wrapped.sessions.devices()
    const copy = { ...wrapped.sessions }
    expect(listings).toBe(1)
    expect(await copy.thisDevice()).toBe("here")
  })
})

import { describe, expect, test } from "bun:test"
import { B, createTwoDevices, NAMES, T } from "../thread/address/testing/two-devices"
import type { RemoteClient } from "./client"
import { resolveTypedDevice } from "../thread/address"
import { resolveTypedAddress } from "./device-address"
import type { DeviceRow, RemoteFailure } from "./types"

// resolveTypedDevice (thread/address/device.ts) reads the account's devices once (host_unavailable when it cannot) and
// hands thread_create's resolver failures through by their own type (#13432).

const device = (id: string, name: string, online: boolean): DeviceRow => ({
  id,
  name,
  platform: "linux",
  online,
  last_seen_ms: null,
  caps: { attach: true, machine: true, control: true },
})

// resolveTypedDevice reads only devices.list; every other member of the client is out of its reach.
const clientListing = (listed: readonly DeviceRow[] | RemoteFailure): RemoteClient =>
  ({
    devices: { list: async () => ("kind" in listed ? listed : { kind: "ok", value: listed }) },
  }) as unknown as RemoteClient

describe("resolveTypedAddress", () => {
  test("#given a thread name on another device #when the typed address resolves #then it answers the thread, its row and its address", async () => {
    const td = createTwoDevices()
    try {
      const resolved = await resolveTypedAddress(td.remote, NAMES.bLive, { need: "address" })
      expect(resolved.kind).toBe("ok")
      if (resolved.kind !== "ok") return
      expect({ thread: resolved.thread, address: resolved.address, resolution: resolved.resolution }).toEqual({
        thread: T.bLive,
        address: `b7c41e09d2a64f1e/${T.bLive}`,
        resolution: "name",
      })
      expect(resolved.where.kind === "device" ? resolved.where.row.session_id : undefined).toBe("rk-b-live")
    } finally {
      await td.cleanup()
    }
  })

  // Every omo remote verb that needs its device online (attach, model, interrupt, close) passes need: "online".
  test("#given an offline device named by its name #when a thread on it resolves with need online #then device_offline, naming that device", async () => {
    const td = createTwoDevices({ bOffline: true })
    try {
      const resolved = await resolveTypedAddress(td.remote, `${B.name}/${T.bLive}`, { need: "online" })
      expect(resolved).toMatchObject({ kind: "error", error: { code: "device_offline", details: { device: B.id } } })
    } finally {
      await td.cleanup()
    }
  })

  test("#given a name no device holds #when the typed address resolves #then the refusal passes through typed", async () => {
    const td = createTwoDevices()
    try {
      const resolved = await resolveTypedAddress(td.remote, "nowhere", { need: "online" })
      expect(resolved).toMatchObject({ kind: "error", error: { code: "not_found" } })
    } finally {
      await td.cleanup()
    }
  })
})

describe("resolveTypedDevice", () => {
  test("#given a device service that cannot list devices #when a name is resolved #then it answers host_unavailable naming what was typed", async () => {
    const failure: RemoteFailure = {
      kind: "error",
      code: "host_unavailable",
      message: "socket closed",
      next_action: "retry",
    }
    expect(await resolveTypedDevice(clientListing(failure), "studio")).toEqual({
      kind: "error",
      error: {
        code: "host_unavailable",
        message: "This device's device service could not list the account's devices.",
        next_action: "Retry when the device service is reachable.",
        details: { device: "studio", reason: "socket closed" },
      },
    })
  })

  test("#given two online devices sharing a name #when that name is resolved #then the resolver's ambiguous_target comes back with its candidates", async () => {
    const result = await resolveTypedDevice(
      clientListing([device("dev-aaaaaa", "Studio", true), device("dev-bbbbbb", "studio", true)]),
      "studio",
    )
    expect(result).toMatchObject({
      kind: "error",
      error: {
        code: "ambiguous_target",
        details: {
          device: "studio",
          candidates: [
            { device: "dev-aaaaaa", name: "Studio", online: true },
            { device: "dev-bbbbbb", name: "studio", online: true },
          ],
        },
      },
    })
  })

  test("#given a device's name #when it is resolved #then the answer is its id with the listing it was read from", async () => {
    const result = await resolveTypedDevice(
      clientListing([device("dev-aaaaaa", "Studio", true), device("dev-bbbbbb", "Laptop", true)]),
      "Laptop",
    )
    expect(result).toEqual({
      kind: "ok",
      device: "dev-bbbbbb",
      devices: [
        { device: "dev-aaaaaa", label: "Studio", online: true },
        { device: "dev-bbbbbb", label: "Laptop", online: true },
      ],
    })
  })

  // #14318 review H2: every omo remote verb (attach included) needs the device online, so an offline device is refused
  // at resolution by every form, before any work starts.
  test.each([
    ["its name", "Attic"],
    ["its id", "dev-cccccc"],
  ])(
    "#given an offline device named by %s #when it is resolved #then device_offline, before any work",
    async (_form, typed) => {
      const result = await resolveTypedDevice(
        clientListing([device("dev-aaaaaa", "Studio", true), device("dev-cccccc", "Attic", false)]),
        typed,
      )
      expect(result).toMatchObject({
        kind: "error",
        error: { code: "device_offline", details: { device: "dev-cccccc" } },
      })
    },
  )

  test("#given two offline devices sharing a name #when the name is resolved #then device_offline, not ambiguous_target", async () => {
    const result = await resolveTypedDevice(
      clientListing([device("dev-dddddd", "box", false), device("dev-eeeeee", "box", false)]),
      "box",
    )
    expect(result).toMatchObject({ kind: "error", error: { code: "device_offline" } })
  })
})

import { describe, expect, test } from "bun:test"
import type { RemoteClient } from "./client"
import { resolveTypedDevice } from "./device-address"
import type { DeviceRow, RemoteFailure } from "./types"

// resolveTypedDevice reads the account's devices once through the shared remote-ops listing (the same host_unavailable
// deviceOnline answers) and hands thread_create's resolver failures through by their own type (#13432).

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
})

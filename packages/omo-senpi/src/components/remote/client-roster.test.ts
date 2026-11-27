import { afterEach, describe, expect, test } from "bun:test"
import { defaultWorld, PEER, type World } from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { clientOn, closeClients, failureOf, fakeClock, startOwner } from "./testing/fake-service"
import type { RemoteClient } from "./client"

// The client's side of #13402 (the `omo remote devices` / `sessions --device` fixes): this device's row follows the
// service's connection state and invents no kind, and a device filter naming no device of the account is not_found
// instead of an empty list. Each world is the conformance fake owner's default world with one field changed.

afterEach(closeClients)

const onWorld = async (world: World): Promise<RemoteClient> => clientOn((await startOwner(world)).stateDir, fakeClock())

const valueOf = <T>(outcome: { readonly kind: "ok"; readonly value: T } | { readonly kind: "error" }): T => {
  if (outcome.kind !== "ok") throw new Error(`expected a value, got ${JSON.stringify(outcome)}`)
  return outcome.value
}

const offline = (world: World): World => ({ ...world, status: { ...world.status, state: "offline" } })

describe("devices.list: this device's row", () => {
  test("#given a service that is not connected #when devices.list reads #then this device is offline, with no last-seen time and no invented kind", async () => {
    const [here] = valueOf(await (await onWorld(offline(defaultWorld()))).devices.list())
    expect(here).toStrictEqual({
      id: "dev-self",
      name: "This Mac",
      platform: process.platform,
      online: false,
      last_seen_ms: null,
      self: true,
      caps: { attach: true, machine: false, control: true },
    })
  })

  test("#given a roster that lists this device as online while the service is not connected #when devices.list reads #then the row keeps the roster's kind but is offline with no last-seen time", async () => {
    const world = defaultWorld()
    const listed = {
      device: "dev-self",
      label: "This Mac",
      kind: "desktop",
      platform: "darwin",
      last_seen_ms: 1_790_000_000_000,
      online: true,
    }
    const [here] = valueOf(
      await (await onWorld(offline({ ...world, devices: [listed, ...world.devices] }))).devices.list(),
    )
    expect(here).toMatchObject({ id: "dev-self", kind: "desktop", self: true, online: false, last_seen_ms: null })
  })
})

describe("sessions.list: the device filter", () => {
  test("#given a device filter naming no device of the account #when sessions.list reads #then not_found names the device, not an empty list; this device's own id still lists", async () => {
    const client = await onWorld(defaultWorld())
    expect(failureOf(await client.sessions.list({ device: "no-such-device" }))).toMatchObject({
      code: "not_found",
      details: { kind: "device", id: "no-such-device" },
    })
    expect(valueOf(await client.sessions.list({ device: "dev-self" })).rows).toEqual([])
  })

  test("#given a roster that misses a device the listing still has rows for #when sessions.list filters on it #then those rows come back", async () => {
    const world = defaultWorld()
    const client = await onWorld({ ...world, devices: world.devices.filter((device) => device.device !== PEER) })
    const list = valueOf(await client.sessions.list({ device: PEER }))
    expect(list.rows.map((row) => row.device.id)).toEqual([PEER])
  })
})

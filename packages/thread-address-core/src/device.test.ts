import { describe, expect, test } from "bun:test"
import { resolveDevice, resolveDeviceRow } from "."
import type { DeviceRow } from "./refusals"

const devices: readonly DeviceRow[] = [
  { id: "here", name: "this mac", online: true },
  { id: "b7c41e09d2a64f1e", name: "Studio Laptop", online: true },
  { id: "b7c4aaaa00000000", name: "studio", online: false, last_seen_ms: 5 },
  { id: "c0ffee5a1d2b3c4d", name: "attic", online: false, last_seen_ms: 7 },
  { id: "d00d000000000001", name: "twin", online: false },
  { id: "d00d000000000002", name: "Twin", online: true },
]
const account = { here: "here", devices }

const id = (text: string, online = false) => {
  const resolved = resolveDevice(account, text, { online })
  return resolved.kind === "ok" ? resolved.device.id : resolved.refusal.code
}

describe("#given the account's devices #when resolveDevice reads a device part #then exact id > here > name > unique id prefix", () => {
  test.each([
    ["an exact id", "b7c41e09d2a64f1e", "b7c41e09d2a64f1e"],
    ["here", "here", "here"],
    ["this device's name", "THIS  mac", "here"],
    ["a name, NFKC and case folded", "ｓｔｕｄｉｏ ｌａｐｔｏｐ", "b7c41e09d2a64f1e"],
    ["a name an online and an offline device share: the online one", "twin", "d00d000000000002"],
    ["a unique 6+ character id prefix", "c0ffee", "c0ffee5a1d2b3c4d"],
    ["a prefix shorter than 6 characters", "c0ffe", "not_found"],
    ["a name only an offline device carries, online not needed", "attic", "c0ffee5a1d2b3c4d"],
    ["nothing", "nowhere", "not_found"],
  ])("%s", (_label, text, expected) => {
    expect(id(text)).toBe(expected)
  })

  test("#given two devices sharing a 6+ id prefix #when it is resolved #then ambiguous_target names both", () => {
    expect(resolveDevice(account, "d00d00", { online: false })).toMatchObject({
      kind: "refusal",
      refusal: { code: "ambiguous_target", details: { kind: "device" } },
    })
  })

  test("#given an offline device by id #when the caller needs it online #then device_offline with its name and last_seen", () => {
    expect(resolveDevice(account, "c0ffee5a1d2b3c4d", { online: true })).toMatchObject({
      kind: "refusal",
      refusal: { code: "device_offline", details: { device: "c0ffee5a1d2b3c4d", device_name: "attic", last_seen: 7 } },
    })
    expect(id("c0ffee5a1d2b3c4d")).toBe("c0ffee5a1d2b3c4d")
  })

  test("#given a resolved device #when read #then it says whether it is this device and how this round listed it", () => {
    const resolved = resolveDevice({ ...account, listingOf: () => "incomplete" }, "studio laptop", { online: false })
    expect(resolved).toEqual({
      kind: "ok",
      device: { id: "b7c41e09d2a64f1e", name: "Studio Laptop", online: true, here: false, listing: "incomplete" },
    })
  })

  test.each([
    ["id", "c0ffee5a1d2b3c4d"],
    ["name", "ATTIC"],
    ["prefix", "c0ffee5a"],
  ] as const)(
    "#given an offline device named by %s #when online is or is not needed #then only the flag decides",
    (_form, text) => {
      expect(resolveDevice(account, text, { online: false })).toMatchObject({
        kind: "ok",
        device: { id: "c0ffee5a1d2b3c4d", online: false },
      })
      expect(resolveDevice(account, text, { online: true })).toMatchObject({
        kind: "refusal",
        refusal: { code: "device_offline", details: { device: "c0ffee5a1d2b3c4d" } },
      })
    },
  )

  test("#given here is offline in the roster #when online is or is not needed #then only the flag decides", () => {
    const roster = { here: "here", devices: [{ id: "here", name: "this mac", online: false }] }
    expect(resolveDevice(roster, "here", { online: false })).toMatchObject({
      kind: "ok",
      device: { id: "here", online: false },
    })
    expect(resolveDevice(roster, "here", { online: true })).toMatchObject({
      kind: "refusal",
      refusal: { code: "device_offline" },
    })
  })

  test("#given two offline devices sharing a name and no online one #when the name is resolved #then ambiguous_target names both", () => {
    const roster = {
      here: null,
      devices: [
        { id: "e0000000000001", name: "box", online: false },
        { id: "e0000000000002", name: "box", online: false },
      ],
    }
    expect(resolveDevice(roster, "box", { online: false })).toMatchObject({
      kind: "refusal",
      refusal: { code: "ambiguous_target", details: { kind: "device" } },
    })
  })

  test.each([false, true])(
    "#given no device id for this device #when here is resolved with online %p #then not_found kind device, never a device named here",
    (online) => {
      expect(
        resolveDevice({ here: null, devices: devices.filter((row) => row.id !== "here") }, "here", { online }),
      ).toMatchObject({
        kind: "refusal",
        refusal: { code: "not_found", details: { kind: "device", device: "here" } },
      })
    },
  )
})

describe("#given a caller that holds a listing row's exact device id (exactId) #when the roster no longer carries it #then no name or prefix match answers for another device", () => {
  // The send paths resolve a listing row's device id, not text a person typed: a device that left the roster must read
  // as gone, or another device sharing the id's prefix or carrying it as a name passes the online check for a device
  // the row never named (#14305 follow-up).
  test.each([
    ["a unique 6+ character id prefix of another device", "b7c41e"],
    ["another device's name", "Studio Laptop"],
    ["this device's name", "this mac"],
  ])("#given %s #when it is resolved with exactId #then not_found with the unknown-device details", (_label, text) => {
    expect(resolveDevice(account, text, { online: true, exactId: true })).toMatchObject({
      kind: "refusal",
      refusal: { code: "not_found", reason: "no_device", details: { kind: "device", device: text } },
    })
  })

  test("#given the exact id is in the roster #when it is resolved with exactId #then it answers as without the option", () => {
    expect(resolveDevice(account, "b7c41e09d2a64f1e", { online: true, exactId: true })).toMatchObject({
      kind: "ok",
      device: { id: "b7c41e09d2a64f1e" },
    })
    expect(resolveDevice(account, "c0ffee5a1d2b3c4d", { online: true, exactId: true })).toMatchObject({
      kind: "refusal",
      refusal: { code: "device_offline", details: { device: "c0ffee5a1d2b3c4d" } },
    })
  })
})

describe("resolveDeviceRow: the same resolver over any device rows, the caller's own row back", () => {
  // An account listing: this device marked self, a dead device (no online flag: it still resolves), and two rows that
  // share a name and an id prefix.
  type Listed = { readonly id: string; readonly name: string; readonly self?: boolean; readonly lastSeenAt?: string }
  const self: Listed = { id: "a1b2c3d4e5f60001", name: "this mac", self: true }
  const dead: Listed = { id: "deadbeef00000001", name: "old laptop", lastSeenAt: "2025-01-01T00:00:00Z" }
  const listed: readonly Listed[] = [
    self,
    dead,
    { id: "f00dcafe00000001", name: "twin" },
    { id: "f00dcafe00000002", name: "twin" },
  ]
  const answer = (text: string): Listed | string => {
    const resolved = resolveDeviceRow(listed, text)
    return resolved.kind === "ok" ? resolved.row : resolved.refusal.reason
  }

  test("#given a dead device's id, name and prefix #when resolved #then each answers that listing row itself", () => {
    expect([answer("deadbeef00000001"), answer("OLD LAPTOP"), answer("deadbe")]).toEqual([dead, dead, dead])
  })

  test("#given here #when resolved #then the row marked self answers", () => {
    expect(answer("here")).toBe(self)
  })

  test("#given a shared name, a shared prefix and nothing #when resolved #then the core's refusals", () => {
    expect([answer("twin"), answer("f00dcafe"), answer("nowhere")]).toEqual([
      "devices_share_name",
      "devices_share_prefix",
      "no_device",
    ])
  })

  test("#given rows with an online flag #when one is offline #then it still resolves (no online requirement)", () => {
    expect(resolveDeviceRow([{ id: "b0b0b0b0b0b0", name: "box", online: false }], "box")).toMatchObject({
      kind: "ok",
      row: { id: "b0b0b0b0b0b0" },
    })
  })
})

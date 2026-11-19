import { describe, expect, test } from "bun:test"
import { resolveDevice } from "."
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
    ["a name only an offline device carries", "attic", "device_offline"],
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
})

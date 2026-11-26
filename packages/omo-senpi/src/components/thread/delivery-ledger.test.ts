import { describe, expect, test } from "bun:test"
import { ledgerDevice } from "./delivery-ledger"

// Both readers of a delivery's ledger key (the consumed-delivery facts in component.ts and the wake carrier's admission
// check) take the sender device from this one function, so the engine's URI-encoded key and the store's plain key name
// the same device in both.
describe("#given a delivery ledger key #when ledgerDevice reads it #then the sender device, or none", () => {
  test.each([
    ["the gateway store's key", "device:b7c41e09d2a64f1e/d-1", "b7c41e09d2a64f1e"],
    ["the engine's URI-encoded key", "device:dev%20b/d-1", "dev b"],
    ["a device part with no id after it", "device:b7c41e09d2a64f1e", "b7c41e09d2a64f1e"],
    ["a device part that is not valid URI encoding", "device:dev%zz/d-1", "dev%zz"],
    ["an empty device part", "device:/d-1", undefined],
    ["this device's own key", "rpc:local/d-1", undefined],
    ["a bare row id", "d-1", undefined],
  ])("%s", (_case, id, device) => {
    expect(ledgerDevice(id)).toBe(device)
  })
})

import { describe, expect, test } from "bun:test"
import type { ListingResult } from "@oh-my-opencode/device-service-core/device-service"
import { unknownDevice } from "./unknown-device"

const listing: ListingResult = { query_id: "q-1", revision: 1, rows: [], devices: {}, incomplete: [] }

describe("#given a device filter #when no device of the account has that exact id #then it is not_found kind device (#13402)", () => {
  test.each(["here", "no-such-device"])("%s", (device) => {
    expect(unknownDevice(device, new Map(), listing)).toMatchObject({
      kind: "error",
      code: "not_found",
      details: { kind: "device", id: device },
    })
  })
})

import { describe, expect, test } from "bun:test"
import { currentServiceDevice } from "./protocol"

// Device binding for memory sync (account-transport-api v8 section 3): the token's device is the one unrevoked current row.
const row = (id: string, current: boolean, revokedAt: string | null = null) => ({ id, name: "fixture", current, revokedAt })

describe("the current service device", () => {
  const cases: readonly [string, unknown, string | null][] = [
    ["exactly one unrevoked current row", { devices: [row("a", true), row("b", false)] }, "a"],
    ["no current row", { devices: [row("a", false)] }, null],
    ["two current rows", { devices: [row("a", true), row("b", true)] }, null],
    ["a revoked current row", { devices: [row("a", true, "2030-01-01T00:00:00.000Z")] }, null],
    ["a row without the current field", { devices: [{ id: "a", name: "fixture", revokedAt: null }] }, null],
    ["current outside the devices array", { current: { id: "a" }, devices: [] }, null],
  ]
  for (const [name, body, expected] of cases) {
    test(`${name} -> ${expected ?? "refused"}`, () => {
      expect(currentServiceDevice(body)).toBe(expected)
    })
  }
})

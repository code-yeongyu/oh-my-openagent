/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { getCallerHerdrPaneId, isHerdrEnvironment } from "./herdr-detect"

describe("isHerdrEnvironment", () => {
  test("returns true when HERDR_ENV is set to 1", () => {
    expect(isHerdrEnvironment({ HERDR_ENV: "1" })).toBe(true)
  })

  test("returns true when HERDR_SOCKET_PATH is set", () => {
    expect(isHerdrEnvironment({ HERDR_SOCKET_PATH: "/tmp/herdr.sock" })).toBe(true)
  })

  test("returns false in a plain environment", () => {
    expect(isHerdrEnvironment({})).toBe(false)
  })

  test("returns false when only HERDR_PANE_ID is set (no server env)", () => {
    expect(isHerdrEnvironment({ HERDR_PANE_ID: "w1:p1" })).toBe(false)
  })
})

describe("getCallerHerdrPaneId", () => {
  test("reads HERDR_PANE_ID", () => {
    expect(getCallerHerdrPaneId({ HERDR_PANE_ID: "w1:p2" })).toBe("w1:p2")
  })

  test("returns undefined when unset", () => {
    expect(getCallerHerdrPaneId({})).toBeUndefined()
  })
})

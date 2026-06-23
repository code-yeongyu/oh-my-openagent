import { afterEach, describe, expect, test } from "bun:test"
import { createFingerprintFamily } from "../fingerprint"
import {
  setSessionFamily,
  getSessionFamily,
  clearSessionFamily,
  clearAllSessionFamilies,
} from "./session-family-store"

afterEach(() => {
  clearAllSessionFamilies()
})

describe("session family store", () => {
  test("#given family stored for sessionId #when retrieved #then returns same family", () => {
    const family = createFingerprintFamily({ browser: "chrome", os: "macos" })
    setSessionFamily("ses_1", family)
    expect(getSessionFamily("ses_1")).toBe(family)
  })

  test("#given no family stored #when retrieved #then returns undefined", () => {
    expect(getSessionFamily("ses_unknown")).toBeUndefined()
  })

  test("#given clearSessionFamily called #when retrieved #then returns undefined", () => {
    const family = createFingerprintFamily({})
    setSessionFamily("ses_2", family)
    clearSessionFamily("ses_2")
    expect(getSessionFamily("ses_2")).toBeUndefined()
  })

  test("#given clearAllSessionFamilies #when called #then all entries removed", () => {
    setSessionFamily("ses_a", createFingerprintFamily({}))
    setSessionFamily("ses_b", createFingerprintFamily({}))
    clearAllSessionFamilies()
    expect(getSessionFamily("ses_a")).toBeUndefined()
    expect(getSessionFamily("ses_b")).toBeUndefined()
  })
})

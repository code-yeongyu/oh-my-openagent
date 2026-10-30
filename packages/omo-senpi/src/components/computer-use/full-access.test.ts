/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { isFullAccess, watchFullAccess } from "./full-access"

// The permission system's resolved preset (settings -> flag -> default, untrusted projects
// included) is the one decision; the raw flag alone must never decide.
function source(resolved: string | undefined, flag: boolean | string | undefined = undefined) {
  return { getPermissionPreset: () => resolved, getFlag: () => flag }
}

describe("isFullAccess (#10022, #2465)", () => {
  test.each([
    ["the resolved preset is full-access from the session flag", source("full-access", "full-access"), true],
    ["the resolved preset is full-access with no session flag (settings or the default)", source("full-access"), true],
    ["the resolved preset is another preset although the raw flag says full-access", source("ask", "full-access"), false],
    ["the permission system is disabled or not bound yet", source(undefined, "full-access"), false],
  ])("#given %s #then it reports %p", (_name, preset, expected) => {
    expect(isFullAccess(preset)).toBe(expected)
  })
})

describe("watchFullAccess (#10022)", () => {
  test("#given a host without flags #when registering #then it never counts as full access", () => {
    // given
    const host: Parameters<typeof watchFullAccess>[0] = {}

    // when
    const fullAccess = watchFullAccess(host)

    // then
    expect(fullAccess()).toBe(false)
  })
})

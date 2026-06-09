/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { isAttachableSessionStatus } from "./attachable-session-status"

describe("isAttachableSessionStatus", () => {
  test("#given a busy session #when checking attachability #then it is attachable", () => {
    //#given
    const status = "busy"

    //#when
    const attachable = isAttachableSessionStatus(status)

    //#then
    expect(attachable).toBe(true)
  })

  test("#given a retrying session #when checking attachability #then it is attachable", () => {
    //#given
    const status = "retry"

    //#when
    const attachable = isAttachableSessionStatus(status)

    //#then
    expect(attachable).toBe(true)
  })
})

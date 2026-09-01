/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { parseSessionStatusResponse } from "./session-status-parser"

describe("parseSessionStatusResponse", () => {
  test("#given wrapped SDK response #when parsing #then returns session status map from data", () => {
    // given
    const response = { data: { "ses-1": { type: "running" } } }

    // when
    const statuses = parseSessionStatusResponse(response)

    // then
    expect(statuses).toEqual({ "ses-1": { type: "running" } })
  })

  test("#given raw SDK status map #when parsing #then returns session status map", () => {
    // given
    const response = { "ses-1": { type: "running" }, "ses-2": { type: "retry" } }

    // when
    const statuses = parseSessionStatusResponse(response)

    // then
    expect(statuses).toEqual({
      "ses-1": { type: "running" },
      "ses-2": { type: "retry" },
    })
  })

  test("#given null data wrapper #when parsing #then does not treat wrapper fields as session ids", () => {
    // given
    const response = { data: null, meta: { type: "running" } }

    // when
    const statuses = parseSessionStatusResponse(response)

    // then
    expect(statuses).toEqual({})
  })
})

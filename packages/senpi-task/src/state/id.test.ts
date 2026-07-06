import { describe, expect, test } from "bun:test"

import { createTaskId } from "./id"

describe("createTaskId", () => {
  test("#given a deterministic clock #when ids are created #then ids are canonical and sortable", () => {
    // given
    const nowMs = 0x12345678

    // when
    const ids = [createTaskId(nowMs), createTaskId(nowMs), createTaskId(nowMs + 1)]

    // then
    expect(ids.every((id) => /^st_[0-9a-f]{8}$/.test(id))).toBe(true)
    expect(ids).toEqual(ids.toSorted())
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("#given a same-millisecond burst #when more than one byte of ids are created #then every id is unique", () => {
    // given
    const nowMs = 0x22334455

    // when
    const ids = Array.from({ length: 300 }, () => createTaskId(nowMs))

    // then
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(ids.toSorted())
  })
})

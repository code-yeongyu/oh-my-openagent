import { describe, expect, it } from "bun:test"

import { createReflectionRunId } from "./reflection-run-id"

describe("reflection run id", () => {
  it("#given two sessions minting ids on different days #when both start counting from scratch #then the ids never collide", () => {
    // given
    const day13 = Date.parse("2026-08-13T22:43:45.000Z")
    const day17 = Date.parse("2026-08-17T11:12:35.000Z")

    // when
    const first = createReflectionRunId(() => day13)
    const second = createReflectionRunId(() => day17)

    // then
    expect(first).not.toBe(second)
  })

  it("#given ids minted inside the same millisecond #when the clock cannot separate them #then entropy keeps them unique", () => {
    // given
    const frozen = () => Date.parse("2026-08-17T11:12:35.000Z")
    let counter = 0
    const entropy = (size: number): Buffer => {
      const buffer = Buffer.alloc(size)
      buffer.writeUInt32BE(++counter)
      return buffer
    }

    // when
    const ids = [createReflectionRunId(frozen, entropy), createReflectionRunId(frozen, entropy)]

    // then
    expect(ids[0]).not.toBe(ids[1])
    expect(ids).toEqual([
      "reflection-run-1786965155000-00000001",
      "reflection-run-1786965155000-00000002",
    ])
  })

  it("#given a run id #when it names a directory #then it carries no path separator", () => {
    // given
    const id = createReflectionRunId()

    // then
    expect(id).not.toContain("/")
    expect(id).not.toContain("\\")
    expect(id).not.toContain("..")
  })
})

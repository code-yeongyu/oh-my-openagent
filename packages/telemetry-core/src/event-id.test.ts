import { describe, expect, test } from "bun:test"

import { createEventId, createUuidV7Generator } from "./index"

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function fixedRandom(byte: number): (size: number) => Uint8Array {
  return (size) => new Uint8Array(size).fill(byte)
}

function timestampOf(id: string): number {
  return Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16)
}

describe("uuidv7 event ids", () => {
  test("#given the runtime generator #when ids are minted back to back #then each is a distinct, increasing uuidv7", () => {
    // when
    const ids = Array.from({ length: 1_000 }, () => createEventId())

    // then
    for (const id of ids) expect(id).toMatch(UUID_V7)
    for (let index = 1; index < ids.length; index += 1) {
      expect(ids[index]! > ids[index - 1]!).toBe(true)
    }
  })

  test("#given the fallback generator and a frozen clock #when ids share one millisecond #then they stay valid and lexically increasing", () => {
    // given
    const next = createUuidV7Generator({ now: () => 1_760_000_000_000, randomBytes: fixedRandom(0xff) })

    // when
    const ids = [next(), next(), next()]

    // then
    for (const id of ids) {
      expect(id).toMatch(UUID_V7)
      expect(timestampOf(id)).toBe(1_760_000_000_000)
    }
    expect(ids[1]! > ids[0]!).toBe(true)
    expect(ids[2]! > ids[1]!).toBe(true)
  })

  test("#given the fallback generator #when the 12-bit counter is exhausted within one millisecond #then the timestamp advances instead of wrapping", () => {
    // given
    const next = createUuidV7Generator({ now: () => 5_000, randomBytes: fixedRandom(0xff) })

    // when
    const ids = Array.from({ length: 4_200 }, () => next())

    // then
    for (let index = 1; index < ids.length; index += 1) {
      expect(ids[index]! > ids[index - 1]!).toBe(true)
    }
    expect(timestampOf(ids.at(-1)!)).toBeGreaterThan(5_000)
  })

  test("#given the fallback generator #when the clock moves backwards #then ids never go backwards", () => {
    // given
    const clock = [9_000, 8_000, 9_000, 9_001]
    const next = createUuidV7Generator({ now: () => clock.shift() ?? 9_001, randomBytes: fixedRandom(0x00) })

    // when
    const ids = [next(), next(), next(), next()]

    // then
    for (let index = 1; index < ids.length; index += 1) {
      expect(ids[index]! > ids[index - 1]!).toBe(true)
    }
  })

  test("#given 10,000 ids from each generator in one process #when they are compared #then none collide", () => {
    // given
    const fallback = createUuidV7Generator()

    // when
    const runtimeIds = new Set(Array.from({ length: 10_000 }, () => createEventId()))
    const fallbackIds = new Set(Array.from({ length: 10_000 }, () => fallback()))

    // then
    expect(runtimeIds.size).toBe(10_000)
    expect(fallbackIds.size).toBe(10_000)
  })
})

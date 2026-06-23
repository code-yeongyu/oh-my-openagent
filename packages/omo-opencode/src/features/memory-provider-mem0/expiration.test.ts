import { describe, expect, it } from "bun:test"
import {
  buildExpirationMetadata,
  ExpirationError,
  filterActiveMemories,
  isExpired,
  TTL_PRESETS,
  ttlToExpirationDate,
  validateExpiration,
} from "./expiration"

const NOW = new Date("2026-01-01T00:00:00.000Z")

describe("validateExpiration", () => {
  it("#given no config #when validated #then passes (noop)", () => {
    expect(() => validateExpiration({}, NOW)).not.toThrow()
  })

  it("#given future ISO date #when validated #then passes", () => {
    expect(() =>
      validateExpiration({ expiration_date: "2027-01-01T00:00:00.000Z" }, NOW),
    ).not.toThrow()
  })

  it("#given past date #when validated #then throws", () => {
    expect(() =>
      validateExpiration({ expiration_date: "2025-01-01T00:00:00.000Z" }, NOW),
    ).toThrow(/future/)
  })

  it("#given invalid format #when validated #then throws", () => {
    expect(() =>
      validateExpiration({ expiration_date: "not-a-date" }, NOW),
    ).toThrow(/ISO/)
  })

  it("#given both date and ttl #when validated #then throws", () => {
    expect(() =>
      validateExpiration(
        { expiration_date: "2027-01-01T00:00:00.000Z", ttl_seconds: 3600 },
        NOW,
      ),
    ).toThrow(/both/)
  })

  it("#given negative ttl #when validated #then throws", () => {
    expect(() =>
      validateExpiration({ ttl_seconds: -100 }, NOW),
    ).toThrow(/positive/)
  })

  it("#given ttl > 10 years #when validated #then throws", () => {
    expect(() =>
      validateExpiration({ ttl_seconds: 60 * 60 * 24 * 365 * 11 }, NOW),
    ).toThrow(/10 years/)
  })
})

describe("ttlToExpirationDate", () => {
  it("#given 1 hour ttl #when converted #then adds 3600 seconds", () => {
    const result = ttlToExpirationDate(3600, NOW)
    const resultMs = new Date(result).getTime()
    expect(resultMs - NOW.getTime()).toBe(3600 * 1000)
  })

  it("#given zero ttl #when converted #then throws", () => {
    expect(() => ttlToExpirationDate(0, NOW)).toThrow(ExpirationError)
  })
})

describe("buildExpirationMetadata", () => {
  it("#given ttl #when built #then returns expiration_date metadata", () => {
    const metadata = buildExpirationMetadata({ ttl_seconds: 3600 }, NOW)
    expect(metadata.expiration_date).toBeDefined()
  })

  it("#given explicit date #when built #then preserves it", () => {
    const metadata = buildExpirationMetadata(
      { expiration_date: "2027-01-01T00:00:00.000Z" },
      NOW,
    )
    expect(metadata.expiration_date).toBe("2027-01-01T00:00:00.000Z")
  })

  it("#given empty config #when built #then empty metadata", () => {
    const metadata = buildExpirationMetadata({}, NOW)
    expect(Object.keys(metadata)).toHaveLength(0)
  })
})

describe("isExpired", () => {
  it("#given undefined #when checked #then returns false", () => {
    expect(isExpired(undefined, NOW)).toBe(false)
  })

  it("#given past date #when checked #then returns true", () => {
    expect(isExpired("2025-01-01T00:00:00.000Z", NOW)).toBe(true)
  })

  it("#given future date #when checked #then returns false", () => {
    expect(isExpired("2027-01-01T00:00:00.000Z", NOW)).toBe(false)
  })

  it("#given invalid date #when checked #then returns false", () => {
    expect(isExpired("garbage", NOW)).toBe(false)
  })
})

describe("filterActiveMemories", () => {
  it("#given mixed memories #when filtered #then drops expired", () => {
    const memories = [
      { id: "1", metadata: { expiration_date: "2025-01-01T00:00:00.000Z" } },
      { id: "2", metadata: { expiration_date: "2027-01-01T00:00:00.000Z" } },
      { id: "3", metadata: {} },
    ]
    const active = filterActiveMemories(memories, NOW)
    expect(active).toHaveLength(2)
    expect(active.map((m) => m.id)).toEqual(["2", "3"])
  })
})

describe("TTL_PRESETS", () => {
  it("#given presets #when summed #then one_day = 86400", () => {
    expect(TTL_PRESETS.one_day).toBe(86400)
  })

  it("#given one_year preset #when validated #then passes", () => {
    expect(() =>
      validateExpiration({ ttl_seconds: TTL_PRESETS.one_year }, NOW),
    ).not.toThrow()
  })
})

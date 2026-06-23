import { describe, expect, test } from "bun:test"
import { validateVendoredPool, PoolEntrySchema, VendoredPoolSchema } from "./pool-schema"

describe("PoolEntrySchema", () => {
  test("#given valid Chrome 148 entry #when parsed #then succeeds", () => {
    const entry = {
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.7778.97",
      browser: "chrome",
      version: "148.0.7778.97",
      os: "windows",
      type: "desktop",
    }
    expect(() => PoolEntrySchema.parse(entry)).not.toThrow()
  })

  test("#given invalid browser #when parsed #then throws", () => {
    expect(() => PoolEntrySchema.parse({
      ua: "Mozilla/5.0 (Windows) Brave/1.0",
      browser: "brave",
      version: "1.0",
      os: "windows",
      type: "desktop",
    })).toThrow()
  })

  test("#given short ua #when parsed #then throws", () => {
    expect(() => PoolEntrySchema.parse({
      ua: "short",
      browser: "chrome",
      version: "148",
      os: "windows",
      type: "desktop",
    })).toThrow()
  })
})

describe("VendoredPoolSchema", () => {
  test("#given pool with HeadlessChrome UA #when validated #then throws", () => {
    expect(() => validateVendoredPool({
      meta: { generated: "2026-05-06", source: "test", total: 40 },
      pool: Array.from({ length: 40 }, () => ({
        ua: "Mozilla/5.0 HeadlessChrome/148.0.0.0 Safari/537.36",
        browser: "chrome",
        version: "148",
        os: "linux",
        type: "desktop",
      })),
    })).toThrow(/HeadlessChrome/)
  })

  test("#given pool with <40 entries #when validated #then throws", () => {
    expect(() => VendoredPoolSchema.parse({
      meta: { generated: "x", source: "test", total: 5 },
      pool: [{
        ua: "Mozilla/5.0 Chrome/148.0.0.0 Safari/537.36",
        browser: "chrome",
        version: "148",
        os: "linux",
        type: "desktop",
      }],
    })).toThrow()
  })
})

import { describe, test, expect } from "bun:test"
import { buildDohPrefs, DEFAULT_DOH_ENDPOINT } from "./camoufox-doh"

describe("buildDohPrefs", () => {
  test("#given enabled=false #when called #then returns empty record", () => {
    expect(buildDohPrefs({ enabled: false })).toEqual({})
  })

  test("#given enabled=undefined #when called #then returns empty record", () => {
    expect(buildDohPrefs({})).toEqual({})
  })

  test("#given enabled=true and no endpoint #when called #then uses Cloudflare default", () => {
    const prefs = buildDohPrefs({ enabled: true })
    expect(prefs["network.trr.mode"]).toBe(3)
    expect(prefs["network.trr.uri"]).toBe(DEFAULT_DOH_ENDPOINT)
    expect(prefs["network.trr.bootstrapAddress"]).toBe("1.1.1.1")
  })

  test("#given enabled=true with custom endpoint #when called #then uses custom endpoint", () => {
    const prefs = buildDohPrefs({ enabled: true, endpoint: "https://dns.google/dns-query" })
    expect(prefs["network.trr.uri"]).toBe("https://dns.google/dns-query")
  })
})

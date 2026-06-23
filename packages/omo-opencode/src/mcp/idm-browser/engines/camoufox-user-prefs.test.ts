import { describe, test, expect } from "bun:test"
import { mergeUserPrefs, DEFAULT_DOH_ENDPOINT } from "./camoufox-user-prefs"
import { STEALTH_USER_PREFS } from "./camoufox-stealth-prefs"

describe("mergeUserPrefs", () => {
  test("#given no modifiers #when merged #then keeps STEALTH defaults including network.trr.mode = 0", () => {
    const prefs = mergeUserPrefs(undefined)
    expect(prefs["network.trr.mode"]).toBe(0)
    expect(prefs["toolkit.telemetry.enabled"]).toBe(false)
  })

  test("#given dns_over_https=true #when merged #then network.trr.mode is 3 and uri points to Cloudflare DoH", () => {
    const prefs = mergeUserPrefs(undefined, { dnsOverHttps: true })
    expect(prefs["network.trr.mode"]).toBe(3)
    expect(prefs["network.trr.uri"]).toBe(DEFAULT_DOH_ENDPOINT)
    expect(prefs["network.trr.bootstrapAddress"]).toBe("1.1.1.1")
  })

  test("#given custom doh endpoint #when merged #then network.trr.uri uses it", () => {
    const prefs = mergeUserPrefs(undefined, {
      dnsOverHttps: true,
      dohEndpoint: "https://dns.google/dns-query",
    })
    expect(prefs["network.trr.uri"]).toBe("https://dns.google/dns-query")
  })

  test("#given overrides #when merged with DoH on #then overrides win over DoH defaults", () => {
    const prefs = mergeUserPrefs(
      { "network.trr.mode": 5 },
      { dnsOverHttps: true },
    )
    expect(prefs["network.trr.mode"]).toBe(5)
  })

  test("#given STEALTH_USER_PREFS not mutated by merge #when called twice #then base remains stable", () => {
    const before = STEALTH_USER_PREFS["network.trr.mode"]
    mergeUserPrefs(undefined, { dnsOverHttps: true })
    expect(STEALTH_USER_PREFS["network.trr.mode"]).toBe(before)
  })
})

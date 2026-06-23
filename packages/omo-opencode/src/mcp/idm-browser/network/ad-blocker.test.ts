import { describe, test, expect } from "bun:test"
import { isAdBlockerDomain, AD_BLOCKER_DOMAINS } from "./ad-blocker-domains"

describe("AD_BLOCKER_DOMAINS", () => {
  test("#given the domain set #when sized #then has at least 100 curated entries", () => {
    expect(AD_BLOCKER_DOMAINS.size).toBeGreaterThanOrEqual(100)
  })
})

describe("isAdBlockerDomain", () => {
  test("#given exact match #when checked #then returns true", () => {
    expect(isAdBlockerDomain("doubleclick.net")).toBe(true)
    expect(isAdBlockerDomain("googletagmanager.com")).toBe(true)
  })

  test("#given subdomain of a blocked domain #when checked #then returns true", () => {
    expect(isAdBlockerDomain("ad.doubleclick.net")).toBe(true)
    expect(isAdBlockerDomain("foo.bar.googletagmanager.com")).toBe(true)
  })

  test("#given case-insensitive match #when checked #then returns true", () => {
    expect(isAdBlockerDomain("DoubleClick.Net")).toBe(true)
  })

  test("#given non-matching domain #when checked #then returns false", () => {
    expect(isAdBlockerDomain("example.com")).toBe(false)
    expect(isAdBlockerDomain("github.io")).toBe(false)
  })

  test("#given empty or invalid host #when checked #then returns false", () => {
    expect(isAdBlockerDomain("")).toBe(false)
  })
})

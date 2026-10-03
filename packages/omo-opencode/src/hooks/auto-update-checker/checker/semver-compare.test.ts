import { describe, expect, test } from "bun:test"
import { compareSemverVersions } from "./semver-compare"

describe("compareSemverVersions", () => {
  test("#given equal versions #when compared #then returns 0", () => {
    expect(compareSemverVersions("5.0.0-beta.89", "5.0.0-beta.89")).toBe(0)
    expect(compareSemverVersions("4.19.4", "4.19.4")).toBe(0)
  })

  test("#given a newer patch/minor/major #when compared #then returns -1 for the older side", () => {
    expect(compareSemverVersions("4.19.4", "5.0.0")).toBe(-1)
    expect(compareSemverVersions("4.19.4", "4.20.0")).toBe(-1)
    expect(compareSemverVersions("4.19.4", "4.19.5")).toBe(-1)
    expect(compareSemverVersions("5.0.0", "4.19.4")).toBe(1)
  })

  test("#given prerelease increments on the same core #when compared #then orders numerically", () => {
    expect(compareSemverVersions("5.0.0-beta.85", "5.0.0-beta.89")).toBe(-1)
    expect(compareSemverVersions("5.0.0-beta.89", "5.0.0-beta.85")).toBe(1)
  })

  test("#given prerelease numbers of different digit counts #when compared #then they order by value, not as strings", () => {
    // beta.9 -> beta.10 is a real channel step; a string compare would call it a downgrade
    expect(compareSemverVersions("5.0.0-beta.9", "5.0.0-beta.10")).toBe(-1)
    expect(compareSemverVersions("5.0.0-0.beta.9", "5.0.0-0.beta.10")).toBe(-1)
    expect(compareSemverVersions("5.0.0-beta.100", "5.0.0-beta.99")).toBe(1)
  })

  test("#given a prerelease vs its release #when compared #then the prerelease is older", () => {
    expect(compareSemverVersions("5.0.0-beta.89", "5.0.0")).toBe(-1)
    expect(compareSemverVersions("5.0.0", "5.0.0-beta.89")).toBe(1)
  })

  test("#given numeric vs alphanumeric prerelease identifiers #when compared #then numeric sorts first", () => {
    expect(compareSemverVersions("1.0.0-1", "1.0.0-alpha")).toBe(-1)
    expect(compareSemverVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1)
    expect(compareSemverVersions("1.0.0-alpha.1", "1.0.0-alpha.beta")).toBe(-1)
  })

  test("#given a local version newer than the registry tag #when compared #then returns 1 (never a downgrade)", () => {
    expect(compareSemverVersions("5.0.0-beta.90", "5.0.0-beta.89")).toBe(1)
    expect(compareSemverVersions("5.0.1", "5.0.0")).toBe(1)
  })

  test("#given an unparseable version #when compared #then returns null instead of guessing", () => {
    expect(compareSemverVersions("dev", "5.0.0")).toBeNull()
    expect(compareSemverVersions("5.0.0", "not-a-version")).toBeNull()
  })
})

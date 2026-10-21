import { describe, expect, test } from "bun:test"

import { compareSemver, REFERENCE_OBJECTS_MIN_SENPI_VERSION } from "../bin/lib/engine-version.js"

describe("engine version comparison", () => {
  describe("#given two versions of the same shape", () => {
    describe("#when they are compared", () => {
      test("#then the ordering is by number, not by string", () => {
        expect(compareSemver("2026.10.20", "2026.10.19")).toBeGreaterThan(0)
        expect(compareSemver("2026.10.19", "2026.10.20")).toBeLessThan(0)
        expect(compareSemver("2026.10.20", "2026.10.20")).toBe(0)
      })

      test("#then a build counter does not change the ordering", () => {
        expect(compareSemver("2026.10.20", "2026.10.20-1")).toBeGreaterThan(0)
        expect(compareSemver("2026.10.20-1", "2026.10.20")).toBeLessThan(0)
        expect(compareSemver("2026.10.20-1", "2026.10.20-2")).toBeLessThan(0)
        expect(compareSemver("2026.10.20-1", "2026.10.20-1")).toBe(0)
      })

      test("#then build metadata is ignored", () => {
        expect(compareSemver("2026.10.20-1+dfd3b4a", "2026.10.20-1")).toBe(0)
      })

      test("#then a semver-shaped version compares the same way", () => {
        expect(compareSemver("5.1.40", "5.1.39")).toBeGreaterThan(0)
        expect(compareSemver("5.1.40", "6.0.0")).toBeLessThan(0)
        expect(compareSemver("5.1.40", "5.1.40")).toBe(0)
      })
    })
  })

  describe("#given the reference-object threshold", () => {
    describe("#when it is read", () => {
      test("#then it is null, which closes the gate until the senpi PR names a version", () => {
        // A version string could not be chosen that is guaranteed to be unreachable, and a
        // sentinel like "0.0.0" would be LOWER than every real version and would open the
        // gate for every engine. null closes it by construction.
        expect(REFERENCE_OBJECTS_MIN_SENPI_VERSION).toBeNull()
      })
    })
  })
})

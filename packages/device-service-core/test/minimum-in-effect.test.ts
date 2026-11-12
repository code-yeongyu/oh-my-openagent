import { describe, expect, test } from "bun:test"
import { minimumInEffect } from "../src/minimum-in-effect.ts"

// omo#13037: the test-only `minimums` option reads both minimums the same way. Absent, the shipped constant applies;
// given, its value applies, and null means "unset" even once the shipped constant has a value.
describe("minimumInEffect", () => {
  test.each(["wakeMark", "singleLocate"] as const)(
    "#given %s passed as null while the shipped constant has a value #then it stays unset",
    (key) => {
      expect(minimumInEffect({ wakeMark: null, singleLocate: null }, key, "1.4.0")).toBeNull()
    },
  )

  test("#given no option #then the shipped constant applies", () => {
    expect(minimumInEffect(undefined, "singleLocate", "1.4.0")).toBe("1.4.0")
  })

  test("#given a value #then that value applies", () => {
    expect(minimumInEffect({ wakeMark: "1.2.0", singleLocate: "1.3.0" }, "singleLocate", "1.4.0")).toBe("1.3.0")
  })
})

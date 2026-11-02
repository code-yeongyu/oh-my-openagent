import { describe, expect, it } from "bun:test"
import { join, resolve } from "node:path"
import { landsIn } from "./spy-scope.test-support"

// Test spies on process-global fs modules must act only on their fixture's own paths (#11963).
// landsIn is the one predicate those spies share, so its path boundary is the contract under test.
const root = resolve("fixture-root")

describe("landsIn", () => {
  const cases: ReadonlyArray<readonly [string, unknown, boolean]> = [
    ["a file directly inside the root", join(root, "pin.json"), true],
    ["a nested file inside the root", join(root, "a", "b.tmp"), true],
    ["the root itself", root, true],
    ["a sibling directory sharing the root's name as a prefix", `${root}-other/pin.json`, false],
    ["a path that climbs out with ..", join(root, "..", "elsewhere", "pin.json"), false],
    ["an unrelated absolute path", resolve("unrelated", "pin.json"), false],
    ["an empty path", "", false],
    ["a non-string value", 42, false],
  ]

  for (const [name, candidate, expected] of cases) {
    it(`${name} -> ${expected}`, () => {
      expect(landsIn(root, candidate)).toBe(expected)
    })
  }
})

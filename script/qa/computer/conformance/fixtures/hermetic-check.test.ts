import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fixtureDataEntries, leftoversSince, profileRoots } from "./hermetic-check.ts"

const made: string[] = []
function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "hermetic-check-test-"))
  made.push(root)
  return root
}
afterEach(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("hermetic check", () => {
  test("#given a fixed-name folder an earlier leg wrote after the baseline #when the last leg checks #then it is a leftover", () => {
    const root = scratchRoot()
    const baseline = fixtureDataEntries([root])
    mkdirSync(join(root, "Conformance Fixture"))
    expect(leftoversSince(baseline, [root])).toEqual([join(root, "Conformance Fixture")])
  })

  test("#given fixture data that was there before the run #when checked #then it is not counted", () => {
    const root = scratchRoot()
    mkdirSync(join(root, "conformance-fixture-web-1"))
    const baseline = fixtureDataEntries([root])
    expect(leftoversSince(baseline, [root])).toEqual([])
  })

  test("#given a macOS app-data file named by the bundle id #when checked #then it is a leftover", () => {
    const home = scratchRoot()
    const roots = profileRoots(home, {})
    const baseline = fixtureDataEntries(roots)
    for (const [dir, name] of [
      ["Saved Application State", "dev.omo.conformance-fixture.webview.savedState"],
      ["HTTPStorages", "dev.omo.conformance-fixture.electron"],
    ] as const) {
      mkdirSync(join(home, "Library", dir, name), { recursive: true })
    }
    mkdirSync(join(home, "Library", "Preferences"), { recursive: true })
    writeFileSync(join(home, "Library", "Preferences", "dev.omo.conformance-fixture.native.plist"), "")
    expect(leftoversSince(baseline, roots).sort()).toEqual(
      [
        join(home, "Library", "HTTPStorages", "dev.omo.conformance-fixture.electron"),
        join(home, "Library", "Preferences", "dev.omo.conformance-fixture.native.plist"),
        join(home, "Library", "Saved Application State", "dev.omo.conformance-fixture.webview.savedState"),
      ].sort(),
    )
  })

})

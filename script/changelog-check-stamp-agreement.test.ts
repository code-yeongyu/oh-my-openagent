import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { assembleRelease } from "./changelog-release-assembly.ts"
import { unreleasedBody } from "./changelog-fragments.ts"
import { splitFragment } from "./package-log-blocks.ts"
import { checkPackageLogs } from "./package-log-gate.ts"

// Release contract (#11253 review rounds 1-3): a merged fragment is immutable, so the PR check must accept exactly the
// fragment text the release stamp can place. Both run assembleRelease; this table pins the agreement on every shape the
// reviews raised and on the repository's real changelog text.
const ROOT = join(import.meta.dir, "..")
const F = "```"
const input = { addedFiles: [], modifiedFiles: [], deletedFiles: [], isRelease: false, existsAtHead: () => true }
const checkAccepts = (fragment: string): boolean => checkPackageLogs({ ...input, fragment }).pass
const stampPlaces = (content: string): boolean => {
  try {
    assembleRelease("", [{ pr: 1, content: splitFragment(content).preamble }])
    return true
  } catch {
    return false
  }
}

const REVIEWED_SHAPES: readonly (readonly [string, string])[] = [
  ["a 10. item with a blank line before its fence", `10. Run:\n\n    ${F}sh\n    a\n    ${F}\n`],
  ["a nested * item with a blank line before its fence", `* x\n  * y\n\n    ${F}\n    a\n    ${F}\n`],
  ["a nested * item whose fence holds a blank line", `* x\n  * y\n    ${F}\n    a\n\n    ${F}\n`],
  ["an intro paragraph with fenced numbered steps", `**Steps.** Do this:\n\n1. Install:\n\n   ${F}sh\n   bun add x\n   ${F}\n\n2. Run it.\n`],
  ["an ordered list with an indented fence", `Steps:\n\n1. Run:\n    ${F}sh\n    a\n\n    b\n    ${F}\n`],
  ["a paragraph back in an outer item", `- a\n  - b\n    - c\n  para in a\n     ${F}\n     z\n     ${F}\n`],
  ["a tab after the marker", `1.\tx\n    ${F}\n    a\n    ${F}\n`],
  ["a lazy continuation line before a fence", `- a\nlazy\n  ${F}\n  a\n  ${F}\n`],
  ["a fence on the marker line", `- ${F}sh\n  a\n  ${F}\n`],
  ["an unclosed fence", `**Thing.** Use it:\n\n${F}sh\nfoo\n`],
  ["a column-0 fence under a ### bullet", `### Fixed\n\n- Run this:\n${F}sh\na\n${F}\n`],
  ["a thematic break", "**A.** one\n\n- - -\n\n**B.** two\n"],
]

describe("the PR check accepts exactly what the release stamp can place", () => {
  test.each(REVIEWED_SHAPES)("%s", (_name, fragment) => {
    expect(checkAccepts(fragment)).toBe(stampPlaces(fragment))
  })

  const fragmentDir = join(ROOT, "changes/unreleased")
  // A release-state tree has consumed every fragment and no longer has the directory.
  const realFragments = existsSync(fragmentDir) ? readdirSync(fragmentDir).filter((name) => /^\d+\.md$/.test(name)) : []
  test.each(realFragments)("the real fragment %s is accepted and placed", (name) => {
    const fragment = readFileSync(join(fragmentDir, name), "utf8")
    expect(checkAccepts(fragment)).toBe(true)
    expect(stampPlaces(fragment)).toBe(true)
  })

  test("the real CHANGELOG Unreleased text is placed as the release's legacy section", () => {
    const legacy = unreleasedBody(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"))
    expect(() => assembleRelease(legacy, [])).not.toThrow()
  })
})

import { expect, test } from "bun:test"
import { markerLine } from "./package-log-blocks.ts"
import { checkPackageLogs, type PackageLogInput } from "./package-log-gate.ts"

const LOG = "packages/omo-senpi/changes.md"
const input = (over: Partial<PackageLogInput>): PackageLogInput => ({
  addedFiles: [], modifiedFiles: [], deletedFiles: [], isRelease: false, fragment: null,
  existsAtHead: (path) => path === LOG, ...over,
})

test("a PR that edits a package log directly fails and is told where the entry goes", () => {
  const result = checkPackageLogs(input({ modifiedFiles: ["packages/omo-senpi/src/a.ts", LOG] }))
  expect(result.pass).toBe(false)
  expect(result.reason).toContain(LOG)
  expect(checkPackageLogs(input({ addedFiles: ["packages/new-pkg/changes.md"] })).pass).toBe(false)
  expect(checkPackageLogs(input({ deletedFiles: [LOG] })).pass).toBe(false)
})

test("the release PR may write package logs (it compiles leftover blocks)", () => {
  expect(checkPackageLogs(input({ isRelease: true, modifiedFiles: [LOG] })).pass).toBe(true)
})

test("valid blocks pass; a block for a missing log or a malformed block fails", () => {
  expect(checkPackageLogs(input({ fragment: `**x**\n\n${markerLine(LOG)}\n## 2026-10-20 - x (#1)` })).pass).toBe(true)
  expect(checkPackageLogs(input({ fragment: `${markerLine("packages/gone/changes.md")}\n## 2026-10-20 - x` })).reason).toContain("does not exist")
  expect(checkPackageLogs(input({ fragment: `${markerLine(LOG)}\nno heading` })).pass).toBe(false)
})

// #10477 review HIGH 1 / MEDIUM 3-4: a merged fragment is immutable, so the PR check refuses every text the release
// stamp would refuse or garble; otherwise one merged fragment blocks every later release.
test("fragment text the release stamp cannot assemble is refused at PR time", () => {
  expect(checkPackageLogs(input({ fragment: "### Fixed\n\nA prose line under the heading.\n" })).reason).toContain("under a ### heading")
  expect(checkPackageLogs(input({ fragment: "### Fixed\n\n- A fix.\n\nstray paragraph after bullets\n" })).pass).toBe(false)
  expect(checkPackageLogs(input({ fragment: `${markerLine(LOG)}\n## 2026-10-20 - x (#1)` })).reason).toContain("CHANGELOG text")
  expect(checkPackageLogs(input({ fragment: "### Fixed\n\n- A fix\n  that wraps.\n" })).pass).toBe(true)
})

test("a fragment without blocks (the plain CHANGELOG paragraph) passes untouched", () => {
  expect(checkPackageLogs(input({ fragment: "**Only the CHANGELOG paragraph**" })).pass).toBe(true)
})

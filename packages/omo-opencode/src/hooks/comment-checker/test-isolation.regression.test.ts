import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

// Regression guard for issue #6142 (flaky comment-checker mutation routing on ubuntu CI).
//
// bun runs every test file in one process. Sibling files that register
// mock.module("./cli-runner") / mock.module("./pending-calls") leak into the
// shared module registry, and query-suffixed dynamic imports such as
// import("./hook?before-after") evaluate a SECOND copy of hook.ts whose
// internal bindings depend on whichever registry state happens to be active at
// evaluation time (verified: a ?-suffixed specifier yields distinct module
// instances from the plain specifier). Under full-suite load this ordering
// intermittently breaks instance identity and the mutation-routing tests fail
// as a group on identical heads.
//
// The fix removes both hazards: routing tests inject the cliRunner and
// lifecycle seams directly, and no file in this directory registers module
// mocks or re-imports modules through query-suffixed specifiers. This test
// pins that invariant so the coupling cannot silently return.

const DIR = import.meta.dir

async function listTestFiles(): Promise<string[]> {
  const entries = await readdir(DIR, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) => path.join(DIR, entry.name))
    .sort()
}

function stripLineComments(source: string): string {
  return source
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n")
}

const MOCK_MODULE_CALL = ["mock", "module("].join("")

describe("comment-checker test isolation regression (#6142)", () => {
  test("#given every test file in comment-checker #when scanned #then no file registers module mocks", async () => {
    // given
    const files = await listTestFiles()
    expect(files.length).toBeGreaterThan(0)

    // when
    const offenders: string[] = []
    for (const filePath of files) {
      const source = stripLineComments(await readFile(filePath, "utf8"))
      if (source.includes(MOCK_MODULE_CALL)) {
        offenders.push(path.relative(DIR, filePath))
      }
    }

    // then
    expect(offenders).toEqual([])
  })

  test("#given every test file in comment-checker #when scanned #then no file imports through query-suffixed specifiers", async () => {
    // given
    const files = await listTestFiles()
    expect(files.length).toBeGreaterThan(0)

    // when
    const offenders: Array<{ file: string; line: string }> = []
    const directImportPattern = /import\(\s*["'][^"']*\?[^"']*["']\s*\)/
    const specifierLiteralPattern = /["']\.[^"']*\?[^"']*["']/
    for (const filePath of files) {
      const source = stripLineComments(await readFile(filePath, "utf8"))
      const lines = source.split("\n")
      for (const [index, line] of lines.entries()) {
        if (directImportPattern.test(line) || specifierLiteralPattern.test(line)) {
          offenders.push({ file: path.relative(DIR, filePath), line: `L${index + 1}: ${line.trim()}` })
        }
      }
    }

    // then
    expect(offenders).toEqual([])
  })
})

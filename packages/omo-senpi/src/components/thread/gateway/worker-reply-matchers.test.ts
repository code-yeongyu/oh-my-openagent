import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

// Bun 1.4.2 (oven-sh/bun#43819, fix pending in oven-sh/bun#37190): once a worker_threads worker has
// answered an earlier request, `expect(promise).rejects` / `.resolves` never wakes for a promise
// that the worker's next reply settles, and the test hangs until its timeout. Every async API under
// gateway/ (store, engine, drain, relay) answers through the store worker, so these tests await the
// promise plainly (see testing/settled.ts) and assert the settled value instead. This audit keeps
// the matcher form from coming back until the pinned Bun ships the fix.
const MATCHER_AWAIT = /\)\s*\.\s*(rejects|resolves)\b/g

function testFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return testFiles(path)
    return entry.name.endsWith(".test.ts") ? [path] : []
  })
}

// Blanks comments while keeping line numbers, so prose that names the matcher form is not flagged.
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) => comment.replace(/[^\n]/g, " "))
}

export function matcherAwaits(source: string): number[] {
  const code = withoutComments(source)
  return [...code.matchAll(MATCHER_AWAIT)].map((match) => code.slice(0, match.index).split("\n").length)
}

describe("gateway tests and bun#43819", () => {
  test("#given a call awaited through a matcher #when the audit scans it #then it reports the line, but not when the form only appears in a comment", () => {
    const source = [
      "// expect(p).rejects is unsafe here",
      "const r = await settled(store.list())",
      "await expect(store.journalMode()).rejects.toMatchObject({})",
      "await expect(",
      "  engine.deliver(request),",
      ").resolves.toEqual(ok)",
      "/* expect(x).resolves */",
    ].join("\n")
    expect(matcherAwaits(source)).toEqual([3, 6])
  })

  test("#given every test file under gateway/ #when it is scanned #then none awaits a worker-settled promise through expect().rejects or .resolves", () => {
    const offenders = testFiles(import.meta.dir).filter((file) => file !== import.meta.path).flatMap((file) =>
      matcherAwaits(readFileSync(file, "utf8")).map((line) => `${relative(import.meta.dir, file)}:${line}`),
    )
    expect(offenders).toEqual([])
  })
})

import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

// Gateway tests may not use `expect(...).rejects` / `.resolves` at all, awaited or not, for two
// reasons:
// - Bun 1.4.2 (oven-sh/bun#43819, fix pending in oven-sh/bun#37190): once a worker_threads worker
//   has answered an earlier request, an awaited `.rejects` / `.resolves` never wakes for a promise
//   that the worker's next reply settles, and the test hangs until its timeout. Every async API
//   under gateway/ (store, engine, drain, relay) answers through the store worker.
// - An unawaited `.rejects` / `.resolves` asserts nothing: the test finishes before the matcher
//   runs, so it passes whatever the promise does.
// Await the promise through `settled()` (testing/settled.ts) or a plain `await`, and assert the
// settled value instead.
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

const USE_INSTEAD = "use settled() or a plain await instead of expect(...).rejects/.resolves"

describe("gateway tests ban expect().rejects/.resolves entirely (bun#43819; an unawaited matcher asserts nothing)", () => {
  test("#given a matcher call, awaited or not #when the audit scans it #then it reports the line, but not when the form only appears in a comment", () => {
    const source = [
      "// expect(p).rejects is unsafe here",
      "const r = await settled(store.list())",
      "await expect(store.journalMode()).rejects.toMatchObject({})",
      "await expect(",
      "  engine.deliver(request),",
      ").resolves.toEqual(ok)",
      "/* expect(x).resolves */",
      "expect(relay.outbox(request)).resolves.toEqual(ok)",
    ].join("\n")
    expect(matcherAwaits(source)).toEqual([3, 6, 8])
  })

  test("#given every test file under gateway/ #when it is scanned #then none uses expect().rejects or .resolves, awaited or not", () => {
    const offenders = testFiles(import.meta.dir).filter((file) => file !== import.meta.path).flatMap((file) =>
      matcherAwaits(readFileSync(file, "utf8")).map((line) => `${relative(import.meta.dir, file)}:${line}: ${USE_INSTEAD}`),
    )
    expect(offenders).toEqual([])
  })
})

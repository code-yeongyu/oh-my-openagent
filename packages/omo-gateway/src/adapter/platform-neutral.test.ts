import { expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const SRC = join(import.meta.dir, "..")
const CORE_DIRS = ["adapter", "rules", "admission", "dispatch", "connector"]
const SELF = relative(SRC, import.meta.path)

// Slack wire vocabulary that must stay inside src/adapters/slack: message timestamps (`ts`,
// `thread_ts`), token prefixes (`xox*`), Block Kit (`blocks`) and Slack markdown (`mrkdwn`).
const LEAKS: readonly (readonly [string, RegExp])[] = [
  ["ts", /(?<![\w$])ts(?![\w$])/],
  ["thread_ts", /\bthread_ts\b/],
  ["xox", /\bxox[a-z]?-?/],
  ["blocks", /\bblocks\b/],
  ["mrkdwn", /\bmrkdwn\b/],
]

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.[cm]?tsx?$/.test(name) ? [path] : []
  })
}

// Comments are prose; module specifiers such as "./contract.ts" end in `.ts` without naming the field.
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1")
    .replace(/(["'`])[^"'`\n]*\.[cm]?tsx?\1/g, '""')
}

test("core modules carry no Slack vocabulary outside src/adapters/slack", () => {
  const hits: string[] = []
  const files = CORE_DIRS.flatMap((dir) => sourceFiles(join(SRC, dir)))
  expect(files.length).toBeGreaterThan(0)
  for (const file of files) {
    const path = relative(SRC, file)
    if (path === SELF) continue
    codeOf(readFileSync(file, "utf8"))
      .split("\n")
      .forEach((line, index) => {
        for (const [word, pattern] of LEAKS) if (pattern.test(line)) hits.push(`${path}:${index + 1} ${word}: ${line.trim()}`)
      })
  }
  expect(hits).toEqual([])
})

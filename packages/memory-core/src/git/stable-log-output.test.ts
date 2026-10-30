import { describe, expect, it } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { join, relative, sep } from "node:path"

// Architecture contract (#10726 review): every memory-core git read whose `log` / `show -s` / `diff-tree`
// output is parsed spreads STABLE_LOG_OUTPUT, so a user's git config cannot change what it parses.
const SOURCE_ROOT = join(import.meta.dir, "..")
const PARSED_COMMAND = /"(log|show|diff-tree)"/g
const SHOW_PARSES_HEADERS = /"(-s|--no-patch)"|"--(format|pretty)=/

function enclosingArray(source: string, at: number): string | null {
  let depth = 0
  let start = -1
  for (let index = at; index >= 0; index -= 1) {
    const char = source[index]
    if (char === "]") depth += 1
    if (char === "[") {
      if (depth === 0) { start = index; break }
      depth -= 1
    }
  }
  if (start < 0) return null
  depth = 0
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (char === "[") depth += 1
    if (char === "]") {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return null
}

function parsedGitReads(source: string): { readonly line: number; readonly argv: string; readonly pinned: boolean }[] {
  const reads: { line: number; argv: string; pinned: boolean }[] = []
  for (const match of source.matchAll(PARSED_COMMAND)) {
    const argv = enclosingArray(source, match.index)
    if (argv === null) continue
    if (match[1] === "show" && !SHOW_PARSES_HEADERS.test(argv)) continue
    reads.push({ line: source.slice(0, match.index).split("\n").length, argv, pinned: argv.includes("...STABLE_LOG_OUTPUT") })
  }
  return reads
}

async function productionSources(dir: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await productionSources(path))
    else if (/\.(ts|mts)$/.test(entry.name) && !/\.test\.|test-support|\.d\.ts$/.test(entry.name)) files.push(path)
  }
  return files
}

describe("STABLE_LOG_OUTPUT coverage", () => {
  it("#given an unpinned and a pinned parsed read #when scanned #then only the unpinned one is reported", () => {
    // given
    const source = [
      `run(["log", "--format=%ct", head])`,
      `run([...STABLE_LOG_OUTPUT, "show", "-s", "--format=%ct", head])`,
      `run(["show", \`\${revision}:\${path}\`])`,
    ].join("\n")

    // when
    const reads = parsedGitReads(source)

    // then
    expect(reads.map((read) => [read.line, read.pinned])).toEqual([[1, false], [2, true]])
  })

  it("#given memory-core production sources #when every parsed log/show/diff-tree read is found #then each one spreads STABLE_LOG_OUTPUT", async () => {
    // given
    const files = await productionSources(SOURCE_ROOT)

    // when
    const reads = (await Promise.all(files.map(async (file) =>
      parsedGitReads(await readFile(file, "utf8")).map((read) => ({ ...read, file: relative(SOURCE_ROOT, file).split(sep).join("/") })),
    ))).flat()

    // then
    expect(reads.map((read) => read.file)).toEqual(expect.arrayContaining(["git/repo-commit-times.ts", "git/repo-revision-reads.ts", "git/commit-outcome.ts"]))
    expect(reads.filter((read) => !read.pinned).map((read) => `${read.file}:${read.line} ${read.argv}`)).toEqual([])
  })
})

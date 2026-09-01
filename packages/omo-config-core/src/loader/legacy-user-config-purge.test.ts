import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

const LOADER_DIR = import.meta.dir
const WRITER_DIR = join(LOADER_DIR, "..", "writer")

/**
 * The user-scope omo config root is `~/.omo` and nothing else. Any reappearance of
 * an XDG / APPDATA / `.config/omo` user-config branch reintroduces the split-brain
 * this package was fixed to remove, so the audit fails on the source text itself.
 *
 * This scan is supplemental and defeatable by construction (a computed string, or a
 * helper moved outside these two directories). The load-bearing guarantees are the
 * behavioral tests that populate `$XDG_CONFIG_HOME`, `%APPDATA%`, and `~/.config/omo`
 * with decoys and assert neither the loader nor the writer ever touches them:
 * `paths.test.ts` and the writer containment case in `../writer/writer.test.ts`.
 */
const FORBIDDEN_USER_CONFIG_TOKENS = ["XDG_CONFIG_HOME", "APPDATA", `".config"`] as const

function collectSourceFiles(directory: string): readonly string[] {
  const entries = readdirSync(directory)
  const files: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      files.push(...collectSourceFiles(path))
      continue
    }
    if (!path.endsWith(".ts") || path.endsWith(".test.ts")) continue
    files.push(path)
  }
  return files
}

function offendingLines(path: string): readonly string[] {
  const lines = readFileSync(path, "utf-8").split("\n")
  const offenders: string[] = []
  lines.forEach((line, index) => {
    for (const token of FORBIDDEN_USER_CONFIG_TOKENS) {
      if (line.includes(token)) offenders.push(`${path}:${index + 1}: ${line.trim()}`)
    }
  })
  return offenders
}

describe("legacy user config purge", () => {
  test("#given the loader and writer sources #when scanned #then no XDG, APPDATA, or .config user-config branch remains", () => {
    // given
    const sources = [...collectSourceFiles(LOADER_DIR), ...collectSourceFiles(WRITER_DIR)]

    // when
    const offenders = sources.flatMap((path) => offendingLines(path))

    // then
    expect(offenders).toEqual([])
  })
})

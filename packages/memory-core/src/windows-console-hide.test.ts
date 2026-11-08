import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

// The memory engine spawns console-subsystem binaries - git for every auto-commit and sync,
// powershell for the lock protocol's start-time fallback. On Windows each of those, spawned
// without windowsHide, allocates a FRESH console window that Windows foregrounds, which the human
// experiences as their active application losing focus on every memory write (#8501).
//
// The predecessor of this audit only matched /\bspawn(?:Sync)?\(/ over a hand-written file list,
// so it could not see execFile and covered no file in this package - which is precisely how the
// unhidden PowerShell probe shipped. This audit therefore resolves the child_process entry points
// each file actually imports and walks the whole package instead of a fixed list.
const ENTRY_POINTS = ["spawnSync", "spawn", "execFileSync", "execFile", "execSync", "exec", "fork"] as const

interface ChildProcessCall {
  readonly file: string
  readonly line: number
  readonly text: string
}

// readdirSync hands back backslash-separated entries on win32, so every path this audit reports or
// matches on is normalized to POSIX first; otherwise the coverage assertions below silently find
// nothing on Windows while the audit itself still looks green.
function toPosix(entry: string): string {
  return entry.replaceAll("\\", "/")
}

function productionSources(): readonly string[] {
  return readdirSync(import.meta.dir, { recursive: true, encoding: "utf8" })
    .map(toPosix)
    .filter((entry) => entry.endsWith(".ts"))
    .filter((entry) => !entry.endsWith(".test.ts") && !entry.endsWith(".test-support.ts"))
    .filter((entry) => !entry.split("/").includes("__fixtures__"))
    .sort()
}

function importedEntryPoints(source: string): readonly string[] {
  const locals = new Set<string>()
  const clauses = source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']node:child_process["']/g)
  for (const [, clause] of clauses) {
    for (const specifier of (clause ?? "").split(",")) {
      const [importedPart, aliasPart] = specifier.split(/\s+as\s+/)
      const imported = (importedPart ?? "").trim().replace(/^type\s+/, "")
      if (!ENTRY_POINTS.includes(imported as (typeof ENTRY_POINTS)[number])) continue
      locals.add((aliasPart ?? imported).trim())
    }
  }
  return [...locals]
}

function callText(source: string, openingParen: number): string {
  let depth = 0
  for (let index = openingParen; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1
    else if (source[index] === ")") {
      depth -= 1
      if (depth === 0) return source.slice(openingParen, index + 1)
    }
  }
  return source.slice(openingParen)
}

// Prose inside a comment mentions these names too ("kills every child at spawn (issue #6873)"),
// so a call is recognized only in its code spelling - identifier immediately followed by `(` -
// and matches sitting on a comment line are dropped.
function isCommentLine(source: string, offset: number): boolean {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1
  const lead = source.slice(lineStart, offset).trimStart()
  return lead.startsWith("//") || lead.startsWith("*") || lead.startsWith("/*")
}

function collectChildProcessCalls(file: string): readonly ChildProcessCall[] {
  const source = readFileSync(join(import.meta.dir, file), "utf8")
  const calls: ChildProcessCall[] = []
  for (const local of importedEntryPoints(source)) {
    const pattern = new RegExp(String.raw`(?<![\w$.])${local}\(`, "g")
    for (const match of source.matchAll(pattern)) {
      if (isCommentLine(source, match.index)) continue
      const openingParen = match.index + match[0].length - 1
      calls.push({
        file,
        line: source.slice(0, match.index).split("\n").length,
        text: `${local}${callText(source, openingParen)}`,
      })
    }
  }
  return calls
}

describe("memory-core win32 console suppression", () => {
  describe("#given every production child_process call in the memory engine", () => {
    describe("#when each call site is inspected", () => {
      test("#then each one passes windowsHide: true", () => {
        const offenders = productionSources()
          .flatMap(collectChildProcessCalls)
          .filter((call) => !call.text.includes("windowsHide: true"))
          .map((call) => `${call.file}:${call.line}`)

        expect(offenders).toEqual([])
      })

      test("#then the audit still reaches the git and start-identity spawn sites it exists for", () => {
        const audited = productionSources().flatMap(collectChildProcessCalls)

        expect(audited.map((call) => call.file).filter((file) => file.includes("git/exec")).length)
          .toBeGreaterThan(0)
        expect(
          audited.map((call) => call.file).filter((file) => file.includes("locks/process-identity")).length,
        ).toBeGreaterThan(0)
      })

      test("#then win32 directory entries are matched under POSIX separators", () => {
        expect(toPosix("git\\exec.ts")).toBe("git/exec.ts")
        expect(toPosix("locks\\process-identity.ts")).toBe("locks/process-identity.ts")
      })

      test("#then an execFile call without the flag is reported, not silently skipped", () => {
        const source = [
          'import { execFile } from "node:child_process"',
          'execFile("powershell.exe", args, { encoding: "utf8" }, callback)',
        ].join("\n")

        const locals = importedEntryPoints(source)
        const unflagged = [...source.matchAll(/(?<![\w$.])execFile\(/g)]

        expect(locals).toEqual(["execFile"])
        expect(unflagged).toHaveLength(1)
      })
    })
  })
})

import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

// Nothing this adapter spawns may open a console window on win32. Reflection/dream children run
// detached from any console, so a console-subsystem child created without CREATE_NO_WINDOW gets a
// FRESH visible console; elsewhere - git for worktree roots, the formatter, the local launcher -
// Windows foregrounds that new console and the user's active application loses focus (#8501).
// windowsHide is the flag that suppresses it, so it is pinned here for the whole package.
//
// The predecessor of this gate matched only /\bspawn(?:Sync)?\(/ over three hand-listed files in
// the memory worker. That shape is blind to the exec* family and to every file outside the list,
// which is how unhidden execFile probes reached users. This gate resolves the child_process entry
// points each file actually imports and walks the whole package source tree.
const ENTRY_POINTS = ["spawnSync", "spawn", "execFileSync", "execFile", "execSync", "exec", "fork"] as const

interface ChildProcessCall {
  readonly file: string
  readonly line: number
  readonly text: string
}

// readdirSync hands back backslash-separated entries on win32, so every path this gate reports or
// matches on is normalized to POSIX first; otherwise the coverage assertions below silently find
// nothing on Windows while the gate itself still looks green.
function toPosix(entry: string): string {
  return entry.replaceAll("\\", "/")
}

function productionSources(): readonly string[] {
  return readdirSync(import.meta.dir, { recursive: true, encoding: "utf8" })
    .map(toPosix)
    .filter((entry: string) => entry.endsWith(".ts"))
    .filter((entry: string) => !entry.endsWith(".test.ts") && !entry.endsWith(".test-support.ts"))
    .filter((entry: string) => !entry.split("/").includes("__fixtures__"))
    .sort()
}

function importedEntryPoints(source: string): readonly string[] {
  const locals = new Set<string>()
  for (const [, clause] of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']node:child_process["']/g)) {
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

// A foreground process that must own or inherit the user's console - the interactive launcher -
// is the one case where hiding the window would hide the program itself. Such a site opts out by
// carrying this marker plus its reason on the preceding lines, so the exception is written down
// at the call rather than kept in a list this gate cannot see.
const EXEMPTION_MARKER = "windowsHide-exempt:"

function isExempt(source: string, offset: number): boolean {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1
  return source.slice(Math.max(0, lineStart - 400), lineStart).includes(EXEMPTION_MARKER)
}

function collectChildProcessCalls(file: string): readonly ChildProcessCall[] {
  const source = readFileSync(join(import.meta.dir, file), "utf8")
  if (!source.includes("node:child_process")) return []
  const calls: ChildProcessCall[] = []
  for (const local of importedEntryPoints(source)) {
    for (const match of source.matchAll(new RegExp(String.raw`(?<![\w$.])${local}\(`, "g"))) {
      if (isCommentLine(source, match.index) || isExempt(source, match.index)) continue
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

describe("omo-senpi win32 console suppression", () => {
  describe("#given every production child_process call in the adapter", () => {
    describe("#when each call site is inspected", () => {
      test("#then each one passes windowsHide: true", () => {
        const offenders = productionSources()
          .flatMap(collectChildProcessCalls)
          .filter((call) => !call.text.includes("windowsHide: true"))
          .map((call) => `${call.file}:${call.line}`)

        expect(offenders).toEqual([])
      })

      test("#then the gate still reaches the spawn sites it exists for", () => {
        const audited = productionSources().flatMap(collectChildProcessCalls).map((call) => call.file)

        for (const required of [
          "components/memory/worker/spawn-supervisor.ts",
          "components/memory/worker/memory-run-supervisor.ts",
          "components/memory/worker/supervisor-process-identity.ts",
          "components/thread/addressing.ts",
          "components/formatter/formatter.ts",
        ]) {
          expect(audited).toContain(required)
        }
      })

      test("#then win32 directory entries are matched under POSIX separators", () => {
        expect(toPosix("components\\thread\\addressing.ts")).toBe("components/thread/addressing.ts")
        expect(toPosix("install\\local-launcher.ts")).toBe("install/local-launcher.ts")
      })

      test("#then the exec family is audited, not just spawn", () => {
        const source = [
          'import { execFileSync } from "node:child_process"',
          'execFileSync("git", args, { encoding: "utf8" })',
        ].join("\n")

        expect(importedEntryPoints(source)).toEqual(["execFileSync"])
      })

      test("#then an aliased import is audited under its local name", () => {
        const source = [
          'import { spawn as spawnChild } from "node:child_process"',
          'spawnChild("git", args, { stdio: "ignore" })',
        ].join("\n")

        expect(importedEntryPoints(source)).toEqual(["spawnChild"])
      })

      test("#then an exemption is honoured only when its marker is written at the call", () => {
        const exempted = ['// windowsHide-exempt: inherits the caller console', 'spawn(cli, args, {})'].join("\n")
        const bare = ['// ordinary comment', 'spawn(cli, args, {})'].join("\n")
        const callOffset = (text: string) => text.indexOf("spawn(cli")

        expect(isExempt(exempted, callOffset(exempted))).toBe(true)
        expect(isExempt(bare, callOffset(bare))).toBe(false)
      })
    })
  })
})

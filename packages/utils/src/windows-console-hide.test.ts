import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { createBunSpawnOptions, createNodeSpawnOptions, createNodeSpawnSyncOptions } from "./runtime/spawn"

// Platform contract (#7144, same class as #8501): utils runs inside console-less hosts (an IDE- or
// GUI-launched `opencode serve`, Codex hooks). On Windows a console-subsystem child spawned there
// without windowsHide gets a FRESH console window - a conhost flash, or a focus-stealing Windows
// Terminal window when that is the default terminal. This gate walks the whole package source tree
// and resolves the child_process entry points each file actually imports, so a new call site, or an
// exec*/fork call that a spawn-only regex would miss, cannot ship unflagged.
const ENTRY_POINTS = ["spawnSync", "spawn", "execFileSync", "execFile", "execSync", "exec", "fork"] as const

// Calls whose call text cannot carry the literal flag. Each entry names the reason; an intentionally
// visible process would also be listed here.
const ALLOWLIST: readonly { readonly file: string; readonly callee: string; readonly via: string; readonly reason: string }[] = [
  {
    file: "runtime/spawn.ts",
    callee: "nodeSpawn",
    via: "createNodeSpawnOptions(",
    reason: "options come from createNodeSpawnOptions, which sets windowsHide on win32 (asserted below)",
  },
  {
    file: "runtime/spawn.ts",
    callee: "nodeSpawnSync",
    via: "createNodeSpawnSyncOptions(",
    reason: "options come from createNodeSpawnSyncOptions, which sets windowsHide on win32 (asserted below)",
  },
  {
    file: "runtime/spawn.ts",
    callee: "bun.spawn",
    via: "createBunSpawnOptions(",
    reason: "options come from createBunSpawnOptions, which sets windowsHide (asserted below)",
  },
  {
    file: "runtime/spawn.ts",
    callee: "bun.spawnSync",
    via: "createBunSpawnOptions(",
    reason: "options come from createBunSpawnOptions, which sets windowsHide (asserted below)",
  },
]

interface ChildProcessCall {
  readonly file: string
  readonly line: number
  readonly callee: string
  readonly text: string
}

// readdirSync returns backslash-separated entries on win32; matching on raw entries would silently
// find nothing there while the gate still looked green.
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

// Comment prose names these functions too, so only the code spelling (identifier then `(`) on a
// non-comment line counts as a call.
function isCommentLine(source: string, offset: number): boolean {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1
  const lead = source.slice(lineStart, offset).trimStart()
  return lead.startsWith("//") || lead.startsWith("*") || lead.startsWith("/*")
}

function collectCalls(file: string, source: string): readonly ChildProcessCall[] {
  const calls: ChildProcessCall[] = []
  for (const local of importedEntryPoints(source)) {
    for (const match of source.matchAll(new RegExp(String.raw`(?<![\w$.])${local}\(`, "g"))) {
      if (isCommentLine(source, match.index)) continue
      calls.push({
        file,
        line: source.slice(0, match.index).split("\n").length,
        callee: local,
        text: `${local}${callText(source, match.index + match[0].length - 1)}`,
      })
    }
  }
  // Bun's own spawn API (#9840): `Bun.spawn*` directly, or a runtime handle named `bun`. It accepts
  // windowsHide too, and is the path taken whenever the code runs under Bun.
  for (const match of source.matchAll(/(?<![\w$])((?:Bun|bun)\.spawn(?:Sync)?)\(/g)) {
    if (isCommentLine(source, match.index)) continue
    calls.push({
      file,
      line: source.slice(0, match.index).split("\n").length,
      callee: match[1] ?? "",
      text: `${match[1]}${callText(source, match.index + match[0].length - 1)}`,
    })
  }
  return calls
}

function auditedCalls(): readonly ChildProcessCall[] {
  return productionSources().flatMap((file) => collectCalls(file, readFileSync(join(import.meta.dir, file), "utf8")))
}

function isAllowlisted(call: ChildProcessCall): boolean {
  return ALLOWLIST.some((entry) => entry.file === call.file && entry.callee === call.callee && call.text.includes(entry.via))
}

describe("utils win32 console suppression", () => {
  describe("#given every production child_process call in the utils package", () => {
    test("#when each call site is inspected #then each one passes windowsHide: true or is allowlisted with a reason", () => {
      // given
      const calls = auditedCalls()

      // when
      const offenders = calls
        .filter((call) => !call.text.includes("windowsHide: true") && !isAllowlisted(call))
        .map((call) => `${call.file}:${call.line} ${call.callee}`)

      // then
      expect(offenders).toEqual([])
    })

    test("#when the audit runs #then it still reaches the hook dispatcher it exists for", () => {
      // given
      const calls = auditedCalls()

      // when
      const hookSpawns = calls.filter((call) => call.file === "command-executor/execute-hook-command.ts")

      // then
      expect(hookSpawns.length).toBeGreaterThan(0)
    })

    test("#when the allowlist is checked #then every entry still matches a real call", () => {
      // given
      const calls = auditedCalls()

      // when
      const stale = ALLOWLIST.filter((entry) => !calls.some((call) => call.file === entry.file && call.callee === entry.callee && call.text.includes(entry.via)))

      // then
      expect(stale).toEqual([])
    })

    test("#when the allowlisted helpers build win32 options #then they set windowsHide", () => {
      // given
      const options = { cwd: "/tmp" }

      // when
      const asyncOptions = createNodeSpawnOptions(options, "win32")
      const syncOptions = createNodeSpawnSyncOptions(options, "win32")

      // then
      expect(asyncOptions.windowsHide).toBe(true)
      expect(syncOptions.windowsHide).toBe(true)
      expect(createBunSpawnOptions(options)).toEqual({ cwd: "/tmp", windowsHide: true })
    })
  })

  describe("#given an aliased execFile import without the flag", () => {
    test("#when the source is audited #then the call is reported, not silently skipped", () => {
      // given
      const source = [
        'import { execFile as run } from "node:child_process"',
        'run("powershell.exe", args, { encoding: "utf8" }, callback)',
      ].join("\n")

      // when
      const calls = collectCalls("fixture.ts", source)

      // then
      expect(calls.map((call) => call.callee)).toEqual(["run"])
      expect(calls[0]?.text.includes("windowsHide: true")).toBe(false)
    })
  })

  describe("#given a Bun.spawn call without the flag", () => {
    test("#when the source is audited #then the call is reported, not silently skipped", () => {
      // given
      const source = 'const proc = Bun.spawn(["cmd.exe", "/c", "npm.cmd"], { stdout: "pipe" })'

      // when
      const calls = collectCalls("fixture.ts", source)

      // then
      expect(calls.map((call) => call.callee)).toEqual(["Bun.spawn"])
      expect(calls[0]?.text.includes("windowsHide: true")).toBe(false)
    })
  })

  test("#given a win32 directory entry #when normalized #then it matches under POSIX separators", () => {
    expect(toPosix("command-executor\\execute-hook-command.ts")).toBe("command-executor/execute-hook-command.ts")
  })
})

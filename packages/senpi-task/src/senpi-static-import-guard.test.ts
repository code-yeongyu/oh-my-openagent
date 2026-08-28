import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

// The omo-task.js/omo-member.js blobs are spawned fresh in rpc children, so any static (non-type)
// import of the @code-yeongyu/senpi engine barrel or the @earendil-works/pi-tui barrel inside
// packages/senpi-task/src puts that barrel into every child's boot-time module graph. This guard
// keeps those edges lazy: runtime value imports must go through the memoized boundaries in
// src/lazy (dynamic import() plus a warmed synchronous accessor), and only type-only imports may
// reference the packages statically.
const SRC_ROOT = import.meta.dir
const GUARDED_PACKAGES = ["@code-yeongyu/senpi", "@earendil-works/pi-tui"]

type ImportViolation = {
  readonly file: string
  readonly line: number
  readonly snippet: string
}

function isGuardedSpecifier(specifier: string): boolean {
  return GUARDED_PACKAGES.some((packageName) => specifier === packageName || specifier.startsWith(`${packageName}/`))
}

function listSourceFiles(dir: string): readonly string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === "__snapshots__" || entry.startsWith(".")) continue
    const path = join(dir, entry)
    const stats = statSync(path)
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(path))
      continue
    }
    // Test files statically import the pinned barrel by design (the tripwire suite proves the
    // values resolve); the guard covers shipped source only.
    if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) files.push(path)
  }
  return files
}

// Locate the start of the import/export statement owning a `from "<specifier>"` occurrence.
function owningStatementStart(source: string, fromIndex: number): number {
  const prefix = source.slice(0, fromIndex)
  const starts = [...prefix.matchAll(/(?:^|\n)[ \t]*(?:import|export)\b/g)]
  const owner = starts.at(-1)
  if (owner === undefined || owner.index === undefined) return -1
  // A statement clause never spans a blank line; anything further back belongs to another
  // statement and is treated as unattributable (reported as a violation by the caller).
  const span = source.slice(owner.index, fromIndex)
  if (span.includes("\n\n")) return -1
  return owner.index
}

function hasRuntimeValueSpecifier(clause: string): boolean {
  // The statement clause spans from the import/export keyword up to (excluding) `from`.
  // `import type ...` / `export type ...` are fully type-position; inside a mixed clause only
  // `type X` prefixed specifiers are erasable, everything else is a runtime binding.
  const rest = clause.trim().replace(/^(?:import|export)\s+/, "")
  if (/^type(?:\s|\{)/.test(rest)) return false
  const stripped = rest
    .replace(/\btype\s+[A-Za-z_$][\w$]*/g, "")
    .replace(/\b(?:from|as)\b/g, "")
    .replace(/[{},"'`]/g, "")
    .replace(/\/\/[^\n]*/g, "")
  return /[A-Za-z_$][\w$]*/.test(stripped)
}

function scanSource(file: string, source: string): readonly ImportViolation[] {
  const violations: ImportViolation[] = []
  const relative = file.slice(SRC_ROOT.length + 1)
  const lineOf = (index: number): number => source.slice(0, index).split("\n").length

  for (const match of source.matchAll(/(?:^|\n)[ \t]*import[ \t]*(["'])([^"'\n]+)\1/g)) {
    const specifier = match[2]
    if (!isGuardedSpecifier(specifier)) continue
    violations.push({
      file: relative,
      line: lineOf(match.index ?? 0),
      snippet: `side-effect import of ${specifier}`,
    })
  }

  for (const match of source.matchAll(/\bfrom[ \t]*(["'])([^"'\n]+)\1/g)) {
    const specifier = match[2]
    if (!isGuardedSpecifier(specifier)) continue
    const fromIndex = match.index ?? 0
    const statementStart = owningStatementStart(source, fromIndex)
    if (statementStart < 0 || hasRuntimeValueSpecifier(source.slice(statementStart, fromIndex))) {
      violations.push({
        file: relative,
        line: lineOf(statementStart >= 0 ? statementStart : fromIndex),
        snippet: source
          .slice(statementStart >= 0 ? statementStart : fromIndex, (match.index ?? 0) + match[0].length)
          .replace(/\s+/g, " ")
          .trim(),
      })
    }
  }
  return violations
}

describe("senpi-task static import guard", () => {
  test("#given senpi-task source #when scanned #then no runtime static import of the senpi or pi-tui barrels remains", () => {
    // given / when
    const violations = listSourceFiles(SRC_ROOT).flatMap((file) => scanSource(file, readFileSync(file, "utf8")))

    // then
    expect(violations).toEqual([])
  })

  test("#given the guard scanner #when fed runtime and type-only clauses #then only runtime clauses are flagged", () => {
    // given
    const runtimeSource = [
      "import { SessionManager } from \"@code-yeongyu/senpi\"",
      "import { Box, type Component, Text } from \"@earendil-works/pi-tui\"",
      "import {\n  DEFAULT_MAX_BYTES,\n  type ToolDefinition,\n} from \"@code-yeongyu/senpi\"",
      "import DefaultBinding, { type OnlyType } from \"@code-yeongyu/senpi\"",
      "export { defineTool } from \"@code-yeongyu/senpi\"",
      "import \"@earendil-works/pi-tui\"",
    ].join("\n")
    const typeOnlySource = [
      "import type { ToolDefinition } from \"@code-yeongyu/senpi\"",
      "import { type Component } from \"@earendil-works/pi-tui\"",
      "import type { loadSkillsFromDir } from \"@code-yeongyu/senpi\"",
      "import type DefaultBinding from \"@code-yeongyu/senpi\"",
      "export type { Theme } from \"@code-yeongyu/senpi\"",
    ].join("\n")
    const untouchedSource = [
      "import { senpiBarrel } from \"../lazy/senpi-barrel\"",
      "const barrel = await import(\"@code-yeongyu/senpi\")",
      "import { Type } from \"typebox\"",
    ].join("\n")

    // when / then
    expect(scanSource("runtime-sample.ts", runtimeSource)).toHaveLength(6)
    expect(scanSource("type-sample.ts", typeOnlySource)).toEqual([])
    expect(scanSource("untouched-sample.ts", untouchedSource)).toEqual([])
  })
})

import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { basename, join } from "node:path"
import { forkPairs, parityCoverageTags } from "./fork-pairs"

const repoRoot = join(import.meta.dir, "..", "..", "..", "..")
const scriptInstallDir = join(repoRoot, "packages", "omo-codex", "scripts", "install")
const knownUnpairedScriptInstallFiles = [
  "cli-args.mjs",
  "command-shim.mjs",
  "config.mjs",
  "delegated-command.mjs",
  "git-bash-mcp-env.mjs",
  "git-bash.test.mjs",
  "hook-targets.mjs",
  "hook-trust.mjs",
  "legacy-bins.mjs",
  "multi-agent-v2-config.mjs",
  "permissions.d.mts",
  "permissions.mjs",
  "source-package-build.mjs",
  "utils.mjs",
] as const

describe("installer fork parity inventory", () => {
  it("classifies every script installer file as paired or intentionally unpaired", () => {
    // given
    const pairedFiles = new Set(forkPairs.map((pair) => basename(pair.mjsPath)))
    const intentionallyUnpaired = new Set<string>(knownUnpairedScriptInstallFiles)
    const scriptFiles = readdirSync(scriptInstallDir).filter((entry) => entry.endsWith(".mjs") || entry.endsWith(".mts"))

    // when
    const unclassified = scriptFiles.filter((entry) => !pairedFiles.has(entry) && !intentionallyUnpaired.has(entry))

    // then
    expect(unclassified).toEqual([])
    expect(scriptFiles.length).toBeGreaterThan(0)
    expect(forkPairs.length).toBeGreaterThan(0)
  })

  it("keeps every listed fork pair backed by files, exports, and a coverage tag", () => {
    // given
    const coverageTags = new Set<string>(parityCoverageTags)

    // when
    const missingFiles = forkPairs.flatMap((pair) => [pair.tsPath, pair.mjsPath].filter((path) => !existsSync(join(repoRoot, path))))
    const missingCoverage = forkPairs.filter((pair) => pair.coveredBy.every((tag) => !coverageTags.has(tag))).map((pair) => pair.id)
    const missingExports = forkPairs.flatMap((pair) => missingExportNames(pair))

    // then
    expect(missingFiles).toEqual([])
    expect(missingCoverage).toEqual([])
    expect(missingExports).toEqual([])
  })

  it("rejects malformed inventory data before it can report false coverage", () => {
    // given
    const malformed = {
      id: "",
      family: "toml",
      tsPath: "packages/omo-opencode/src/cli/install-codex/toml-section-editor.ts",
      mjsPath: "packages/omo-codex/scripts/install/toml-editor.mjs",
      coveredBy: [],
      exports: [],
    }

    // when
    const errors = validateInventoryEntry(malformed)

    // then
    expect(errors).toContain("id must be non-empty")
    expect(errors).toContain("coveredBy must be non-empty")
    expect(errors).toContain("exports must be non-empty")
  })
})

type InventoryEntry = {
  readonly id?: unknown
  readonly family?: unknown
  readonly tsPath?: unknown
  readonly mjsPath?: unknown
  readonly coveredBy?: unknown
  readonly exports?: unknown
}

function missingExportNames(pair: (typeof forkPairs)[number]): readonly string[] {
  const tsText = readFileSync(join(repoRoot, pair.tsPath), "utf8")
  const mjsText = readFileSync(join(repoRoot, pair.mjsPath), "utf8")
  return pair.exports.flatMap((exportName) => {
    const inTs = tsText.includes(exportName)
    const inMjs = mjsText.includes(exportName)
    return inTs && inMjs ? [] : [`${pair.id}:${exportName}`]
  })
}

function validateInventoryEntry(entry: InventoryEntry): readonly string[] {
  const errors: string[] = []
  if (typeof entry.id !== "string" || entry.id.length === 0) errors.push("id must be non-empty")
  if (typeof entry.family !== "string" || entry.family.length === 0) errors.push("family must be non-empty")
  if (typeof entry.tsPath !== "string" || !entry.tsPath.endsWith(".ts")) errors.push("tsPath must point at TypeScript")
  if (typeof entry.mjsPath !== "string" || !entry.mjsPath.endsWith(".mjs")) errors.push("mjsPath must point at mjs")
  if (!Array.isArray(entry.coveredBy) || entry.coveredBy.length === 0) errors.push("coveredBy must be non-empty")
  if (!Array.isArray(entry.exports) || entry.exports.length === 0) errors.push("exports must be non-empty")
  return errors
}

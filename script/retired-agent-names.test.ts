/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// Gate: retired Greek-myth agent names must not reappear in user-facing surfaces.
// PR-A governs code surfaces (skills, plugin README, runtime sources, shipped shared skills).
// PR-B appends docs/**, README*.md and packages/web/** entries to GOVERNED_SURFACES.

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url))

export interface GovernedSurface {
  /** Glob (repo-root relative, forward slashes) enumerating candidate files. */
  readonly glob: string
  /** Repo-root relative paths (forward slashes) matched against these are skipped. */
  readonly exclude?: readonly RegExp[]
  /** Also flag lowercase agent-context `oracle` usages (subagent_type/@oracle/agents.oracle). */
  readonly oracleAgentContext?: boolean
  /**
   * Only the six retired names apply; `sisyphus` and agent-context `oracle` stay legal. Used for
   * shared-skill sources whose OpenCode literals the senpi sync overlay re-routes
   * (`packages/omo-senpi/plugin/scripts/senpi-skill-roster-overlay.mjs`); the synced output is
   * gated separately by `packages/omo-senpi/src/skills-sync.test.ts`.
   */
  readonly retiredNamesOnly?: boolean
}

export const GOVERNED_SURFACES: readonly GovernedSurface[] = [
  { glob: "packages/omo-senpi/skills/**" },
  { glob: "packages/omo-senpi/plugin/README.md" },
  {
    glob: "packages/omo-senpi/src/**/*.ts",
    exclude: [/\.test\.ts$/, /^packages\/omo-senpi\/src\/components\/ultrawork\/generated-directive\.ts$/],
  },
  { glob: "packages/senpi-task/src/**/*.ts", exclude: [/\.test\.ts$/] },
  { glob: "packages/shared-skills/skills/{ulw-execute,refactor,review-work}/**", retiredNamesOnly: true },
]

/** Paths exempt everywhere (repo-root relative, forward slashes). */
const EXEMPT_PATHS: readonly RegExp[] = [
  /^CHANGELOG\.md$/,
  /(^|\/)changes\.md$/,
  /^packages\/shared-skills\/skills\/(visual-qa|debugging|ulw-plan)\//,
]

const RETIRED_NAME = /\b(?:sisyphus-junior|hephaestus|prometheus|atlas|metis|momus)\b/i
const SISYPHUS = /\bsisyphus\b/i
const SISYPHUS_ALLOWLIST = /Sisyphus Labs|justsisyphus|sisyphuslabs|sisyphus-dev-ai|\.sisyphus[/\\]|does it in 1 hour/
const ORACLE_AGENT_CONTEXT = /subagent_type\s*[:=]\s*["']?oracle\b|@oracle\b|agents\.oracle\b/
const ALLOWED_MARKER = "<!-- retired-name-allowed -->"
const ALLOWED_MARKER_LINE_END = new RegExp(`${ALLOWED_MARKER.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s*$`)
const MAX_ALLOWED_MARKERS = 6

function toPosix(path: string): string {
  return path.replaceAll("\\", "/")
}

function isExempt(relativePath: string, surface: GovernedSurface): boolean {
  if (EXEMPT_PATHS.some((pattern) => pattern.test(relativePath))) return true
  return (surface.exclude ?? []).some((pattern) => pattern.test(relativePath))
}

function lineViolates(line: string, surface: GovernedSurface): boolean {
  if (ALLOWED_MARKER_LINE_END.test(line)) return false
  if (RETIRED_NAME.test(line)) return true
  if (surface.retiredNamesOnly === true) return false
  if (SISYPHUS.test(line) && !SISYPHUS_ALLOWLIST.test(line)) return true
  if (surface.oracleAgentContext === true && ORACLE_AGENT_CONTEXT.test(line)) return true
  return false
}

async function governedFiles(surface: GovernedSurface): Promise<string[]> {
  const files: string[] = []
  for await (const match of new Bun.Glob(surface.glob).scan({ cwd: REPO_ROOT, onlyFiles: true })) {
    const relativePath = toPosix(match)
    if (isExempt(relativePath, surface)) continue
    files.push(relativePath)
  }
  return files.sort()
}

async function scanSurface(surface: GovernedSurface): Promise<string[]> {
  const violations: string[] = []
  for (const relativePath of await governedFiles(surface)) {
    const text = await Bun.file(join(REPO_ROOT, relativePath)).text()
    text.split(/\r?\n/).forEach((line, index) => {
      if (lineViolates(line, surface)) violations.push(`${relativePath}:${index + 1}: ${line.trim()}`)
    })
  }
  return violations
}

function trackedFiles(): string[] {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr}`)
  return result.stdout.split("\0").filter((entry) => entry.length > 0).map(toPosix)
}

describe("retired agent names gate", () => {
  test("governed surfaces resolve to at least one file each", async () => {
    const emptySurfaces: string[] = []
    for (const surface of GOVERNED_SURFACES) {
      if ((await governedFiles(surface)).length === 0) emptySurfaces.push(surface.glob)
    }
    expect(emptySurfaces).toEqual([])
  })

  test("no retired agent name appears in a governed surface", async () => {
    const violations = (await Promise.all(GOVERNED_SURFACES.map(scanSurface))).flat()
    expect(violations.join("\n")).toBe("")
  })

  test(`at most ${MAX_ALLOWED_MARKERS} lines repo-wide end with the retired-name-allowed marker`, async () => {
    const markerLines: string[] = []
    for (const relativePath of trackedFiles()) {
      const file = Bun.file(join(REPO_ROOT, relativePath))
      if (!(await file.exists())) continue
      const text = await file.text()
      if (!text.includes(ALLOWED_MARKER)) continue
      text.split(/\r?\n/).forEach((line, index) => {
        if (ALLOWED_MARKER_LINE_END.test(line)) markerLines.push(`${relativePath}:${index + 1}`)
      })
    }
    expect(markerLines.length <= MAX_ALLOWED_MARKERS ? "" : markerLines.join("\n")).toBe("")
  })
})

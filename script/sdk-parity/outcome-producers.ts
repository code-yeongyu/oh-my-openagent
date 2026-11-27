import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"

/** The runner both trees run: every outcome the gate compares is produced and normalized by it and what it imports. */
export const OUTCOME_RUNNER = "script/sdk-parity/scenario-run.ts"

/**
 * The files that compute and judge the gate-change tier itself. They are members by rule, so a change that empties or
 * bypasses the computed set is a gate change too (the gate-rule read of #15217, F1).
 */
export const TIER_FILES = [
  "script/sdk-parity/base-inputs.ts",
  "script/sdk-parity/base-tree.ts",
  "script/sdk-parity/declared-change.ts",
  "script/sdk-parity/gate-cli.ts",
  "script/sdk-parity/gate.ts",
  "script/sdk-parity/outcome-producers.ts",
  "script/sdk-parity/verify-review.ts",
]

// Every way a module names another by a relative literal: an import (static, bare side-effect or dynamic), a re-export
// (`export * from`, `export { x } from`), require(), and a template literal. A type-only import or re-export is left
// out: it cannot change an outcome. A specifier written with an expression cannot be followed, so it fails the
// computation rather than being skipped.
const STATIC_IMPORT = /^\s*import\s+(type\s+)?(?:([^"';]*?)\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/gm
const RE_EXPORT = /^\s*export\s+(type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^"';]*?\})\s+from\s+["'](\.{1,2}\/[^"']+)["']/gm
const QUOTED_CALL = /\b(?:import|require)\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g
const TEMPLATE_IMPORT = /\b(?:import|require)\(\s*`(\.{1,2}\/[^`]*)`\s*\)/g

const onlyTypes = (clause: string | undefined): boolean => {
  const names = clause?.match(/^\{([\s\S]*)\}$/)?.[1]
  if (names === undefined) return false
  const parts = names
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
  return parts.length > 0 && parts.every((part) => part.startsWith("type "))
}

function specifiersOf(file: string, source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(STATIC_IMPORT))
    if (match[1] === undefined && !onlyTypes(match[2]?.trim()) && match[3] !== undefined) found.push(match[3])
  for (const match of source.matchAll(RE_EXPORT))
    if (match[1] === undefined && match[2] !== undefined) found.push(match[2])
  for (const match of source.matchAll(QUOTED_CALL)) if (match[1] !== undefined) found.push(match[1])
  for (const match of source.matchAll(TEMPLATE_IMPORT)) {
    const specifier = match[1] ?? ""
    if (specifier.includes("${")) throw new Error(`${file}: cannot follow the computed import \`${specifier}\``)
    found.push(specifier)
  }
  return found
}

const isFile = (path: string): boolean => existsSync(path) && statSync(path).isFile()

function resolveModule(root: string, from: string, specifier: string): string {
  const base = join(root, dirname(from), specifier)
  const candidates = [base, `${base}.ts`, base.replace(/\.js$/, ".ts"), join(base, "index.ts")]
  const file = candidates.find(isFile)
  if (file === undefined) throw new Error(`${from}: cannot resolve the relative import "${specifier}"`)
  return relative(root, file).split("\\").join("/")
}

/**
 * The files under script/sdk-parity that produce or normalize an outcome: the runner and every module it reaches there,
 * transitively, plus the files that compute and judge this tier. Computed from the source, so a module the runner newly
 * imports is in the set without a list to edit. Imports outside the folder are not followed: the runner and the tool
 * registry load them from the tree under test (`import(join(tree, ...))`), which both sides run and compare.
 */
export function outcomeProducers(root: string): string[] {
  const seen = new Set([OUTCOME_RUNNER])
  const queue = [OUTCOME_RUNNER]
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (!/\.[cm]?[jt]s$/.test(file)) continue
    for (const specifier of specifiersOf(file, readFileSync(join(root, file), "utf8"))) {
      const target = resolveModule(root, file, specifier)
      if (!target.startsWith("script/sdk-parity/") || seen.has(target)) continue
      seen.add(target)
      queue.push(target)
    }
  }
  return [...new Set([...seen, ...TIER_FILES])].toSorted()
}

/**
 * The gate-change set of a pull request: the producers on the merge base's tree and on the head's. A module the head
 * stops importing still counts, because it produced the outcomes the base side compared.
 */
export const gateChangeSet = (headRoot: string, baseRoot: string): string[] =>
  [...new Set([...outcomeProducers(headRoot), ...outcomeProducers(baseRoot)])].toSorted()

import { existsSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"

/** The runner both trees run: every outcome the gate compares is produced and normalized by it and what it imports. */
export const OUTCOME_RUNNER = "script/sdk-parity/scenario-run.ts"

// A relative import written as a literal: `from "./x"`, `import("./x")`, a bare `import "./x"`. A type-only import
// (`import type`, or every name of a brace list marked `type`) is left out: it cannot change an outcome.
const LITERAL_IMPORT = /^\s*import\s+(type\s+)?(?:([\s\S]*?)\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/gm
const DYNAMIC_IMPORT = /\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g

const onlyTypes = (clause: string | undefined): boolean => {
  const names = clause?.match(/^\{([\s\S]*)\}$/)?.[1]
  if (names === undefined) return false
  const parts = names
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
  return parts.length > 0 && parts.every((part) => part.startsWith("type "))
}

function importsOf(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(LITERAL_IMPORT))
    if (match[1] === undefined && !onlyTypes(match[2]?.trim()) && match[3] !== undefined) found.push(match[3])
  for (const match of source.matchAll(DYNAMIC_IMPORT)) if (match[1] !== undefined) found.push(match[1])
  return found
}

const resolveModule = (root: string, from: string, specifier: string): string | undefined => {
  const base = join(root, dirname(from), specifier)
  const file = [`${base}.ts`, base, join(base, "index.ts")].find(
    (candidate) => candidate.endsWith(".ts") && existsSync(candidate),
  )
  return file === undefined ? undefined : relative(root, file).split("\\").join("/")
}

/**
 * The files under script/sdk-parity that produce or normalize an outcome: the runner and every module it imports there,
 * transitively. Computed from the source, so a module the runner newly imports is in the set without a list to edit.
 */
export function outcomeProducers(root: string): string[] {
  const seen = new Set([OUTCOME_RUNNER])
  const queue = [OUTCOME_RUNNER]
  for (let file = queue.shift(); file !== undefined; file = queue.shift())
    for (const specifier of importsOf(readFileSync(join(root, file), "utf8"))) {
      const target = resolveModule(root, file, specifier)
      if (target === undefined || !target.startsWith("script/sdk-parity/") || seen.has(target)) continue
      seen.add(target)
      queue.push(target)
    }
  return [...seen].toSorted()
}

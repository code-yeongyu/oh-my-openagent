// One definition of "every output the plugin needs" (#13192), shared by the raw TLS client scan's CI contract
// (no-raw-tls-client-scan.ts, run by bun) and the omo-ai payload gate (verify-omo-ai-payload.mjs, run by node, which
// reads the result through one bun call: `bun script/plugin-required-outputs.ts <plugin manifest>` prints it as JSON).
// The plugin's own contract is the installer's REQUIRED_PLUGIN_ARTIFACTS plus the import-map targets the runtime
// resolves its lazy sidecars through; a list pattern is met per output, never by any one matching file.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { REQUIRED_PLUGIN_ARTIFACTS } from "../packages/omo-senpi/src/install/plugin-artifacts"

export const PLUGIN_SOURCE_ROOT = "packages/omo-senpi/plugin/"

export interface OutputRequirement {
  readonly label: string
  readonly regex: RegExp
}

/** Targets of a plugin package.json "imports" map, plugin-relative. Absent: none; unparsable: throws. */
export function importMapTargets(manifestPath: string): string[] {
  if (!existsSync(manifestPath)) return []
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"))
  const imports = typeof manifest === "object" && manifest !== null && "imports" in manifest ? manifest.imports : {}
  return Object.values(Object(imports))
    .filter((target): target is string => typeof target === "string")
    .map((target) => target.replace(/^\.\//, ""))
}

/** Every output the plugin needs, plugin-relative with "/" separators. */
export function pluginRequiredOutputs(importTargets: readonly string[]): string[] {
  const required = REQUIRED_PLUGIN_ARTIFACTS.map((artifact) => artifact.split("\\").join("/"))
  return [...new Set([...required, ...importTargets])].sort()
}

function literalOf(branch: string): string | undefined {
  const body = branch.replace(/^\^/, "").replace(/\$$/, "").replaceAll("\\.", ".")
  return /[\\[\](){}*+?|^$]/.test(body) ? undefined : body
}

/**
 * Per-output requirements for the generated list, in repository-relative paths. A pattern's alternation is split into
 * branches; a literal branch names one output; a wildcard branch requires every plugin output it covers, or, when it
 * covers none of them, at least one matching file.
 */
export function generatedOutputRequirements(
  patterns: readonly string[],
  pluginOutputs: readonly string[],
): OutputRequirement[] {
  const pluginPaths = pluginOutputs.map((path) => PLUGIN_SOURCE_ROOT + path)
  const requirements: OutputRequirement[] = []
  for (const pattern of patterns) {
    const group = /^(.*)\(\?:([^()]+)\)(.*)$/.exec(pattern)
    const branches = group ? (group[2] ?? "").split("|").map((branch) => `${group[1]}${branch}${group[3]}`) : [pattern]
    for (const branch of branches) {
      const regex = new RegExp(branch)
      const literal = literalOf(branch)
      if (literal !== undefined) {
        requirements.push({ label: literal, regex })
        continue
      }
      const covered = pluginPaths.filter((path) => regex.test(path))
      if (covered.length === 0) requirements.push({ label: `a path matching ${branch}`, regex })
      for (const path of covered)
        requirements.push({ label: path, regex: new RegExp(`^${path.replaceAll(".", "\\.")}$`) })
    }
  }
  return requirements
}

export function listPatterns(repoRoot: string): string[] {
  const parsed: unknown = JSON.parse(readFileSync(join(repoRoot, "script", "generated-bundles.json"), "utf8"))
  const patterns = typeof parsed === "object" && parsed !== null && "patterns" in parsed ? parsed.patterns : []
  return Array.isArray(patterns) ? patterns.filter((pattern): pattern is string => typeof pattern === "string") : []
}

// The node-run payload gate's entry: plugin outputs and the list's per-output requirements as JSON on stdout. An
// unparsable manifest is reported as {"manifestError": ...} so the gate prints a missing-artifact line, not a trace.
if (import.meta.main) {
  const repoRoot = join(import.meta.dir, "..")
  let importTargets: string[]
  try {
    importTargets = importMapTargets(process.argv[2] ?? "")
  } catch (error) {
    console.log(JSON.stringify({ manifestError: error instanceof Error ? error.message : String(error) }))
    process.exit(0)
  }
  const pluginOutputs = pluginRequiredOutputs(importTargets)
  const generated = generatedOutputRequirements(listPatterns(repoRoot), pluginOutputs).map(({ label, regex }) => ({
    label,
    source: regex.source,
  }))
  console.log(JSON.stringify({ pluginOutputs, generated }))
}

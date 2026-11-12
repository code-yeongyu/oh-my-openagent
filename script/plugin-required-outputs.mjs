// One definition of "every output the plugin needs" (#13192), shared by the omo-ai payload gate
// (verify-omo-ai-payload.mjs, run by node) and the raw TLS client scan's CI contract (no-raw-tls-client-scan.ts, run
// by bun). The plugin's own contract is the installer's REQUIRED_PLUGIN_ARTIFACTS plus the import-map targets the
// runtime resolves its lazy sidecars through; a list pattern is met per output, never by any one matching file.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const PLUGIN_SOURCE_ROOT = "packages/omo-senpi/plugin/"

const LIST_LOADER = `
import { REQUIRED_PLUGIN_ARTIFACTS } from "./packages/omo-senpi/src/install/plugin-artifacts.ts"
console.log(JSON.stringify(REQUIRED_PLUGIN_ARTIFACTS.map((path) => path.split("\\\\").join("/"))))
`

/**
 * REQUIRED_PLUGIN_ARTIFACTS, plugin-relative with "/" separators. The list lives in TypeScript that imports a workspace
 * alias, so a node process reads it through one bun call from the repository root.
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function loadRequiredPluginArtifacts(repoRoot) {
  const result = spawnSync("bun", ["-e", LIST_LOADER], { cwd: repoRoot, encoding: "utf8" })
  if (result.error !== undefined)
    throw new Error(`reading REQUIRED_PLUGIN_ARTIFACTS needs bun: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`reading REQUIRED_PLUGIN_ARTIFACTS failed: ${result.stderr.trim()}`)
  return JSON.parse(result.stdout)
}

/**
 * Targets of a plugin package.json "imports" map, plugin-relative. An absent manifest yields none; an unparsable one
 * throws, so the caller reports it.
 * @param {string} manifestPath
 * @returns {string[]}
 */
export function importMapTargets(manifestPath) {
  if (!existsSync(manifestPath)) return []
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  return Object.values(manifest.imports ?? {})
    .filter((target) => typeof target === "string")
    .map((target) => target.replace(/^\.\//, ""))
}

/**
 * Every output the plugin needs, plugin-relative.
 * @param {readonly string[]} requiredArtifacts
 * @param {readonly string[]} importTargets
 * @returns {string[]}
 */
export function pluginRequiredOutputs(requiredArtifacts, importTargets) {
  return [...new Set([...requiredArtifacts, ...importTargets])].sort()
}

function literalOf(branch) {
  const body = branch.replace(/^\^/, "").replace(/\$$/, "").replaceAll("\\.", ".")
  return /[\\[\](){}*+?|^$]/.test(body) ? undefined : body
}

/**
 * Per-output requirements for the generated list, in repository-relative paths. A pattern's alternation is split into
 * branches; a literal branch names one output; a wildcard branch requires every plugin output it covers, or, when it
 * covers none of them, at least one matching file.
 * @param {readonly string[]} patterns script/generated-bundles.json patterns
 * @param {readonly string[]} pluginOutputs plugin-relative paths from pluginRequiredOutputs
 * @returns {{ label: string, regex: RegExp }[]}
 */
export function generatedOutputRequirements(patterns, pluginOutputs) {
  const pluginPaths = pluginOutputs.map((path) => PLUGIN_SOURCE_ROOT + path)
  const requirements = []
  for (const pattern of patterns) {
    const group = /^(.*)\(\?:([^()]+)\)(.*)$/.exec(pattern)
    const branches = group ? group[2].split("|").map((branch) => `${group[1]}${branch}${group[3]}`) : [pattern]
    for (const branch of branches) {
      const regex = new RegExp(branch)
      const literal = literalOf(branch)
      if (literal !== undefined) {
        requirements.push({ label: literal, regex })
        continue
      }
      const covered = pluginPaths.filter((path) => regex.test(path))
      if (covered.length === 0) requirements.push({ label: `a path matching ${branch}`, regex })
      for (const path of covered) {
        requirements.push({ label: path, regex: new RegExp(`^${path.replaceAll(".", "\\.")}$`) })
      }
    }
  }
  return requirements
}

export const listPatterns = (repoRoot) =>
  JSON.parse(readFileSync(join(repoRoot, "script", "generated-bundles.json"), "utf8")).patterns

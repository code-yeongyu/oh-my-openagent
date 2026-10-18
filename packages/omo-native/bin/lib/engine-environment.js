import { existsSync, realpathSync } from "node:fs"
import { delimiter, isAbsolute, join, relative, sep } from "node:path"
import { canonicalAgentDir } from "./agent-dir.js"
import { HERDR_AGENT_MARKER } from "./herdr-agent-hint.js"
import { nearestNodeBin, packageManifest, packageRoot, readJson, releaseChannel, updateTarget } from "./package-paths.js"

// Identity the engine adopts for this install: what the user sees, where state lives, which
// environment prefix is read first, what goes on the wire, and which channel to check for
// updates. The engine consumes this once and scrubs it, so nested engine processes are
// unaffected.
function pluginChangelogSource() {
  try {
    const pluginRoot = join(packageRoot, "plugin")
    const changelogPath = join(pluginRoot, "CHANGELOG.md")
    if (!existsSync(changelogPath)) return undefined
    const version = readJson(join(pluginRoot, "package.json")).version
    return typeof version === "string" && version ? { path: changelogPath, version } : { path: changelogPath }
  } catch {
    return undefined
  }
}

function brandProfile() {
  const update = updateTarget()
  // The changelog source is advisory: a missing plugin manifest or file must disable
  // startup notes, never fail the launch.
  const changelog = pluginChangelogSource()
  return {
    name: "OmO",
    command: "omo",
    displayVersion: packageManifest().version,
    configDir: ".omo",
    // Engine state lives at the canonical `~/.omo/agent`, never directly under the config
    // directory: a flat home would disagree with the directory every omo surface resolves.
    flatLayout: false,
    envPrefix: "OMO",
    userAgent: "omo",
    originator: "omo",
    ...(changelog ? { changelog } : {}),
    update: {
      packageName: "omo-ai",
      distTag: releaseChannel(),
      command: update.command,
      changelogUrl: "https://github.com/code-yeongyu/oh-my-openagent/releases",
    },
  }
}

function canonicalPath(path) {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

function containsPath(root, target) {
  const rel = relative(canonicalPath(root), canonicalPath(target))
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

// A compiled omo session exports its own payload as the brand-scoped package dir, and every shell it
// spawns inherits that. The engine reads these names before the legacy PI_PACKAGE_DIR, so a release
// omo started from such a shell would run on the foreign payload. A deliberate relocation names this
// install's engine and survives; a root that does not contain the engine belongs to another install.
function dropForeignPackageDirs(env, senpiRoot) {
  for (const name of ["OMO_PACKAGE_DIR", "SENPI_PACKAGE_DIR"]) {
    const root = env[name]
    if (root && !containsPath(root, senpiRoot)) delete env[name]
  }
}

/**
 * The one environment every engine this launcher starts gets. `overrides` (a host call's own
 * environment) is merged in here, before the last step, so nothing a caller passes can put back
 * what this function removes.
 */
export function senpiEnvironment(senpiRoot, overrides = {}) {
  const env = { ...process.env }
  delete env.OMO_BIN
  delete env.SENPI_BIN
  dropForeignPackageDirs(env, senpiRoot)
  // One directory for every surface. The legacy name travels too, so a bare senpi spawned by a
  // tool inherits the same state instead of falling back to its own home.
  const agentDir = canonicalAgentDir(env)
  env.OMO_CODING_AGENT_DIR = agentDir
  env.SENPI_CODING_AGENT_DIR = agentDir
  // senpi's footer reads this marker to show the OmO Native badge for omo-ai installs, which load
  // the plugin via --extension and therefore never match the settings-packages detection gates.
  env.OMO_NATIVE = "1"
  // This launcher already decided which runtime the product runs on, possibly by re-execing itself
  // under bun. Handing that answer down stops the engine from making its own, conflicting choice.
  env.SENPI_RUNTIME = process.versions.bun ? "bun" : "node"
  env.SENPI_BRAND = JSON.stringify(brandProfile())
  const binDir = nearestNodeBin(senpiRoot)
  if (binDir) {
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH"
    const path = env[pathKey]
    env[pathKey] = path ? `${binDir}${delimiter}${path}` : binDir
    const shim = join(binDir, process.platform === "win32" ? "senpi.cmd" : "senpi")
    if (existsSync(shim)) env.SENPI_BIN = shim
  }
  // Anything resolving the product by name must re-enter through this launcher, otherwise it
  // would reach the engine directly and lose the brand.
  env.OMO_BIN = join(packageRoot, "bin", "omo.js")
  const merged = { ...env, ...overrides }
  // Only the interactive launch writes this record of the herdr hint it set (herdr-agent-hint.js),
  // after this function returns. No engine started here may carry one from the parent environment
  // or from a caller's overrides: the plugin would treat it as the launcher's and could remove a
  // HERDR_AGENT the user set (#10448).
  delete merged[HERDR_AGENT_MARKER]
  return merged
}

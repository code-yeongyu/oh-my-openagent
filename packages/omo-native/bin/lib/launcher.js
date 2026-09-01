import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"
import { spawnNode } from "./child-process.js"
import { runDoctor } from "./doctor.js"
import { migrateLegacyBunGlobalManifest } from "./legacy-bun-global-migration.js"
import { adoptLegacyFlatState, canonicalAgentDir } from "./agent-dir.js"
import { nearestNodeBin, packageManifest, packageRoot, readJson, resolveSenpi, updateTarget } from "./package-paths.js"
import { detectHarnesses } from "./setup-detect.js"
import { readSetupSuggestionCache, spawnSetupSuggestionRefresh } from "./setup-detect-cache.js"
import { printSetupReport } from "./setup-report.js"

const earlyCommands = new Set(["install", "remove", "list", "config", "auth", "app-server"])
const selfUpdateTargets = new Set(["self", "senpi", "omo"])
// Updating extensions or model catalogs is the engine's job; everything else under `update`
// would try to replace the pinned engine, so the launcher answers it instead.
const engineUpdateTargets = new Set(["--extensions", "--models"])

function isSelfUpdate(args) {
  if (args[0] !== "update") return false
  const rest = args.slice(1)
  if (rest.length === 0) return true
  if (rest.some((arg) => engineUpdateTargets.has(arg))) return false
  return rest.every((arg) => arg.startsWith("-") || selfUpdateTargets.has(arg))
}

// Identity the engine adopts for this install: what the user sees, where state lives, which
// environment prefix is read first, what goes on the wire, and which channel to check for
// updates. The engine consumes this once and scrubs it, so nested engine processes are
// unaffected.
function brandProfile() {
  const update = updateTarget()
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
    update: {
      packageName: "omo-ai",
      distTag: "beta",
      command: update.command,
      changelogUrl: "https://github.com/code-yeongyu/oh-my-openagent/releases",
    },
  }
}

function engineVersion() {
  try {
    return readJson(join(resolveSenpi().packageRoot, "package.json")).version
  } catch {
    return "unknown"
  }
}

function senpiEnvironment(senpiRoot) {
  const env = { ...process.env }
  delete env.OMO_BIN
  delete env.SENPI_BIN
  env.OMO_AGENT_TOOLKIT_BIN = join(packageRoot, "bin", "omo-agent-toolkit.js")
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
  return env
}

async function spawnSenpi(args, withExtension) {
  const senpi = resolveSenpi()
  const finalArgs = withExtension
    ? ["--extension", join(packageRoot, "plugin"), ...args]
    : args
  await spawnNode(senpi.cliPath, finalArgs, { env: senpiEnvironment(senpi.packageRoot) })
}

function isInteractiveDefault(args) {
  return process.stderr.isTTY === true && !args.includes("-p") && !args.includes("--print")
}

/**
 * Engine state that predates the unified directory is carried forward once, so unifying the
 * location never presents itself to the user as one more round of erased settings.
 */
function reportLegacyFlatAdoption() {
  let result
  try {
    result = adoptLegacyFlatState()
  } catch (error) {
    console.error(`omo: could not adopt legacy state: ${error.message}`)
    return
  }
  if (!result.adopted) return
  const moved = [...result.copied, ...result.backfilled].join(", ")
  console.error(`omo: carried forward settings from the legacy ~/.omo layout (${moved})`)
}

/**
 * The interactive banner's sibling-credential hint is advisory, so it must never gate the engine
 * spawn. It is answered synchronously from the suggestion cache; a stale or missing cache kicks
 * off a detached refresh (the launcher itself never writes the cache) and still answers this
 * launch from the cached or empty value. Any cache failure behaves as no-siblings: fail-open.
 */
function setupSuggestionForLaunch() {
  const cached = readSetupSuggestionCache()
  if (!cached.fresh) spawnSetupSuggestionRefresh()
  return cached.suggestion === true
}

export async function runLauncher(args = process.argv.slice(2)) {
  migrateLegacyBunGlobalManifest()
  reportLegacyFlatAdoption()
  const command = args[0]
  if (command === "ulw-loop") {
    await spawnNode(join(packageRoot, "plugin", "runtime", "agent-toolkit", "ulw-loop", "cli.js"), args.slice(1))
    return
  }
  if (command === "doctor") {
    runDoctor(await detectHarnesses(), args.slice(1))
    return
  }
  if (command === "setup") {
    printSetupReport(await detectHarnesses())
    process.exitCode = 0
    return
  }
  if ((command === "--version" || command === "-v") && args.length === 1) {
    console.log(`omo ${packageManifest().version} (engine: senpi ${engineVersion()})`)
    process.exitCode = 0
    return
  }
  // The engine is pinned by this package, so a self-update would break the pairing; every
  // self-update spelling is answered with the command that actually updates the product.
  if (isSelfUpdate(args)) {
    const update = updateTarget()
    console.log(`omo is updated via ${update.manager}: ${update.command}`)
    process.exitCode = 0
    return
  }
  if (earlyCommands.has(command) || command === "update") {
    await spawnSenpi(args, false)
    return
  }
  if (isInteractiveDefault(args)) {
    console.error(`omo (omo-ai beta ${packageManifest().version})`)
    if (process.stdout.isTTY === true && setupSuggestionForLaunch()) {
      console.error("omo: sibling credentials detected; run `omo setup` to review them")
    }
  }
  await spawnSenpi(args, true)
}

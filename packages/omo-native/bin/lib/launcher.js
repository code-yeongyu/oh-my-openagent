import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"
import { spawnNode } from "./child-process.js"
import { runDoctor } from "./doctor.js"
import { nearestNodeBin, packageManifest, packageRoot, readJson, resolveSenpi } from "./package-paths.js"
import { detectHarnesses, needsSetupSuggestion } from "./setup-detect.js"
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
  return {
    name: "omo",
    displayVersion: packageManifest().version,
    configDir: ".omo",
    flatLayout: true,
    envPrefix: "OMO",
    userAgent: "omo",
    originator: "omo",
    update: {
      packageName: "omo-ai",
      distTag: "beta",
      command: "npm i -g omo-ai@beta",
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

function environmentKey(environment, name) {
  return Object.keys(environment).find((key) => key.toLowerCase() === name.toLowerCase())
}

function prependPath(environment, directory, prioritize = false) {
  const pathKey = environmentKey(environment, "PATH") ?? "PATH"
  const currentPath = environment[pathKey]
  const pathEntries = currentPath ? currentPath.split(delimiter) : []
  const normalizedDirectory = directory.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase()
  const isDirectory = (entry) =>
    entry.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase() === normalizedDirectory
  if (prioritize) {
    environment[pathKey] = [directory, ...pathEntries.filter((entry) => !isDirectory(entry))].join(delimiter)
    return
  }
  if (!pathEntries.some(isDirectory)) environment[pathKey] = currentPath ? `${directory}${delimiter}${currentPath}` : directory
}

function restoreWindowsSystem32(environment) {
  if (process.platform !== "win32") return
  const systemRootKey = environmentKey(environment, "SystemRoot") ?? environmentKey(environment, "windir")
  const systemRoot = systemRootKey === undefined ? undefined : environment[systemRootKey]
  if (systemRoot) prependPath(environment, join(systemRoot, "System32"))
}

function senpiEnvironment(senpiRoot) {
  const env = { ...process.env }
  delete env.OMO_BIN
  delete env.SENPI_BIN
  env.OMO_AGENT_TOOLKIT_BIN = join(packageRoot, "bin", "omo-agent-toolkit.js")
  // senpi's footer reads this marker to show the OmO Native badge for omo-ai installs, which load
  // the plugin via --extension and therefore never match the settings-packages detection gates.
  env.OMO_NATIVE = "1"
  env.SENPI_BRAND = JSON.stringify(brandProfile())

  restoreWindowsSystem32(env)
  const binDir = nearestNodeBin(senpiRoot)
  if (binDir) {
    prependPath(env, binDir, true)
    const shim = join(binDir, process.platform === "win32" ? "senpi.cmd" : "senpi")
    if (existsSync(shim)) env.SENPI_BIN = shim
  }
  // Anything resolving the product by name must re-enter through this launcher, otherwise it
  // would reach the engine directly and lose the brand.
  env.OMO_BIN = join(packageRoot, "bin", "omo.js")
  return env
}

function spawnSenpi(args, withExtension) {
  const senpi = resolveSenpi()
  const finalArgs = withExtension
    ? ["--extension", join(packageRoot, "plugin"), ...args]
    : args
  spawnNode(senpi.cliPath, finalArgs, { env: senpiEnvironment(senpi.packageRoot) })
}

function isInteractiveDefault(args) {
  return process.stderr.isTTY === true && !args.includes("-p") && !args.includes("--print")
}

export async function runLauncher(args = process.argv.slice(2)) {
  const command = args[0]
  if (command === "ulw-loop") {
    spawnNode(join(packageRoot, "plugin", "runtime", "agent-toolkit", "ulw-loop", "cli.js"), args.slice(1))
    return
  }
  if (command === "doctor") {
    runDoctor(await detectHarnesses())
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
    console.log(`omo is updated via npm: ${brandProfile().update.command}`)
    process.exitCode = 0
    return
  }
  if (earlyCommands.has(command) || command === "update") {
    spawnSenpi(args, false)
    return
  }
  if (isInteractiveDefault(args)) {
    console.error(`omo (omo-ai beta ${packageManifest().version})`)
    if (process.stdout.isTTY === true && needsSetupSuggestion(await detectHarnesses())) {
      console.error("omo: sibling credentials detected; run `omo setup` to review them")
    }
  }
  spawnSenpi(args, true)
}

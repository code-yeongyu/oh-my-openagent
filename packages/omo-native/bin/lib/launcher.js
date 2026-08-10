import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"
import { spawnNode } from "./child-process.js"
import { runDoctor } from "./doctor.js"
import { nearestNodeBin, packageManifest, packageRoot, resolveSenpi } from "./package-paths.js"
import { detectHarnesses, needsSetupSuggestion } from "./setup-detect.js"
import { printSetupReport } from "./setup-report.js"

const earlyCommands = new Set(["install", "remove", "list", "config", "auth", "app-server"])

function environmentKey(environment, name) {
  return Object.keys(environment).find((key) => key.toLowerCase() === name.toLowerCase())
}

function prependPath(environment, directory) {
  const pathKey = environmentKey(environment, "PATH") ?? "PATH"
  const currentPath = environment[pathKey]
  const normalizedDirectory = directory.replace(/[\\/]+$/, "").toLowerCase()
  const hasDirectory = currentPath?.split(delimiter).some((entry) => (
    entry.replace(/[\\/]+$/, "").toLowerCase() === normalizedDirectory
  )) ?? false
  if (!hasDirectory) environment[pathKey] = currentPath ? `${directory}${delimiter}${currentPath}` : directory
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

  restoreWindowsSystem32(env)
  const binDir = nearestNodeBin(senpiRoot)
  if (binDir) {
    prependPath(env, binDir)
    const shim = join(binDir, process.platform === "win32" ? "senpi.cmd" : "senpi")
    if (existsSync(shim)) env.SENPI_BIN = shim
  }
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
  if (command === "update" && args.length === 1) {
    console.log("omo is updated via npm: npm i -g omo-ai@beta")
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

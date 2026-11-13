import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { OMO_BRAND_LOGO } from "../../../omo-native/bin/lib/brand-logo.generated.js"
import { LAUNCHER_CMD_SHIM, LAUNCHER_HEADER, launcherCmdOwnership, launcherOwnership } from "./launcher-ownership"

/**
 * Local `omo` launcher for a sibling-store install.
 *
 * The published omo-ai package ships a launcher that hands the engine its brand profile. A
 * local install runs the user's own senpi checkout instead, so it needs the same launcher to
 * present the same product: without it the local route boots as senpi with an omo extension.
 */

export interface LocalLauncherOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly homeDir?: string
  readonly pluginPath: string
  readonly senpiCliPath: string
  readonly version?: string
  readonly platform?: NodeJS.Platform
}

export function localLauncherPath(homeDir: string = homedir()): string {
  return join(homeDir, ".local", "bin", "omo")
}

/** Windows cannot execute an extensionless shebang script, so it gets a resolvable wrapper. */
export function localLauncherCmdPath(homeDir: string = homedir()): string {
  return join(homeDir, ".local", "bin", "omo.cmd")
}

/** The npm channel a build ships on: a prerelease version is on beta, a stable one on latest. */
function releaseChannel(version: string | undefined): "beta" | "latest" {
  return version !== undefined && version.includes("-") ? "beta" : "latest"
}

export function renderLocalLauncher(options: LocalLauncherOptions): string {
  const channel = releaseChannel(options.version)
  const updateCommand = channel === "beta" ? "bun add -g omo-ai@beta" : "bun add -g omo-ai"
  const brand = {
    name: "OmO",
    logo: OMO_BRAND_LOGO,
    command: "omo",
    displayVersion: options.version ?? "local",
    configDir: ".omo",
    // Engine state lives at the canonical `~/.omo/agent`; a flat home would disagree with the
    // directory the launcher pins below and with every other omo surface.
    flatLayout: false,
    envPrefix: "OMO",
    userAgent: "omo",
    originator: "omo",
    changelog: {
      path: join(options.pluginPath, "CHANGELOG.md").replaceAll("\\", "/"),
    },
    // Same channel the published launcher declares, so a local install is never told to update
    // the engine it is pinned against.
    update: {
      packageName: "omo-ai",
      distTag: channel,
      command: updateCommand,
      changelogUrl: "https://github.com/code-yeongyu/oh-my-openagent/releases",
    },
  }
  return `${LAUNCHER_HEADER}import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"

const brand = ${JSON.stringify(brand)}
const cli = process.env.OMO_SENPI_CLI_PATH ?? ${JSON.stringify(options.senpiCliPath)}
const plugin = process.env.OMO_PLUGIN_ROOT ?? ${JSON.stringify(options.pluginPath)}
// The same directory the published launcher pins, so a local install shares one state location
// with the published one and with anything either of them spawns.
const agentDir = process.env.OMO_CODING_AGENT_DIR ?? process.env.SENPI_CODING_AGENT_DIR
  ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".omo", "agent")
const env = {
  ...process.env,
  SENPI_BRAND: JSON.stringify(brand),
  OMO_NATIVE: "1",
  OMO_CODING_AGENT_DIR: agentDir,
  SENPI_CODING_AGENT_DIR: agentDir,
}
// Anything resolving the product by name must re-enter through this launcher, never the engine.
env.OMO_BIN = process.argv[1]
const selfUpdate = process.argv[2] === "update"
  && process.argv.slice(3).every((arg) => arg.startsWith("-") || ["self", "senpi", "omo"].includes(arg))
  && !process.argv.slice(3).some((arg) => arg === "--extensions" || arg === "--models")
if (selfUpdate) {
  console.log(${JSON.stringify(`omo is updated via bun: ${updateCommand}`)})
  process.exit(0)
}
// windowsHide-exempt: this is the interactive foreground CLI, spawned with inherited stdio.
// CREATE_NO_WINDOW would suppress the console a console-less launch needs to render the TUI,
// so the launcher keeps the user's console instead of hiding it (#8501).
const child = spawn(process.execPath, [cli, "--extension", plugin, ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
})
child.on("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exitCode = code ?? 1
})
`
}

/**
 * Writes the launcher, returning its path. Overwrites only a launcher this installer wrote (`launcherOwnership`): a
 * compiled omo, another install's launcher or a symlink there is left alone and `undefined` is returned. On Windows
 * the `omo.cmd` wrapper is written beside it, never over a wrapper the installer did not write.
 */
export function installLocalLauncher(options: LocalLauncherOptions): string | undefined {
  const path = localLauncherPath(options.homeDir)
  if (launcherOwnership(path).kind === "foreign") return undefined

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, renderLocalLauncher(options))
  chmodSync(path, 0o755)
  if ((options.platform ?? process.platform) === "win32") {
    const cmd = localLauncherCmdPath(options.homeDir)
    if (launcherCmdOwnership(cmd).kind !== "foreign") writeFileSync(cmd, LAUNCHER_CMD_SHIM)
  }
  return path
}

/** Removes the launcher and its `omo.cmd` wrapper, but only files this installer wrote. */
export function uninstallLocalLauncher(homeDir: string = homedir()): boolean {
  const path = resolve(localLauncherPath(homeDir))
  if (launcherOwnership(path).kind !== "owned") return false

  rmSync(path)
  const cmd = localLauncherCmdPath(homeDir)
  if (launcherCmdOwnership(cmd).kind === "owned") rmSync(cmd)
  return true
}

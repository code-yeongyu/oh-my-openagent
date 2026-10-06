import { spawnSync } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { delimiter, isAbsolute, join, relative, sep } from "node:path"
import { isEngineCommand } from "./engine-commands.js"
import { spawnNode } from "./child-process.js"
import { doctorCoverageLines } from "./category-coverage.js"
import { doctorComputerUseLines } from "./computer-use-doctor.js"
import { doctorConfigLines } from "./config-doctor.js"
import { runDaemonCommand } from "./daemon.js"
import { runThreadCommand } from "./thread.js"
import { isHostStatusAll, runHostStatusAll, sessionActivityReader } from "./host-status.js"
import { runDoctor } from "./doctor.js"
import { ensureEnginePrepared, preparePluginLaunchSpec } from "./engine-prepare.js"
import { migrateLegacyBunGlobalManifest } from "./legacy-bun-global-migration.js"
import { adoptLegacyFlatState, canonicalAgentDir } from "./agent-dir.js"
import { nearestNodeBin, packageManifest, packageRoot, readJson, releaseBanner, releaseChannel, resolveSenpi, updateTarget } from "./package-paths.js"
import { runSelfUpdate } from "./self-update.js"
import { isSelfUpdate } from "./update-args.js"
import { detectHarnesses } from "./setup-detect.js"
import { readSetupSuggestionCache, spawnSetupSuggestionRefresh } from "./setup-detect-cache.js"
import { printSetupReport } from "./setup-report.js"

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

function engineVersion() {
  try {
    return readJson(join(resolveSenpi().packageRoot, "package.json")).version
  } catch {
    return "unknown"
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

function senpiEnvironment(senpiRoot) {
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
  return env
}

function preparedSenpi() {
  preparePluginLaunchSpec({ pluginRoot: join(packageRoot, "plugin") })
  const senpi = resolveSenpi()
  ensureEnginePrepared({
    senpiRoot: senpi.packageRoot,
    omoVersion: packageManifest().version,
    reinstallCommand: updateTarget().command,
  })
  return senpi
}

async function spawnSenpi(args, withExtension) {
  const senpi = preparedSenpi()
  const finalArgs = withExtension
    ? ["--extension", join(packageRoot, "plugin"), ...args]
    : args
  const env = senpiEnvironment(senpi.packageRoot)
  if (process.platform !== "win32" && typeof process.execve === "function") {
    try {
      process.execve(process.execPath, [process.execPath, senpi.cliPath, ...finalArgs], env)
      return
    } catch {
      // A failed replacement still uses the signal-aware child path below.
    }
  }
  await spawnNode(senpi.cliPath, finalArgs, { env })
}

// Routine launch notices go straight to stderr: Bun renders every console.error line red on a
// color terminal, which made a healthy startup look like a failure (#8442).
function notice(line) {
  process.stderr.write(`${line}\n`)
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
  notice(`omo: carried forward settings from the legacy ~/.omo layout (${moved})`)
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

/**
 * One call into the engine's host CLI. It prints a single JSON line and exits, so the output is
 * captured rather than inherited - `omo daemon` has to read the engine's answer to turn it into
 * an exit code, and `spawnSync` is honest about a call that is expected to be this short.
 */
export function engineHostCall(engineArgs, options) {
  const senpi = preparedSenpi()
  const result = spawnSync(process.execPath, [senpi.cliPath, ...engineArgs], {
    encoding: "utf8",
    env: { ...senpiEnvironment(senpi.packageRoot), ...options.env },
    windowsHide: true,
  })
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
}

export function rollbackMigrateCall(request) {
  const runtime = join(packageRoot, "plugin", "runtime", "rollback-migrate.js")
  const result = spawnSync(process.execPath, [runtime], {
    encoding: "utf8",
    input: JSON.stringify(request),
    env: senpiEnvironment(preparedSenpi().packageRoot),
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `rollback migration runtime exited ${result.status ?? 1}`)
  }
  return JSON.parse(result.stdout)
}

export async function runLauncher(args = process.argv.slice(2)) {
  migrateLegacyBunGlobalManifest()
  reportLegacyFlatAdoption()
  const command = args[0]
  // The toolkit CLI is no longer part of the Native payload; the loop is driven in-process by the
  // eval SDK the extension publishes. Report that plainly instead of failing on a missing file.
  if (command === "ulw-loop") {
    console.error('omo ulw-loop is unavailable in this build: use the agent toolkit SDK from an eval js cell: const { agentToolkit } = await import(`${env("OMO_AGENT_TOOLKIT_SDK_ROOT")}/sdk.js`); print(await agentToolkit.status()) (Codex keeps the standalone CLI).')
    process.exitCode = 2
    return
  }
  if (command === "thread") {
    process.exitCode = await runThreadCommand(args.slice(1), {
      engine: { run: engineHostCall },
      pluginRoot: join(packageRoot, "plugin"),
      agentDir: canonicalAgentDir(),
      env: process.env,
      cwd: process.cwd(),
      stdout: process.stdout,
      stderr: process.stderr,
      platform: process.platform,
    })
    return
  }
  // The daemon is the engine's to run; omo only supplies the launch spec, the task settings from
  // the omo config (daemon-config.js), and an exit code the caller can branch on.
  if (command === "daemon") {
    const outcome = await runDaemonCommand(args.slice(1), {
      engine: { run: engineHostCall },
      migration: { run: rollbackMigrateCall },
      pluginRoot: join(packageRoot, "plugin"),
      agentDir: canonicalAgentDir(),
      env: process.env,
      stdout: process.stdout,
      stderr: process.stderr,
      platform: process.platform,
    })
    // `omo daemon adopt`: the host released the session, so it resumes here as a normal launch, in its own directory.
    if (typeof outcome === "object" && Array.isArray(outcome.launch)) {
      if (typeof outcome.cwd === "string" && existsSync(outcome.cwd)) process.chdir(outcome.cwd)
      await spawnSenpi(outcome.launch, true)
      return
    }
    process.exitCode = outcome
    return
  }
  if (command === "doctor") {
    // Doctor is a launch too: it reports only what the launch-time preparation could not fix.
    preparePluginLaunchSpec({ pluginRoot: join(packageRoot, "plugin") })
    const [categoryCoverage, computerUse, configDiagnostics, gateway] = args[1] === "--reap"
      ? [[], [], [], []]
      : await Promise.all([
          doctorCoverageLines({ agentDir: canonicalAgentDir() }),
          doctorComputerUseLines(),
          doctorConfigLines(),
          import("./gateway.js").then((hook) => hook.gatewayDoctorLines()),
        ])
    runDoctor(await detectHarnesses(), args.slice(1), {
      daemonEngine: { run: engineHostCall },
      categoryCoverage,
      computerUse,
      configDiagnostics,
      gateway,
    })
    return
  }
  if (command === "gateway") {
    const { runGatewayCommand } = await import("./gateway.js")
    process.exitCode = await runGatewayCommand(args.slice(1))
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
  // self-update spelling runs the product command instead of asking senpi to move the pin.
  if (isSelfUpdate(args)) {
    process.exitCode = await runSelfUpdate(args)
    return
  }
  // app-server takes the plugin after its subcommand: a leading --extension never reaches the
  // engine's app-server dispatch. It loads into every thread, including the daemon's.
  if (command === "app-server") {
    await spawnSenpi(args.includes("--no-extensions") ? args : [...args, "--extension", join(packageRoot, "plugin")], false)
    return
  }
  // `host status --all` stays the engine's answer; omo only adds each terminal row's last activity.
  if (isHostStatusAll(args, process.env)) {
    process.exitCode = await runHostStatusAll(args, {
      engine: { run: engineHostCall },
      env: process.env,
      stdout: process.stdout,
      stderr: process.stderr,
      readActivity: await sessionActivityReader(join(packageRoot, "plugin")),
    })
    return
  }
  // One-shot engine commands go over unchanged: the engine dispatches them on argv[0] (#9572).
  if (isEngineCommand(args)) {
    await spawnSenpi(args, false)
    return
  }
  if (isInteractiveDefault(args)) {
    notice(releaseBanner())
    if (process.stdout.isTTY === true && setupSuggestionForLaunch()) {
      notice("omo: sibling credentials detected; run `omo setup` to review them")
    }
  }
  await spawnSenpi(args, true)
}

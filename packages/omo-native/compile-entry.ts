import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  embeddedText,
  materializeProvisionedExecutable,
  provisionEmbeddedRuntime,
  runningExecutablePath,
  selectRuntimeManifest,
  type EmbeddedFile,
  type EmbeddedManifest,
} from "./compile-runtime"
import { handOffToProvisionedRuntime, planProvisionedLaunch } from "./provisioned-handoff"
import { buildLabel, parseBuildInfo, parseEngineBuildStamp, versionLines } from "./build-info"
import { compiledUpdate, fetchGitHubReleases, releaseAssetName, RELEASES_URL } from "./compiled-update"
import { migrateLegacyBunGlobalManifest } from "./bin/lib/legacy-bun-global-migration.js"
import { adoptLegacyFlatState, canonicalAgentDir } from "./bin/lib/agent-dir.js"
import { nearestNodeBin, readJson, releaseBanner } from "./bin/lib/package-paths.js"
import { runDaemonCommand } from "./bin/lib/daemon.js"
import { runThreadCommand } from "./bin/lib/thread.js"
import { runDoctor } from "./bin/lib/doctor.js"
import { isSelfUpdate, updateUsageAnswer } from "./bin/lib/update-args.js"
import { detectHarnesses } from "./bin/lib/setup-detect.js"
import { runSetup } from "./bin/lib/setup-import.js"
import { runCompiledDoctor, type CompiledDoctorOptions } from "./compiled-doctor"
import { compiledDiagnosticRuntimeLoader, loadCompiledCoverageEngine } from "./compiled-diagnostic-runtime"
import { isInternalSupervisorLaunch, runInternalSupervisor } from "./supervisor-fast-path"
import { registerEngineRuntimeModules } from "./engine-runtime-modules"
import { applyCachedClaudeCode } from "../omo-senpi/src/components/claude-code/index"
import { spawnSync } from "node:child_process"
import { delimiter } from "node:path"
import {
  migrateHostSessionSockets,
  planHostSessionSocketMigration,
} from "../senpi-task/src/store/rollback-migrate"
import { pruneMissingStoreIndexEntriesSync } from "../senpi-task/src/runners/rpc-host/store-index"

// The engine is imported via a RELATIVE string LITERAL, inlined at both import
// sites, and both properties are load-bearing:
//  - `@code-yeongyu/senpi/dist/cli.js` is not in senpi's exports map (only ".",
//    "./bun-runtime", "./rpc-entry", "./client"), so the bare subpath fails
//    exports enforcement at build time.
//  - bun's bundler only traces import() whose argument is a literal: a
//    module-level const or a runtime-resolved URL (import.meta.resolve +
//    pathToFileURL) drops the entire engine graph from the binary (1 module
//    bundled instead of ≈4000) and the latter also fails to resolve inside
//    $bunfs. Do NOT refactor these two literals into an indirection.
// Probe receipts: .omo/evidence/20260825-bun-compile-release-binaries/

const earlyCommands = new Set(["install", "remove", "list", "config", "auth", "app-server", "host"])

export function buildSenpiArgs(args: string[], execDir: string): string[] {
  const command = args[0]
  // Same placement as the launcher: app-server only reads --extension after its subcommand.
  if (command === "app-server") return args.includes("--no-extensions") ? args : [...args, "--extension", join(execDir, "plugin")]
  if (earlyCommands.has(command) || command === "update") return args
  // `--no-extensions` is the caller owning the extension list: a memory child lists none and an
  // RPC task child lists this plugin itself, so injecting it here would load the plugin into a
  // bare child or load it twice.
  if (args.includes("--no-extensions")) return args
  return ["--extension", join(execDir, "plugin"), ...args]
}

export function versionLine(
  packageJson: { version: string; omoBuild?: unknown; engineBuild?: unknown },
  enginePin: string,
): string {
  const info = parseBuildInfo(packageJson.omoBuild)
  if (info !== undefined) return versionLines(info).join("\n")
  const stamp = parseEngineBuildStamp(packageJson.engineBuild)
  if (stamp?.scheme === "epoch") {
    return `omo ${packageJson.version} (engine: senpi ${enginePin}+${stamp.epoch}.${stamp.sha7}; scheme epoch)`
  }
  return `omo ${packageJson.version} (engine: senpi ${enginePin}; scheme nodef)`
}

/**
 * A dev build is refreshed by rebuilding it. A release binary resolves its update in `main()` from the
 * embedded manifest (see compiled-update.ts); any other caller has no binary to replace.
 */
export function updateHint(rawBuildInfo: unknown, platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  const info = parseBuildInfo(rawBuildInfo)
  if (info !== undefined) return `rebuild with: bun run ${info.command}`
  return `omo update runs from the compiled omo binary; download ${releaseAssetName(undefined, platform, arch)} from ${RELEASES_URL}`
}

export function remapSenpiEnvironment(source: NodeJS.ProcessEnv = process.env, execDir: string): NodeJS.ProcessEnv {
  const env = { ...source }
  delete env.OMO_BIN
  delete env.SENPI_BIN
  const agentDir = canonicalAgentDir(env)
  env.OMO_CODING_AGENT_DIR = agentDir
  env.SENPI_CODING_AGENT_DIR = agentDir
  // The engine resolves its package dir from PACKAGE_DIR before falling back to
  // dirname(process.execPath). Provisioning can complete without a re-exec (and the
  // size guard in materializeProvisionedExecutable makes that path common), so
  // execPath may stay at the user's install path while the payload lives under
  // execDir - pin the root explicitly rather than trusting the running image.
  env.OMO_PACKAGE_DIR = execDir
  env.SENPI_PACKAGE_DIR = execDir
  env.OMO_NATIVE = "1"
  env.SENPI_RUNTIME = process.versions.bun ? "bun" : "node"
  let displayVersion = "unknown"
  let devCommand: string | undefined
  let devUpdateCommand: string | undefined
  let changelogVersion: string | undefined
  try {
    const stamped = readJson(join(execDir, "package.json")) as { version?: string; omoBuild?: unknown }
    displayVersion = typeof stamped.version === "string" ? stamped.version : "unknown"
    const info = parseBuildInfo(stamped.omoBuild)
    if (info !== undefined) {
      devCommand = info.command
      devUpdateCommand = `rebuild with: bun run ${info.command}`
      displayVersion = buildLabel(info)
    } else {
      const pluginManifest = readJson(join(execDir, "plugin", "package.json")) as { version?: string }
      changelogVersion = typeof pluginManifest.version === "string" ? pluginManifest.version : undefined
    }
  } catch { /* test fixtures may omit the sibling manifest */ }
  env.SENPI_BRAND = JSON.stringify({
    name: "OmO", command: devCommand ?? "omo", displayVersion,
    configDir: ".omo", flatLayout: false, envPrefix: "OMO", userAgent: "omo", originator: "omo",
    changelog: {
      path: join(execDir, "plugin", "CHANGELOG.md"),
      ...(changelogVersion === undefined ? {} : { version: changelogVersion }),
    },
    update: { packageName: "omo-ai", distTag: displayVersion.includes("-") ? "beta" : "latest", command: devUpdateCommand ?? "omo update", changelogUrl: "https://github.com/code-yeongyu/oh-my-openagent/releases" },
  })
  const binDir = nearestNodeBin(execDir)
  if (binDir) {
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH"
    env[pathKey] = env[pathKey] ? `${binDir}${delimiter}${env[pathKey]}` : binDir
    const shim = join(binDir, process.platform === "win32" ? "senpi.cmd" : "senpi")
    if (existsSync(shim)) env.SENPI_BIN = shim
  }
  env.OMO_BIN = join(execDir, process.platform === "win32" ? "omo.exe" : "omo")
  return env
}

type CompiledLauncherOptions = CompiledDoctorOptions & {
  readonly runSetup?: (args: string[], options: Record<string, unknown>) => Promise<void>
}

export function compiledUpdateCommand(rawBuildInfo: unknown): string {
  const info = parseBuildInfo(rawBuildInfo)
  return info === undefined ? "omo update" : `rebuild with: bun run ${info.command}`
}

function answerUpdateHint(args: string[], rawBuildInfo: unknown): void {
  const usage = updateUsageAnswer(args)
  if (usage === undefined) {
    console.log(updateHint(rawBuildInfo))
    return
  }
  ;(usage.stream === "stderr" ? console.error : console.log)(usage.text)
  process.exitCode = usage.exitCode
}

export function answerCompiledFastPath(
  args: string[],
  manifest: Pick<EmbeddedManifest, "omoAiVersion" | "enginePin" | "buildInfo" | "engineBuild">,
): boolean {
  if ((args[0] === "--version" || args[0] === "-v") && args.length === 1) {
    console.log(versionLine({
      version: manifest.omoAiVersion,
      omoBuild: manifest.buildInfo,
      engineBuild: manifest.engineBuild,
    }, manifest.enginePin))
    return true
  }
  if (isSelfUpdate(args)) {
    answerUpdateHint(args, manifest.buildInfo)
    return true
  }
  return false
}

/**
 * The startup banner's provenance lines. A stamped dev build renders the same full SHAs,
 * ISO commit dates and branches as `--version` and `doctor`; anything else keeps the
 * release one-liner.
 */
export function compiledBannerLines(manifest: Pick<EmbeddedManifest, "omoAiVersion" | "buildInfo">): string[] {
  const info = parseBuildInfo(manifest.buildInfo)
  return info === undefined ? [releaseBanner(manifest.omoAiVersion)] : versionLines(info)
}

export function shouldPrintCompiledBanner(args: string[], stderrIsTTY: boolean): boolean {
  if (!stderrIsTTY) return false
  if (args.includes("-p") || args.includes("--print") || args.includes("--mode")) return false
  const command = args[0]
  if (command === undefined) return true
  if (earlyCommands.has(command)) return false
  if (command === "update" || command === "doctor" || command === "setup" || command === "ulw-loop") return false
  if (command === "--version" || command === "-v") return false
  return true
}

type CompiledRollbackMigrationRequest =
  | {
      readonly operation?: "migrate"
      readonly storeDir: string
      readonly to: string
      readonly deadEndpoints?: readonly string[]
      readonly dryRun?: boolean
      readonly planOnly?: boolean
    }
  | {
      readonly operation: "prune-store-index"
      readonly indexPath: string
    }

function compiledRollbackMigration() {
  return {
    run(request: CompiledRollbackMigrationRequest) {
      if (request.operation === "prune-store-index") {
        return { removed: pruneMissingStoreIndexEntriesSync(request.indexPath) }
      }
      if (request.planOnly) {
        return planHostSessionSocketMigration(request.storeDir, request.to)
      }
      return migrateHostSessionSockets(request.storeDir, {
        to: request.to,
        deadEndpoints: new Set(request.deadEndpoints ?? []),
        dryRun: request.dryRun,
      })
    },
  }
}

export async function runCompiledLauncher(args: string[], execDir: string, enginePin = "unknown", compiledPackageRoot?: string, migration: CompiledLauncherOptions = {}): Promise<boolean> {
  const packageJson = readJson(join(execDir, "package.json")) as { version: string; omoBuild?: unknown }
  migrateLegacyBunGlobalManifest(execDir)
  adoptLegacyFlatState()
  const command = args[0]
  // The toolkit CLI is no longer shipped in the Native payload: the loop runs in-process behind the
  // eval SDK the extension publishes. Answer with a named result instead of an ENOENT spawn failure.
  if (command === "ulw-loop") {
    process.stderr.write('omo ulw-loop is unavailable in this build: use the agent toolkit SDK from an eval js cell: const { agentToolkit } = await import(`${env("OMO_AGENT_TOOLKIT_SDK_ROOT")}/sdk.js`); print(await agentToolkit.status()) (Codex keeps the standalone CLI).\n')
    process.exitCode = 2
    return true
  }
  // The compiled binary IS the engine's process, so the host CLI is reached by re-running this
  // executable with `host ...` - an early command that goes to the engine untouched. Spawning a
  // node path here would re-enter omo itself and leave a phantom session behind.
  const engine = {
    run(engineArgs: string[], options: { env: Record<string, string | undefined> }) {
      const result = spawnSync(process.execPath, engineArgs, { encoding: "utf8", env: options.env, windowsHide: true })
      return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
    },
  }
  if (command === "thread") {
    process.exitCode = await runThreadCommand(args.slice(1), {
      engine,
      pluginRoot: join(execDir, "plugin"),
      agentDir: canonicalAgentDir(),
      env: process.env,
      cwd: process.cwd(),
      stdout: process.stdout,
      stderr: process.stderr,
      platform: process.platform,
    })
    return true
  }
  if (command === "daemon") {
    const outcome = await runDaemonCommand(args.slice(1), {
      engine,
      migration: compiledRollbackMigration(),
      pluginRoot: join(execDir, "plugin"),
      agentDir: canonicalAgentDir(),
      env: process.env,
      stdout: process.stdout,
      stderr: process.stderr,
      platform: process.platform,
    })
    if (typeof outcome === "object" && "launch" in outcome) {
      // `omo daemon adopt`: the released session resumes here as a normal launch, in its own directory.
      process.argv.splice(2, process.argv.length - 2, ...outcome.launch)
      if (typeof outcome.cwd === "string" && existsSync(outcome.cwd)) process.chdir(outcome.cwd)
      return false
    }
    if (typeof outcome === "object") {
      // A reachable daemon: continue as a normal launch pointed at the shared socket.
      process.argv.splice(2, process.argv.length - 2, ...outcome.args)
      Object.assign(process.env, outcome.env)
      return false
    }
    process.exitCode = outcome
    return true
  }
  if (command === "doctor") {
    const inventory = await detectHarnesses()
    if (compiledPackageRoot) {
      const stamped = readJson(join(compiledPackageRoot, "package.json")) as { version: string; omoBuild?: unknown; engineBuild?: unknown }
      await runCompiledDoctor({
        inventory,
        execDir: compiledPackageRoot,
        version: stamped.version,
        versionText: versionLine(stamped, enginePin),
        updateCommand: compiledUpdateCommand(stamped.omoBuild),
        engine,
        args: args.slice(1),
        options: migration,
      })
    } else runDoctor(inventory, [], { daemonEngine: engine })
    return true
  }
  // The same consent-gated import as `bin/omo.js`, with its coverage row answered by this binary.
  if (command === "setup") {
    await (migration.runSetup ?? runSetup)(args.slice(1), {
      loadCoverageRuntime: compiledDiagnosticRuntimeLoader(compiledPackageRoot ?? execDir),
      loadCoverageEngine: loadCompiledCoverageEngine,
    })
    return true
  }
  if ((command === "--version" || command === "-v") && args.length === 1) { console.log(versionLine(packageJson, enginePin ?? "unknown")); return true }
  if (isSelfUpdate(args)) { answerUpdateHint(args, packageJson.omoBuild); return true }
  return false
}

export { reexecProvisionedRuntime } from "./provisioned-handoff"

async function main(): Promise<void> {
  const embedded = (globalThis as typeof globalThis & { Bun?: { embeddedFiles?: EmbeddedFile[] } }).Bun?.embeddedFiles as EmbeddedFile[] | undefined
  if (!embedded?.length) {
    const execDir = dirname(fileURLToPath(import.meta.url))
    if (await runCompiledLauncher(process.argv.slice(2), execDir)) return
    process.argv.splice(2, process.argv.length - 2, ...buildSenpiArgs(process.argv.slice(2), execDir))
    Object.assign(process.env, remapSenpiEnvironment(process.env, execDir))
    await registerEngineRuntimeModules()
    await import("../../node_modules/@code-yeongyu/senpi/dist/cli.js") // literal: see import note above
    return
  }
  const manifestFile = await selectRuntimeManifest(embedded)
  if (!manifestFile) throw new Error("embedded runtime-manifest.json is missing")
  const manifest = JSON.parse(await embeddedText(manifestFile)) as EmbeddedManifest
  const runningExecutable = runningExecutablePath()
  const expected = join(homedir(), ".omo", "binary-runtime", manifest.omoAiVersion, process.platform === "win32" ? "omo.exe" : "omo")
  const launch = planProvisionedLaunch(runningExecutable, expected)
  // Materialize the provisioned runtime BEFORE answering the informational fast-path.
  // First-run provisioning must happen even for `--version`/`-v`: the release smoke test
  // asserts the provisioned binary exists after `--version`, and provisioning used to be a
  // side effect of the (now-skipped) re-exec. Only the re-exec (relocate) is deferred here,
  // so an already-provisioned install keeps the fast-path's no-re-exec speed.
  if (launch.provision) {
    await provisionEmbeddedRuntime(manifest, embedded, dirname(expected))
    materializeProvisionedExecutable(runningExecutable, expected)
  }
  if (isSelfUpdate(process.argv.slice(2)) && parseBuildInfo(manifest.buildInfo) === undefined) {
    const result = await compiledUpdate({
      omoAiVersion: manifest.omoAiVersion,
      releaseTarget: manifest.releaseTarget,
      destination: runningExecutable,
      platform: process.platform,
      arch: process.arch,
      fetchReleases: fetchGitHubReleases,
      args: process.argv.slice(2),
    })
    ;(result.stream === "stderr" ? console.error : console.log)(result.output)
    process.exitCode = result.exitCode
    return
  }
  if (answerCompiledFastPath(process.argv.slice(2), manifest)) return
  if (launch.handOff) {
    await handOffToProvisionedRuntime(expected)
    return
  }
  const execDir = launch.execDir
  // Inspector and custom execArgv isolation is unsupported in compiled binaries; the provisioned
  // executable delegates to the engine in-process as required by the native startup contract.
  if (await runCompiledLauncher(process.argv.slice(2), execDir, manifest.enginePin, execDir)) return
  if (shouldPrintCompiledBanner(process.argv.slice(2), process.stderr.isTTY === true)) {
    // Not console.error: Bun renders that red, and the banner is not an error (#8442).
    for (const line of compiledBannerLines(manifest)) process.stderr.write(`${line}\n`)
  }
  process.argv.splice(2, process.argv.length - 2, ...buildSenpiArgs(process.argv.slice(2), execDir))
  Object.assign(process.env, remapSenpiEnvironment(process.env, execDir))
  applyCachedClaudeCode(process.env, execDir)
  if (isInternalSupervisorLaunch(process.argv.slice(2)) && await runInternalSupervisor(process.argv.slice(2))) return
  await registerEngineRuntimeModules()
  await import("../../node_modules/@code-yeongyu/senpi/dist/cli.js") // literal: see import note above
}

if (import.meta.main) await main()

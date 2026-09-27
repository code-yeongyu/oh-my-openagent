import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  embeddedText,
  isProvisionedExecutable,
  materializeProvisionedExecutable,
  provisionEmbeddedRuntime,
  runningExecutablePath,
  selectRuntimeManifest,
  shouldReexecAfterProvisioning,
  type EmbeddedFile,
  type EmbeddedManifest,
} from "./compile-runtime"
import { propagateResult, runChild } from "./bin/lib/child-process.js"
import { buildLabel, parseBuildInfo, parseEngineBuildStamp, versionLines } from "./build-info"
import { migrateLegacyBunGlobalManifest } from "./bin/lib/legacy-bun-global-migration.js"
import { adoptLegacyFlatState, canonicalAgentDir } from "./bin/lib/agent-dir.js"
import { nearestNodeBin, readJson, releaseBanner } from "./bin/lib/package-paths.js"
import { daemonReportLines, runDaemonCommand } from "./bin/lib/daemon.js"
import { runDoctor } from "./bin/lib/doctor.js"
import { detectHarnesses, needsSetupSuggestion } from "./bin/lib/setup-detect.js"
import { printSetupReport } from "./bin/lib/setup-report.js"
import { spawnSync } from "node:child_process"
import { delimiter } from "node:path"
import { registerBunOAuthFlows } from "../../node_modules/@code-yeongyu/senpi/node_modules/@earendil-works/pi-ai/dist/bun-oauth.js"

// Register statically bundled OAuth flows before loading senpi's CLI graph.
// Bun's compiled filesystem cannot resolve the opaque dynamic cursor loader.
registerBunOAuthFlows()

// The engine is imported via a RELATIVE string LITERAL, inlined at both import
// sites, and both properties are load-bearing:
//  - `@code-yeongyu/senpi/dist/cli.js` is not in senpi's exports map (only ".",
//    "./rpc-entry", "./client"), so the bare subpath fails exports enforcement
//    at build time.
//  - bun's bundler only traces import() whose argument is a literal: a
//    module-level const or a runtime-resolved URL (import.meta.resolve +
//    pathToFileURL) drops the entire engine graph from the binary (1 module
//    bundled instead of ≈4000) and the latter also fails to resolve inside
//    $bunfs. Do NOT refactor these two literals into an indirection.
// Probe receipts: .omo/evidence/20260825-bun-compile-release-binaries/

const earlyCommands = new Set(["install", "remove", "list", "config", "auth", "app-server", "host"])
const selfUpdateTargets = new Set(["self", "senpi", "omo"])
const engineUpdateTargets = new Set(["--extensions", "--models"])
const doctorArtifacts = [
  ["plugin manifest", "plugin/package.json"],
  ["extension", "plugin/extensions/omo.js"],
  ["lsp-daemon runtime", "plugin/runtime/lsp-daemon/dist/cli.js"],
] as const

export function buildSenpiArgs(args: string[], execDir: string): string[] {
  const command = args[0]
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

export function updateAssetSlug(platform: NodeJS.Platform, arch: string): string {
  const os = platform === "win32" ? "windows" : platform
  const slug = `omo-${os}-${arch}`
  return platform === "win32" ? `${slug}.exe` : slug
}

/** A dev build is refreshed by rebuilding it; only release binaries come from the curl line. */
export function updateHint(rawBuildInfo: unknown, platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  const info = parseBuildInfo(rawBuildInfo)
  return info === undefined ? updateLine(platform, arch) : `rebuild with: bun run ${info.command}`
}

export function updateLine(platform: NodeJS.Platform, arch: string): string {
  const asset = updateAssetSlug(platform, arch)
  const dest = platform === "win32" ? "omo.exe" : "omo"
  return `omo is updated via curl: curl -fsSL https://github.com/code-yeongyu/oh-my-openagent/releases/latest/download/${asset} -o ${dest} && chmod +x ${dest}`
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
    update: { packageName: "omo-ai", distTag: displayVersion.includes("-") ? "beta" : "latest", command: devUpdateCommand ?? updateLine(process.platform, process.arch), changelogUrl: "https://github.com/code-yeongyu/oh-my-openagent/releases" },
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

type DaemonEngine = { run(args: string[], options: { env: Record<string, string | undefined> }): { exitCode: number; stdout: string; stderr: string } }

function runCompiledDoctor(inventory: Awaited<ReturnType<typeof detectHarnesses>>, execDir: string, enginePin: string, engine?: DaemonEngine): void {
  let failed = false
  const lines: string[] = []
  for (const [label, artifact] of doctorArtifacts) {
    if (existsSync(join(execDir, artifact))) lines.push(`PASS ${label}: ${artifact}`)
    else {
      lines.push(`FAIL ${label}: missing ${artifact}`)
      failed = true
    }
  }
  const packageJson = readJson(join(execDir, "package.json"))
  for (const line of versionLine(packageJson, enginePin).split("\n")) lines.push(`INFO ${line}`)
  if (engine !== undefined) {
    lines.push(...daemonReportLines({ engine, pluginRoot: join(execDir, "plugin"), agentDir: canonicalAgentDir(), env: process.env, platform: process.platform }))
  }
  if (needsSetupSuggestion(inventory)) lines.push("INFO no credentials found; run omo setup to review sibling stores")
  console.log(lines.join("\n"))
  process.exitCode = failed ? 1 : 0
}

function isSelfUpdate(args: string[]): boolean {
  if (args[0] !== "update") return false
  const rest = args.slice(1)
  if (rest.length === 0) return true
  if (rest.some((arg) => engineUpdateTargets.has(arg))) return false
  return rest.every((arg) => arg.startsWith("-") || selfUpdateTargets.has(arg))
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
    console.log(updateHint(manifest.buildInfo))
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

export async function runCompiledLauncher(args: string[], execDir: string, enginePin = "unknown", compiledPackageRoot?: string): Promise<boolean> {
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
  if (command === "daemon") {
    const outcome = runDaemonCommand(args.slice(1), {
      engine,
      pluginRoot: join(execDir, "plugin"),
      agentDir: canonicalAgentDir(),
      env: process.env,
      stdout: process.stdout,
      stderr: process.stderr,
      platform: process.platform,
    })
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
    if (compiledPackageRoot) runCompiledDoctor(inventory, compiledPackageRoot, enginePin, engine)
    else runDoctor(inventory, [], { daemonEngine: engine })
    return true
  }
  if (command === "setup") { printSetupReport(await detectHarnesses()); process.exitCode = 0; return true }
  if ((command === "--version" || command === "-v") && args.length === 1) { console.log(versionLine(packageJson, enginePin ?? "unknown")); return true }
  if (isSelfUpdate(args)) { console.log(updateHint(packageJson.omoBuild)); return true }
  return false
}

export async function reexecProvisionedRuntime(expected: string, options: {
  argv?: string[]
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  execve?: ((file: string, argv: string[], env: NodeJS.ProcessEnv) => void) | null
  run?: typeof runChild
  propagate?: typeof propagateResult
} = {}): Promise<void> {
  const argv = options.argv ?? process.argv.slice(2)
  const env = options.env ?? process.env
  const run = options.run ?? runChild
  const propagate = options.propagate ?? propagateResult
  const execve = options.execve === undefined ? process.execve : options.execve
  if ((options.platform ?? process.platform) !== "win32" && typeof execve === "function") {
    try {
      execve(expected, [expected, ...argv], env)
      return
    } catch {
      // A provisioned binary that cannot replace this image still uses the async fallback.
    }
  }
  const result = await run(expected, argv, { env })
  propagate(result)
}

async function main(): Promise<void> {
  const embedded = (globalThis as typeof globalThis & { Bun?: { embeddedFiles?: EmbeddedFile[] } }).Bun?.embeddedFiles as EmbeddedFile[] | undefined
  if (!embedded?.length) {
    const execDir = dirname(fileURLToPath(import.meta.url))
    if (await runCompiledLauncher(process.argv.slice(2), execDir)) return
    process.argv.splice(2, process.argv.length - 2, ...buildSenpiArgs(process.argv.slice(2), execDir))
    Object.assign(process.env, remapSenpiEnvironment(process.env, execDir))
    await import("../../node_modules/@code-yeongyu/senpi/dist/cli.js") // literal: see import note above
    return
  }
  const manifestFile = await selectRuntimeManifest(embedded)
  if (!manifestFile) throw new Error("embedded runtime-manifest.json is missing")
  const manifest = JSON.parse(await embeddedText(manifestFile)) as EmbeddedManifest
  const runningExecutable = runningExecutablePath()
  const expected = join(homedir(), ".omo", "binary-runtime", manifest.omoAiVersion, process.platform === "win32" ? "omo.exe" : "omo")
  let execDir = dirname(runningExecutable)
  // Materialize the provisioned runtime BEFORE answering the informational fast-path.
  // First-run provisioning must happen even for `--version`/`-v`: the release smoke test
  // asserts the provisioned binary exists after `--version`, and provisioning used to be a
  // side effect of the (now-skipped) re-exec. Only the re-exec (relocate) is deferred here,
  // so an already-provisioned install keeps the fast-path's no-re-exec speed.
  const needsProvisioning = !isProvisionedExecutable(runningExecutable, expected)
  if (needsProvisioning) {
    await provisionEmbeddedRuntime(manifest, embedded, dirname(expected))
    materializeProvisionedExecutable(runningExecutable, expected)
  }
  if (answerCompiledFastPath(process.argv.slice(2), manifest)) return
  if (needsProvisioning) {
    if (shouldReexecAfterProvisioning()) {
      await reexecProvisionedRuntime(expected)
      return
    }
    execDir = dirname(expected)
  }
  // Inspector and custom execArgv isolation is unsupported in compiled binaries; the provisioned
  // executable delegates to the engine in-process as required by the native startup contract.
  if (await runCompiledLauncher(process.argv.slice(2), execDir, manifest.enginePin, execDir)) return
  if (shouldPrintCompiledBanner(process.argv.slice(2), process.stderr.isTTY === true)) {
    for (const line of compiledBannerLines(manifest)) console.error(line)
  }
  process.argv.splice(2, process.argv.length - 2, ...buildSenpiArgs(process.argv.slice(2), execDir))
  Object.assign(process.env, remapSenpiEnvironment(process.env, execDir))
  await import("../../node_modules/@code-yeongyu/senpi/dist/cli.js") // literal: see import note above
}

if (import.meta.main) await main()

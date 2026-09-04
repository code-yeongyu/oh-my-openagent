import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { spawn } from "node:child_process"
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
import { migrateLegacyBunGlobalManifest } from "./bin/lib/legacy-bun-global-migration.js"
import { adoptLegacyFlatState, canonicalAgentDir } from "./bin/lib/agent-dir.js"
import { nearestNodeBin, readJson } from "./bin/lib/package-paths.js"
import { runDoctor } from "./bin/lib/doctor.js"
import { detectHarnesses, needsSetupSuggestion } from "./bin/lib/setup-detect.js"
import { printSetupReport } from "./bin/lib/setup-report.js"
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

const earlyCommands = new Set(["install", "remove", "list", "config", "auth", "app-server"])
const selfUpdateTargets = new Set(["self", "senpi", "omo"])
const engineUpdateTargets = new Set(["--extensions", "--models"])
const doctorArtifacts = [
  ["plugin manifest", "plugin/package.json"],
  ["extension", "plugin/extensions/omo.js"],
  ["lsp-daemon runtime", "plugin/runtime/lsp-daemon/dist/cli.js"],
  ["agent-toolkit runtime", "plugin/runtime/agent-toolkit/cli.js"],
] as const

export function buildSenpiArgs(args: string[], execDir: string): string[] {
  const command = args[0]
  if (earlyCommands.has(command) || command === "update") return args
  return ["--extension", join(execDir, "plugin"), ...args]
}

export function versionLine(packageJson: { version: string }, enginePin: string): string {
  return `omo ${packageJson.version} (engine: senpi ${enginePin})`
}

export function updateAssetSlug(platform: NodeJS.Platform, arch: string): string {
  const os = platform === "win32" ? "windows" : platform
  const slug = `omo-${os}-${arch}`
  return platform === "win32" ? `${slug}.exe` : slug
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
  env.OMO_AGENT_TOOLKIT_BIN = join(execDir, "plugin", "runtime", "agent-toolkit", process.platform === "win32" ? "omo-agent-toolkit.cmd" : "omo-agent-toolkit")
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
  try { displayVersion = readJson(join(execDir, "package.json")).version } catch { /* test fixtures may omit the sibling manifest */ }
  env.SENPI_BRAND = JSON.stringify({
    name: "OmO", command: "omo", displayVersion,
    configDir: ".omo", flatLayout: false, envPrefix: "OMO", userAgent: "omo", originator: "omo",
    update: { packageName: "omo-ai", distTag: "beta", command: updateLine(process.platform, process.arch), changelogUrl: "https://github.com/code-yeongyu/oh-my-openagent/releases" },
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

function runCompiledDoctor(inventory: Awaited<ReturnType<typeof detectHarnesses>>, execDir: string, enginePin: string): void {
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
  lines.push(`INFO omo ${packageJson.version} (engine: senpi ${enginePin})`)
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

export function answerCompiledFastPath(args: string[], manifest: Pick<EmbeddedManifest, "omoAiVersion" | "enginePin">): boolean {
  if ((args[0] === "--version" || args[0] === "-v") && args.length === 1) {
    console.log(versionLine({ version: manifest.omoAiVersion }, manifest.enginePin))
    return true
  }
  if (isSelfUpdate(args)) {
    console.log(updateLine(process.platform, process.arch))
    return true
  }
  return false
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
  const packageJson = readJson(join(execDir, "package.json"))
  migrateLegacyBunGlobalManifest(execDir)
  adoptLegacyFlatState()
  const command = args[0]
  if (command === "ulw-loop") { spawn(process.execPath, [join(execDir, "plugin/runtime/agent-toolkit/ulw-loop/cli.js"), ...args.slice(1)], { stdio: "inherit" }); return true }
  if (command === "doctor") {
    const inventory = await detectHarnesses()
    if (compiledPackageRoot) runCompiledDoctor(inventory, compiledPackageRoot, enginePin)
    else runDoctor(inventory)
    return true
  }
  if (command === "setup") { printSetupReport(await detectHarnesses()); process.exitCode = 0; return true }
  if ((command === "--version" || command === "-v") && args.length === 1) { console.log(versionLine(packageJson, enginePin ?? "unknown")); return true }
  if (isSelfUpdate(args)) { console.log(updateLine(process.platform, process.arch)); return true }
  return false
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
      const result = await runChild(expected, process.argv.slice(2), { env: process.env })
      propagateResult(result)
      return
    }
    execDir = dirname(expected)
  }
  // Inspector and custom execArgv isolation is unsupported in compiled binaries; the provisioned
  // executable delegates to the engine in-process as required by the native startup contract.
  if (await runCompiledLauncher(process.argv.slice(2), execDir, manifest.enginePin, execDir)) return
  if (shouldPrintCompiledBanner(process.argv.slice(2), process.stderr.isTTY === true)) {
    console.error(`omo (omo-ai beta ${manifest.omoAiVersion})`)
  }
  process.argv.splice(2, process.argv.length - 2, ...buildSenpiArgs(process.argv.slice(2), execDir))
  Object.assign(process.env, remapSenpiEnvironment(process.env, execDir))
  await import("../../node_modules/@code-yeongyu/senpi/dist/cli.js") // literal: see import note above
}

if (import.meta.main) await main()

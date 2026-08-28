import { createHash } from "node:crypto"
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { migrateLegacyBunGlobalManifest } from "./bin/lib/legacy-bun-global-migration.js"
import { adoptLegacyFlatState, canonicalAgentDir } from "./bin/lib/agent-dir.js"
import { nearestNodeBin, readJson } from "./bin/lib/package-paths.js"
import { runDoctor } from "./bin/lib/doctor.js"
import { detectHarnesses, needsSetupSuggestion } from "./bin/lib/setup-detect.js"
import { printSetupReport } from "./bin/lib/setup-report.js"
import { delimiter } from "node:path"

type EmbeddedFile = Blob & {
  name: string
  arrayBuffer?: () => Promise<ArrayBuffer>
  bytes?: () => Promise<Uint8Array>
  text?: () => Promise<string>
}
export type EmbeddedManifestEntry = { relPath: string; sha256: string; mode: number; size: number }
export type EmbeddedManifest = { omoAiVersion: string; enginePin: string; manifestSha: string; entries: EmbeddedManifestEntry[] }

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

export function isProvisionedExecutable(execPath: string, expectedPath: string): boolean {
  try {
    return realpathSync(execPath) === realpathSync(expectedPath)
  } catch {
    return resolve(execPath) === resolve(expectedPath)
  }
}

export function materializeProvisionedExecutable(
  sourcePath: string,
  destinationPath: string,
  platform = process.platform,
): void {
  if (platform === "win32") {
    if (existsSync(destinationPath)) return
    copyFileSync(sourcePath, destinationPath)
    chmodSync(destinationPath, 0o755)
    return
  }
  const temporaryPath = `${destinationPath}.tmp-${process.pid}`
  try {
    rmSync(temporaryPath, { force: true })
    copyFileSync(sourcePath, temporaryPath)
    chmodSync(temporaryPath, 0o755)
    renameSync(temporaryPath, destinationPath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export function runningExecutablePath(
  argv0 = process.argv[0],
  execPath = process.execPath,
  platform = process.platform,
): string {
  return platform === "win32" && argv0.toLowerCase().endsWith(".exe") ? argv0 : execPath
}

export function shouldReexecAfterProvisioning(platform = process.platform): boolean {
  return platform !== "win32"
}

export function remapSenpiEnvironment(source: NodeJS.ProcessEnv = process.env, execDir: string): NodeJS.ProcessEnv {
  const env = { ...source }
  delete env.OMO_BIN
  delete env.SENPI_BIN
  env.OMO_AGENT_TOOLKIT_BIN = join(execDir, "plugin", "runtime", "agent-toolkit", process.platform === "win32" ? "omo-agent-toolkit.cmd" : "omo-agent-toolkit")
  const agentDir = canonicalAgentDir(env)
  env.OMO_CODING_AGENT_DIR = agentDir
  env.SENPI_CODING_AGENT_DIR = agentDir
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

async function embeddedText(file: EmbeddedFile): Promise<string> {
  if (file.text) return file.text()
  if (file.arrayBuffer) return Buffer.from(await file.arrayBuffer()).toString("utf8")
  throw new Error(`embedded asset ${file.name} cannot be read`)
}

async function embeddedBytes(file: EmbeddedFile): Promise<Uint8Array> {
  if (file.bytes) return file.bytes()
  if (file.arrayBuffer) return new Uint8Array(await file.arrayBuffer())
  throw new Error(`embedded asset ${file.name} cannot be read as bytes`)
}

export async function selectRuntimeManifest(embedded: EmbeddedFile[]): Promise<EmbeddedFile | undefined> {
  const exact = embedded.find((file) => file.name === "omo-runtime/runtime-manifest.json")
  if (exact) return exact
  for (const file of embedded) {
    if (!file.name.endsWith("runtime-manifest.json")) continue
    try {
      const parsed = JSON.parse(await embeddedText(file))
      if (typeof parsed?.omoAiVersion === "string" && typeof parsed?.enginePin === "string") return file
    } catch {
      // Non-manifest assets with a similar name are not candidates.
    }
  }
  return undefined
}

export async function provisionEmbeddedRuntime(manifest: EmbeddedManifest, embedded: EmbeddedFile[], runtimeDir: string): Promise<void> {
  mkdirSync(runtimeDir, { recursive: true })
  const marker = join(runtimeDir, ".provisioned")
  if (readFileIfExists(marker)?.trim() === manifest.manifestSha) return
  const byPath = new Map(embedded.map((file) => [
    file.name.replace(/^\.\//, "").replace(/^omo-runtime\//, ""),
    file,
  ]))
  for (const entry of manifest.entries) {
    const file = byPath.get(entry.relPath.replace(/^\.\//, ""))
    if (!file) throw new Error(`embedded asset missing: ${entry.relPath}`)
    const bytes = await embeddedBytes(file)
    if (bytes.byteLength !== entry.size || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
      throw new Error(`embedded asset integrity mismatch: ${entry.relPath}`)
    }
    const destination = join(runtimeDir, entry.relPath)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, bytes, { mode: entry.mode })
    chmodSync(destination, entry.mode)
  }
  writeFileSync(marker, `${manifest.manifestSha}\n`, { mode: 0o644 })
}

function readFileIfExists(path: string): string | undefined {
  try { return readFileSync(path, "utf8") } catch { return undefined }
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
  if (!isProvisionedExecutable(runningExecutable, expected)) {
    await provisionEmbeddedRuntime(manifest, embedded, dirname(expected))
    materializeProvisionedExecutable(runningExecutable, expected)
    if (shouldReexecAfterProvisioning()) {
      const child = spawn(expected, process.argv.slice(2), { env: process.env, stdio: "inherit" })
      await new Promise<void>((resolvePromise) => child.on("close", (code) => { process.exitCode = code ?? 1; resolvePromise() }))
      return
    }
    execDir = dirname(expected)
  }
  // Inspector and custom execArgv isolation is unsupported in compiled binaries; the provisioned
  // executable delegates to the engine in-process as required by the native startup contract.
  if (await runCompiledLauncher(process.argv.slice(2), execDir, manifest.enginePin, execDir)) return
  process.argv.splice(2, process.argv.length - 2, ...buildSenpiArgs(process.argv.slice(2), execDir))
  Object.assign(process.env, remapSenpiEnvironment(process.env, execDir))
  await import("../../node_modules/@code-yeongyu/senpi/dist/cli.js") // literal: see import note above
}

if (import.meta.main) await main()

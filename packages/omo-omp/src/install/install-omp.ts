import { execFile } from "node:child_process"
import { constants, existsSync } from "node:fs"
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export const OMO_OMP_PACKAGE_NAME = "@code-yeongyu/omo-omp"

const REQUIRED_PLUGIN_ARTIFACTS = [
  join("extensions", "omo.js"),
  join("runtime", "lsp-daemon", "dist", "cli.js"),
  join("runtime", "ast-grep-mcp", "cli.js"),
  join("skills", "ultrawork", "SKILL.md"),
  join("scripts", "install.mjs"),
] as const

export interface InstallOmpContext {
  readonly env: NodeJS.ProcessEnv
  readonly repoRoot: string
  readonly agentDir: string
  readonly pluginPath: string
  readonly ompBin: string
  readonly platform: NodeJS.Platform
  readonly allowBuild: boolean
  readonly runCommand: (command: string, args: readonly string[], options: { cwd: string }) => Promise<void>
}

export interface InstallOmpResult {
  readonly ok: boolean
  readonly action: "install" | "uninstall"
  readonly agentDir: string
  readonly pluginPath: string
  readonly registration: "omp-cli" | "config-yml" | null
  readonly changed: boolean
  readonly backupPath?: string
  readonly error?: string
}

// ============================================================================
// Context resolution
// ============================================================================

export function resolveInstallContext(options: {
  env?: NodeJS.ProcessEnv
  repoRoot?: string
  agentDir?: string
  pluginPath?: string
  ompBin?: string
  platform?: NodeJS.Platform
  allowBuild?: boolean
  runCommand?: InstallOmpContext["runCommand"]
}): InstallOmpContext {
  const env = options.env ?? process.env
  const allowBuild = options.allowBuild ?? options.pluginPath === undefined
  const explicitRepoRoot = options.repoRoot
  const explicitPluginPath = options.pluginPath
  let repoRoot: string
  if (explicitRepoRoot !== undefined) {
    repoRoot = resolve(explicitRepoRoot)
  } else if (explicitPluginPath !== undefined) {
    repoRoot = dirname(dirname(resolve(explicitPluginPath)))
  } else {
    repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)))
  }
  const agentDir = resolve(options.agentDir ?? env.OMP_CODING_AGENT_DIR ?? join(homedir(), ".omp", "agent"))
  const pluginPath = resolve(options.pluginPath ?? join(repoRoot, "packages", "omo-omp", "plugin"))
  return {
    env,
    repoRoot,
    agentDir,
    pluginPath,
    ompBin: options.ompBin ?? env.OMP_BIN ?? "omp",
    platform: options.platform ?? process.platform,
    allowBuild,
    runCommand: options.runCommand ?? defaultRunCommand,
  }
}

// ============================================================================
// Artifact staging
// ============================================================================

export async function ensurePluginArtifacts(context: InstallOmpContext): Promise<void> {
  if (context.allowBuild) {
    await context.runCommand("node", [join(context.pluginPath, "scripts", "build-extension.mjs")], { cwd: context.repoRoot })
    await context.runCommand("node", [join(context.pluginPath, "scripts", "sync-skills.mjs")], { cwd: context.repoRoot })
    await context.runCommand("node", [join(context.pluginPath, "scripts", "build-install.mjs")], { cwd: context.repoRoot })
    await context.runCommand("node", [join(context.pluginPath, "scripts", "stage-lsp-daemon-runtime.mjs")], { cwd: context.repoRoot })
    await context.runCommand("node", [join(context.pluginPath, "scripts", "stage-ast-grep-mcp-runtime.mjs")], { cwd: context.repoRoot })
    await context.runCommand("node", [join(context.pluginPath, "scripts", "stage-agent-toolkit.mjs")], { cwd: context.repoRoot })
  }
  if (await hasMissingPluginArtifact(context.pluginPath)) {
    throw new Error(`Packed omo-omp plugin is missing required runtime artifacts at ${context.pluginPath}`)
  }
  await verifyAstGrepRuntimeIntegrity(context.pluginPath, context.platform)
}

async function hasMissingPluginArtifact(pluginPath: string): Promise<boolean> {
  for (const artifact of REQUIRED_PLUGIN_ARTIFACTS) {
    if (!await fileExists(join(pluginPath, artifact))) return true
  }
  return false
}

// ============================================================================
// OMP registration
// ============================================================================

export async function runOmpInstaller(options: {
  env?: NodeJS.ProcessEnv
  repoRoot?: string
  agentDir?: string
  pluginPath?: string
  ompBin?: string
  platform?: NodeJS.Platform
  allowBuild?: boolean
  runCommand?: InstallOmpContext["runCommand"]
} = {}): Promise<InstallOmpResult> {
  const context = resolveInstallContext(options)
  try {
    await ensurePluginArtifacts(context)
    const registration = await registerWithOmp(context)
    return {
      ok: true,
      action: "install",
      agentDir: context.agentDir,
      pluginPath: context.pluginPath,
      registration,
      changed: true,
    }
  } catch (error) {
    return {
      ok: false,
      action: "install",
      agentDir: context.agentDir,
      pluginPath: context.pluginPath,
      registration: null,
      changed: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function runOmpUninstaller(options: {
  env?: NodeJS.ProcessEnv
  repoRoot?: string
  agentDir?: string
  pluginPath?: string
  ompBin?: string
  platform?: NodeJS.Platform
  allowBuild?: boolean
  runCommand?: InstallOmpContext["runCommand"]
} = {}): Promise<InstallOmpResult> {
  const context = resolveInstallContext(options)
  try {
    const registration = await unregisterFromOmp(context)
    return {
      ok: true,
      action: "uninstall",
      agentDir: context.agentDir,
      pluginPath: context.pluginPath,
      registration,
      changed: true,
    }
  } catch (error) {
    return {
      ok: false,
      action: "uninstall",
      agentDir: context.agentDir,
      pluginPath: context.pluginPath,
      registration: null,
      changed: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function registerWithOmp(context: InstallOmpContext): Promise<"omp-cli" | "config-yml"> {
  if (await commandExists(context.ompBin)) {
    await context.runCommand(context.ompBin, ["plugin", "install", context.pluginPath], { cwd: context.agentDir })
    return "omp-cli"
  }
  await appendConfigExtension(context, context.pluginPath)
  return "config-yml"
}

async function unregisterFromOmp(context: InstallOmpContext): Promise<"omp-cli" | "config-yml"> {
  if (await commandExists(context.ompBin)) {
    await context.runCommand(context.ompBin, ["plugin", "uninstall", OMO_OMP_PACKAGE_NAME], { cwd: context.agentDir })
    return "omp-cli"
  }
  await removeConfigExtension(context, context.pluginPath)
  return "config-yml"
}

// ============================================================================
// config.yml fallback (used only when the omp CLI is unavailable)
// ============================================================================

interface ConfigYamlState {
  readonly path: string
  readonly hasExtensionsKey: boolean
}

async function appendConfigExtension(context: InstallOmpContext, pluginPath: string): Promise<void> {
  await mkdir(context.agentDir, { recursive: true })
  const configPath = join(context.agentDir, "config.yml")
  const existing = await readIfPresent(configPath)
  const state = parseConfigState(existing)
  const extensionEntry = toConfigExtensionEntry(pluginPath, context.platform)
  const next = state.hasExtensionsKey
    ? insertExtension(existing, extensionEntry)
    : `${existing}\nextensions:\n  - ${extensionEntry}\n`
  await backupAndWrite(configPath, next)
}

async function removeConfigExtension(context: InstallOmpContext, pluginPath: string): Promise<void> {
  const configPath = join(context.agentDir, "config.yml")
  const existing = await readIfPresent(configPath)
  if (!parseConfigState(existing).hasExtensionsKey) return
  const extensionEntry = toConfigExtensionEntry(pluginPath, context.platform)
  const next = existing
    .split("\n")
    .filter((line) => line.trim() !== `- ${extensionEntry}` && !line.includes(pluginPath))
    .join("\n")
  await backupAndWrite(configPath, next)
}

function parseConfigState(content: string): ConfigYamlState {
  return {
    path: "",
    hasExtensionsKey: /^\s*extensions:/m.test(content),
  }
}

function insertExtension(content: string, entry: string): string {
  const lines = content.split("\n")
  const index = lines.findIndex((line) => /^\s*extensions:/m.test(line))
  const indent = /^(\s*)extensions:/.exec(lines[index] ?? "")?.[1] ?? ""
  if (index < 0) return content
  const nextIndent = index + 1 < lines.length && lines[index + 1].trim().length > 0
    ? /^(\s*)/.exec(lines[index + 1])?.[1] ?? "  "
    : indent === "" ? "  " : indent
  lines.splice(index + 1, 0, `${nextIndent}- ${entry}`)
  return lines.join("\n")
}

function toConfigExtensionEntry(pluginPath: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? pluginPath.replaceAll("\\", "/") : pluginPath
}

// ============================================================================
// File helpers
// ============================================================================

async function readIfPresent(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (isErrno(error, "ENOENT")) return ""
    throw error
  }
}

async function backupAndWrite(path: string, content: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true })
  const backupPath = `${path}.omo-omp-${Date.now()}.bak`
  const existing = await readIfPresent(path)
  if (existing !== "") {
    await writeFile(backupPath, existing)
  }
  await writeFile(path, content)
  return backupPath
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false
    throw error
  }
}

async function commandExists(command: string): Promise<boolean> {
  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command)
  }
  try {
    await execFileAsync(process.platform === "win32" ? "where" : "which", [command])
    return true
  } catch {
    return false
  }
}

async function verifyAstGrepRuntimeIntegrity(pluginPath: string, platform: NodeJS.Platform): Promise<void> {
  const runtimeEntry = join(pluginPath, "runtime", "ast-grep-mcp", "cli.js")
  const manifestPath = join(dirname(runtimeEntry), "manifest.json")
  let runtimeStat: Awaited<ReturnType<typeof stat>>
  try {
    runtimeStat = await stat(runtimeEntry)
    if (!runtimeStat.isFile()) throw new Error("runtime is not a file")
    await access(runtimeEntry, constants.R_OK | constants.X_OK)
  } catch (error) {
    throw astGrepIntegrityError(runtimeEntry, `runtime is unreadable or non-executable: ${messageOf(error)}`)
  }
  if (!await fileExists(manifestPath)) {
    throw astGrepIntegrityError(runtimeEntry, `manifest is missing: ${manifestPath}`)
  }
  const manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"))
  if (!isAstGrepRuntimeManifest(manifest)) {
    throw astGrepIntegrityError(runtimeEntry, `manifest is malformed: ${manifestPath}`)
  }
  const { createHash } = await import("node:crypto")
  const actualSha256 = createHash("sha256").update(await readFile(runtimeEntry)).digest("hex")
  if (actualSha256 !== manifest.sha256) {
    throw astGrepIntegrityError(runtimeEntry, `sha256 mismatch: manifest=${manifest.sha256} actual=${actualSha256}`)
  }
  const actualMode = runtimeStat.mode & 511
  if (platform !== "win32" && actualMode !== manifest.mode) {
    throw astGrepIntegrityError(runtimeEntry, `mode mismatch: manifest=${manifest.mode} actual=${actualMode}`)
  }
}

function isAstGrepRuntimeManifest(value: unknown): value is { sha256: string; mode: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.sha256 === "string" && /^[a-f0-9]{64}$/.test(record.sha256)
    && typeof record.mode === "number" && Number.isInteger(record.mode)
    && typeof record.stagedAtUtc === "string" && !Number.isNaN(Date.parse(record.stagedAtUtc))
}

function astGrepIntegrityError(runtimeEntry: string, reason: string): Error {
  return new Error(`Packed omo-omp plugin ast-grep MCP runtime integrity error at ${runtimeEntry}: ${reason}`)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function defaultRunCommand(command: string, args: readonly string[], options: { cwd: string }): Promise<void> {
  const result = await execFileAsync(command, [...args], { cwd: options.cwd })
  if (result.stderr.trim().length > 0) process.stderr.write(result.stderr)
  if (result.stdout.trim().length > 0) process.stdout.write(result.stdout)
}

function findRepoRoot(importerDir: string): string {
  let current = importerDir
  for (let depth = 0; depth <= 7; depth += 1) {
    if (fileExistsSync(join(current, "packages", "omo-omp", "plugin", "package.json"))) return current
    current = resolve(current, "..")
  }
  throw new Error("Unable to locate packages/omo-omp/plugin/package.json from installer module")
}

function fileExistsSync(path: string): boolean {
  return existsSync(path)
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code
}

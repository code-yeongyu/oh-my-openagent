import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { constants, existsSync } from "node:fs"
import { access, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { installLocalLauncher, uninstallLocalLauncher } from "./local-launcher"
import {
  dedupePackages,
  isRecord,
  readPackages,
  readSettings,
  removeLegacyBuiltinShadows,
  removeSupersededOmoPackages,
  type SettingsRecord,
  writeSettingsAtomically,
} from "./senpi-settings"

const execFileAsync = promisify(execFile)

type Env = Readonly<Record<string, string | undefined>>

export interface SenpiInstallOptions {
  readonly env?: Env
  readonly repoRoot?: string
  readonly agentDir?: string
  readonly pluginPath?: string
  readonly platform?: NodeJS.Platform
  readonly runCommand?: (command: string, args: readonly string[], options: { readonly cwd: string }) => Promise<void>
}

export interface SenpiInstallResult {
  readonly ok: true
  readonly action: "install" | "uninstall"
  readonly agentDir: string
  readonly settingsPath: string
  readonly pluginPath: string
  readonly changed: boolean
  readonly backupPath: string
  readonly removed?: boolean
}

const REQUIRED_PLUGIN_ARTIFACTS = [
  join("extensions", "omo.js"),
  join("extensions", "reflection-persona.md"),
  join("skills", "ast-grep", "SKILL.md"),
  join("skills", "coding-agent-sessions", "SKILL.md"),
  join("skills", "debugging", "SKILL.md"),
  join("skills", "frontend", "SKILL.md"),
  join("skills", "git-master", "SKILL.md"),
  join("skills", "init-deep", "SKILL.md"),
  join("skills", "lsp-setup", "SKILL.md"),
  join("skills", "programming", "SKILL.md"),
  join("skills", "refactor", "SKILL.md"),
  join("skills", "remove-ai-slops", "SKILL.md"),
  join("skills", "review-work", "SKILL.md"),
  join("skills", "start-work", "SKILL.md"),
  join("skills", "ultimate-browsing", "SKILL.md"),
  join("skills", "ultrawork", "SKILL.md"),
  join("skills", "ulw-loop", "SKILL.md"),
  join("skills", "ulw-plan", "SKILL.md"),
  join("skills", "ulw-research", "SKILL.md"),
  join("skills", "visual-qa", "SKILL.md"),
  join("runtime", "ast-grep-mcp", "cli.js"),
  join("runtime", "agent-toolkit", "cli.js"),
  join("runtime", "agent-toolkit", "ulw-loop", "cli.js"),
  join("runtime", "agent-toolkit", "omo-agent-toolkit"),
  join("runtime", "agent-toolkit", "omo-agent-toolkit.cmd"),
  join("runtime", "lsp-daemon", "dist", "cli.js"),
  join("runtime", "lsp-daemon", "dist", "index.js"),
  join("runtime", "lsp-daemon", "dist", "index.d.ts"),
  join("runtime", "lsp-daemon", "dist", "daemon-client.js"),
  join("runtime", "lsp-daemon", "dist", "daemon-client.d.ts"),
  join("runtime", "lsp-daemon", "dist", "package.json"),
  join("runtime", "lsp-daemon", "dist", ".omo-runtime-manifest.json"),
  join("scripts", "install.mjs"),
] as const

export async function runSenpiInstaller(options: SenpiInstallOptions = {}): Promise<SenpiInstallResult> {
  const context = resolveInstallContext(options)
  await ensurePluginArtifacts(context)
  const settings = await readSettings(context.settingsPath)
  const before = JSON.stringify(settings)
  const packages = dedupePackages(await removeSupersededOmoPackages(
    removeLegacyBuiltinShadows(
      dedupePackages(readPackages(settings)),
      context.repoRoot,
      context.agentDir,
    ),
    context.pluginPath,
    context.agentDir,
  ))
  if (!packages.includes(context.pluginPath)) packages.push(context.pluginPath)
  settings.packages = packages
  const backupPath = await writeSettingsAtomically(context.settingsPath, settings)
  // The local route runs the user's own engine checkout, so it needs the same launcher the
  // published package ships; without it this install would boot unbranded.
  installLocalLauncher({
    pluginPath: context.pluginPath,
    senpiCliPath: join(context.repoRoot, "packages", "coding-agent", "dist", "cli.js"),
  })

  return {
    ok: true,
    action: "install",
    agentDir: context.agentDir,
    settingsPath: context.settingsPath,
    pluginPath: context.pluginPath,
    changed: JSON.stringify(settings) !== before,
    backupPath,
  }
}

export async function runSenpiUninstaller(options: SenpiInstallOptions = {}): Promise<SenpiInstallResult> {
  const context = resolveInstallContext(options)
  const settings = await readSettings(context.settingsPath)
  const before = JSON.stringify(settings)
  const packages = dedupePackages(readPackages(settings))
  const nextPackages = packages.filter((entry) => entry !== context.pluginPath)
  settings.packages = nextPackages
  const backupPath = await writeSettingsAtomically(context.settingsPath, settings)
  uninstallLocalLauncher()

  return {
    ok: true,
    action: "uninstall",
    agentDir: context.agentDir,
    settingsPath: context.settingsPath,
    pluginPath: context.pluginPath,
    changed: JSON.stringify(settings) !== before,
    backupPath,
    removed: nextPackages.length !== packages.length,
  }
}

function resolveInstallContext(options: SenpiInstallOptions): {
  readonly env: Env
  readonly repoRoot: string
  readonly agentDir: string
  readonly settingsPath: string
  readonly pluginPath: string
  readonly platform: NodeJS.Platform
  readonly allowBuild: boolean
  readonly runCommand: (command: string, args: readonly string[], options: { readonly cwd: string }) => Promise<void>
} {
  const env = options.env ?? process.env
  const allowBuild = options.pluginPath === undefined
  const repoRoot = resolve(options.repoRoot ?? (allowBuild ? findRepoRoot(dirname(fileURLToPath(import.meta.url))) : dirname(resolve(options.pluginPath))))
  const agentDir = resolve(options.agentDir ?? env.SENPI_CODING_AGENT_DIR ?? join(homedir(), ".senpi", "agent"))
  const pluginPath = resolve(options.pluginPath ?? join(repoRoot, "packages", "omo-senpi", "plugin"))
  return {
    env,
    repoRoot,
    agentDir,
    settingsPath: join(agentDir, "settings.json"),
    pluginPath,
    platform: options.platform ?? process.platform,
    allowBuild,
    runCommand: options.runCommand ?? defaultRunCommand,
  }
}

async function ensurePluginArtifacts(context: ReturnType<typeof resolveInstallContext>): Promise<void> {
  if (context.allowBuild) {
    await context.runCommand("node", [join(context.pluginPath, "scripts", "build-extension.mjs")], { cwd: context.repoRoot })
    await context.runCommand("node", [join("packages", "omo-codex", "plugin", "scripts", "materialize-shared-upstreams.mjs")], { cwd: context.repoRoot })
    await context.runCommand("node", [join(context.pluginPath, "scripts", "sync-skills.mjs")], { cwd: context.repoRoot })
    await context.runCommand("node", [join(context.pluginPath, "scripts", "build-install.mjs")], { cwd: context.repoRoot })
    await context.runCommand("node", [join(context.pluginPath, "scripts", "stage-lsp-daemon-runtime.mjs")], { cwd: context.repoRoot })
    await context.runCommand("node", [join(context.pluginPath, "scripts", "stage-ast-grep-mcp-runtime.mjs")], { cwd: context.repoRoot })
    await context.runCommand("node", [join(context.pluginPath, "scripts", "stage-agent-toolkit.mjs")], { cwd: context.repoRoot })
  }

  if (await hasMissingPluginArtifact(context.pluginPath)) {
    throw new Error(`Packed omo-senpi plugin is missing required runtime artifacts at ${context.pluginPath}`)
  }

  await verifyAstGrepRuntimeIntegrity(context.pluginPath, context.platform)
}

async function hasMissingPluginArtifact(pluginPath: string): Promise<boolean> {
  for (const artifact of REQUIRED_PLUGIN_ARTIFACTS) {
    if (!(await fileExists(join(pluginPath, artifact)))) return true
  }
  return false
}

async function verifyAstGrepRuntimeIntegrity(pluginPath: string, platform: NodeJS.Platform): Promise<void> {
  const runtimeEntry = join(pluginPath, "runtime", "ast-grep-mcp", "cli.js")
  const manifestPath = join(dirname(runtimeEntry), "manifest.json")
  let runtimeStat
  try {
    runtimeStat = await stat(runtimeEntry)
    if (!runtimeStat.isFile()) throw new Error("runtime is not a file")
    await access(runtimeEntry, constants.R_OK | constants.X_OK)
  } catch (error) {
    throw astGrepIntegrityError(runtimeEntry, `runtime is unreadable or non-executable: ${messageOf(error)}`)
  }

  if (!(await fileExists(manifestPath))) {
    throw astGrepIntegrityError(runtimeEntry, `manifest is missing: ${manifestPath}`)
  }

  let manifest: unknown
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  } catch (error) {
    throw astGrepIntegrityError(runtimeEntry, `manifest is unreadable or invalid JSON: ${messageOf(error)}`)
  }
  if (!isAstGrepRuntimeManifest(manifest)) {
    throw astGrepIntegrityError(runtimeEntry, `manifest is malformed: ${manifestPath}`)
  }

  let actualSha256: string
  try {
    actualSha256 = createHash("sha256").update(await readFile(runtimeEntry)).digest("hex")
  } catch (error) {
    throw astGrepIntegrityError(runtimeEntry, `runtime hash could not be computed: ${messageOf(error)}`)
  }
  if (actualSha256 !== manifest.sha256) {
    throw astGrepIntegrityError(
      runtimeEntry,
      `sha256 mismatch: manifest=${manifest.sha256} actual=${actualSha256}`,
    )
  }

  const actualMode = runtimeStat.mode & 0o777
  if (platform !== "win32" && actualMode !== manifest.mode) {
    throw astGrepIntegrityError(runtimeEntry, `mode mismatch: manifest=${manifest.mode} actual=${actualMode}`)
  }
}

function isAstGrepRuntimeManifest(value: unknown): value is { readonly sha256: string; readonly mode: number; readonly stagedAtUtc: string } {
  if (!isRecord(value)) return false
  return (
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    typeof value.mode === "number" &&
    Number.isInteger(value.mode) &&
    typeof value.stagedAtUtc === "string" &&
    !Number.isNaN(Date.parse(value.stagedAtUtc))
  )
}

function astGrepIntegrityError(runtimeEntry: string, reason: string): Error {
  return new Error(`Packed omo-senpi plugin ast-grep MCP runtime integrity error at ${runtimeEntry}: ${reason}`)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function defaultRunCommand(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string },
): Promise<void> {
  const result = await execFileAsync(command, [...args], { cwd: options.cwd })
  if (result.stderr.trim().length > 0) process.stderr.write(result.stderr)
  if (result.stdout.trim().length > 0) process.stdout.write(result.stdout)
}

function findRepoRoot(importerDir: string): string {
  let current = importerDir
  for (let depth = 0; depth <= 7; depth += 1) {
    if (fileExistsSync(join(current, "packages", "omo-senpi", "plugin", "package.json"))) return current
    current = resolve(current, "..")
  }
  throw new Error("Unable to locate packages/omo-senpi/plugin/package.json from installer module")
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

function fileExistsSync(path: string): boolean {
  return existsSync(path)
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code
}

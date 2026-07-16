import { execFile } from "node:child_process"
import { constants, existsSync } from "node:fs"
import { access, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

type Env = Readonly<Record<string, string | undefined>>

export interface SenpiInstallOptions {
  readonly env?: Env
  readonly repoRoot?: string
  readonly agentDir?: string
  readonly pluginPath?: string
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

type SettingsRecord = Record<string, unknown>

const REQUIRED_PLUGIN_ARTIFACTS = [
  join("extensions", "omo.js"),
  join("skills", "ultrawork", "SKILL.md"),
  join("skills", "ulw-loop", "SKILL.md"),
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
  const packages = dedupePackages(readPackages(settings))
  if (!packages.includes(context.pluginPath)) packages.push(context.pluginPath)
  settings.packages = packages
  const backupPath = await writeSettingsAtomically(context.settingsPath, settings)

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
    allowBuild,
    runCommand: options.runCommand ?? defaultRunCommand,
  }
}

async function ensurePluginArtifacts(context: ReturnType<typeof resolveInstallContext>): Promise<void> {
  const missing = await hasMissingPluginArtifact(context.pluginPath)
  if (!missing) return
  if (!context.allowBuild) {
    throw new Error(`Packed omo-senpi plugin is missing required runtime artifacts at ${context.pluginPath}`)
  }

  await context.runCommand("node", [join(context.pluginPath, "scripts", "build-extension.mjs")], { cwd: context.repoRoot })
  await context.runCommand("node", [join(context.pluginPath, "scripts", "sync-skills.mjs")], { cwd: context.repoRoot })
  await context.runCommand("node", [join(context.pluginPath, "scripts", "build-install.mjs")], { cwd: context.repoRoot })
  await context.runCommand("node", [join(context.pluginPath, "scripts", "stage-lsp-daemon-runtime.mjs")], { cwd: context.repoRoot })
}

async function hasMissingPluginArtifact(pluginPath: string): Promise<boolean> {
  for (const artifact of REQUIRED_PLUGIN_ARTIFACTS) {
    if (!(await fileExists(join(pluginPath, artifact)))) return true
  }
  return false
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

async function readSettings(settingsPath: string): Promise<SettingsRecord> {
  let raw: string
  try {
    raw = await readFile(settingsPath, "utf8")
  } catch (error) {
    if (isErrno(error, "ENOENT")) return {}
    throw error
  }

  const parsed: unknown = JSON.parse(raw)
  if (!isPlainObject(parsed)) throw new Error(`${settingsPath} must contain a JSON object`)
  return parsed
}

function readPackages(settings: SettingsRecord): string[] {
  const packages = settings.packages
  if (packages === undefined) return []
  if (!Array.isArray(packages) || !packages.every((entry) => typeof entry === "string")) {
    throw new Error("Senpi settings packages must be an array of strings")
  }
  return packages
}

function dedupePackages(packages: readonly string[]): string[] {
  return [...new Set(packages)]
}

async function writeSettingsAtomically(settingsPath: string, settings: SettingsRecord): Promise<string> {
  await mkdir(dirname(settingsPath), { recursive: true })
  const backupPath = await nextBackupPath(settingsPath)
  if (await fileExists(settingsPath)) {
    await copyFile(settingsPath, backupPath)
  } else {
    await writeFile(backupPath, "{}\n", "utf8")
  }

  const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8")
  await rename(tempPath, settingsPath)
  return backupPath
}

async function nextBackupPath(settingsPath: string): Promise<string> {
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? "" : `-${index}`
    const candidate = `${settingsPath}.${timestampForBackup()}${suffix}.backup`
    if (!(await fileExists(candidate))) return candidate
  }
  throw new Error(`Unable to allocate backup path for ${settingsPath}`)
}

function timestampForBackup(): string {
  return new Date().toISOString().replace(/[-:.]/g, "")
}

function findRepoRoot(importerDir: string): string {
  let current = importerDir
  for (let depth = 0; depth <= 7; depth += 1) {
    if (fileExistsSync(join(current, "packages", "omo-senpi", "plugin", "package.json"))) return current
    current = resolve(current, "..")
  }
  throw new Error("Unable to locate packages/omo-senpi/plugin/package.json from installer module")
}

function isPlainObject(value: unknown): value is SettingsRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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

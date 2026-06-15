import { statSync, type Dirent } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import type { CheckResult, DoctorIssue } from "../framework/types"
import { gatherCodexSummary, type CodexDoctorDeps } from "./codex"

export const CODEX_COMPONENTS_CHECK_ID = "codex-components"
export const CODEX_COMPONENTS_CHECK_NAME = "codex-components"

const SG_PATH_ENV_KEY = "OMO_AST_GREP_SG_PATH"
const PLUGIN_DATA_DIR_NAME = "omo-sisyphuslabs"
const BOOTSTRAP_PENDING_MESSAGE = "bootstrap pending — start a Codex session"
const HOMEBREW_SG_PATHS = ["/opt/homebrew/bin/sg", "/usr/local/bin/sg"] as const
const WINDOWS_EXECUTABLE_EXTENSIONS = [".exe", ".cmd", ".bat"] as const
const MIN_BINARY_SIZE_BYTES = 10_000
const REINSTALL_FIX = "Reinstall: npx lazycodex-ai install (or upgrade: codex plugin marketplace upgrade sisyphuslabs)"

type ResolveModulePath = (specifier: string, fromPath: string) => string

export interface CodexComponentsDoctorDeps extends CodexDoctorDeps {
  readonly env?: Record<string, string | undefined>
  readonly platform?: NodeJS.Platform
  readonly arch?: string
  readonly resolveModulePath?: ResolveModulePath
}

interface JsonRecord {
  readonly [key: string]: unknown
}

interface BundleTargetIssue {
  readonly relativePath: string
  readonly referencedBy: string
  readonly reason: "missing" | "zero bytes"
}

interface SgResolution {
  readonly path: string
  readonly source: string
}

interface BootstrapDegradedEntry {
  readonly component: string
  readonly reason: string
  readonly hint?: string
}

interface BootstrapStateSummary {
  readonly completedForVersion: string | null
  readonly lastStatus: "success" | "degraded" | null
  readonly degraded: readonly BootstrapDegradedEntry[]
}

export async function checkCodexComponents(deps: CodexComponentsDoctorDeps = {}): Promise<CheckResult> {
  const env = deps.env ?? process.env
  const platform = deps.platform ?? process.platform
  const arch = deps.arch ?? process.arch
  const codexHome = resolve(deps.codexHome ?? env["CODEX_HOME"] ?? join(homedir(), ".codex"))
  const summary = await gatherCodexSummary({ ...deps, codexHome })

  if (summary.pluginRoot === null) {
    return {
      name: CODEX_COMPONENTS_CHECK_NAME,
      status: "skip",
      message: "OMO Codex plugin is not installed — skipping component checks",
      details: [`plugin root: not installed under ${codexHome}`],
      issues: [],
    }
  }

  const issues: DoctorIssue[] = []
  const details: string[] = [`plugin root: ${summary.pluginRoot}`]

  const { referencedCount, broken } = await auditBundleTargets(summary.pluginRoot)
  details.push(
    broken.length === 0
      ? `dist targets: ok (${referencedCount} referenced)`
      : `dist targets: ${broken.length} of ${referencedCount} referenced target(s) broken`,
  )
  for (const target of broken) {
    issues.push({
      title: `Missing plugin dist target: ${target.relativePath}`,
      description: `Referenced by ${target.referencedBy} but ${target.reason === "missing" ? "missing from" : "zero bytes in"} the installed plugin bundle.`,
      fix: REINSTALL_FIX,
      severity: "error",
      affects: [target.referencedBy.endsWith(".mcp.json") ? "MCP servers" : "plugin hooks"],
    })
  }

  const runtimeSgPath = runtimeDirSgPath(codexHome, platform, arch)
  const sg = resolveSgBinary({
    env,
    platform,
    runtimeSgPath,
    pluginRoot: summary.pluginRoot,
    arch,
    resolveModulePath: deps.resolveModulePath ?? defaultResolveModulePath,
  })
  if (sg === null) {
    details.push("ast_grep: missing")
    issues.push({
      title: "ast_grep (sg) binary is missing",
      description: `sg was not found via the ${SG_PATH_ENV_KEY} override, the Codex runtime dir (${runtimeSgPath}), the bundled @ast-grep/cli packages, or Homebrew. The ast_grep MCP server runs degraded until it is provisioned.`,
      fix: "Start a Codex session so the LazyCodex bootstrap can provision sg, then rerun: npx lazycodex-ai doctor",
      severity: "warning",
      affects: ["ast_grep MCP"],
    })
  } else {
    details.push(`ast_grep: ok (${sg.source}: ${sg.path})`)
  }

  const state = await readBootstrapStateSummary(codexHome)
  details.push(...bootstrapDetails(state, summary.pluginVersion))

  const status = issues.some((issue) => issue.severity === "error") ? "fail" : issues.length > 0 ? "warn" : "pass"
  return {
    name: CODEX_COMPONENTS_CHECK_NAME,
    status,
    message: status === "pass" ? "Codex component checks passed" : `${issues.length} Codex component issue(s) detected`,
    details,
    issues,
  }
}

// Mirrors script/lazycodex-marketplace-validation.ts (Task 1 sync guard) against the
// INSTALLED bundle. Duplicated on purpose: doctor lives in omo-opencode and must not
// import plugin component or build-script source (coupling guards).
async function auditBundleTargets(
  pluginRoot: string,
): Promise<{ referencedCount: number; broken: BundleTargetIssue[] }> {
  const broken: BundleTargetIssue[] = []
  let referencedCount = 0

  for (const manifestPath of await findManifestPaths(pluginRoot, ".mcp.json")) {
    const manifest = await readJson(manifestPath)
    if (manifest === null || !isRecord(manifest["mcpServers"])) continue
    const manifestRoot = dirname(manifestPath)
    const isRootManifest = resolve(manifestRoot) === resolve(pluginRoot)
    for (const server of Object.values(manifest["mcpServers"])) {
      if (!isRecord(server) || !Array.isArray(server["args"])) continue
      for (const arg of server["args"]) {
        if (typeof arg !== "string" || !isPluginRuntimePathArg(arg)) continue
        referencedCount += 1
        // codex only reads the root .mcp.json; nested dev manifests may point outside the bundle
        recordBrokenTarget(broken, await classifyBundleTarget(pluginRoot, manifestRoot, arg, !isRootManifest), {
          referencedBy: normalizeRelative(pluginRoot, manifestPath),
        })
      }
    }
  }

  for (const hookManifestPath of await findHookManifestPaths(pluginRoot)) {
    const manifest = await readJson(hookManifestPath)
    if (manifest === null) continue
    const commands: string[] = []
    collectHookCommands(manifest, commands)
    const hookPluginRoot = dirname(dirname(hookManifestPath))
    for (const command of commands) {
      for (const relativePath of extractPluginRootPaths(command)) {
        referencedCount += 1
        const baseRoot = relativePath.startsWith("components/") ? pluginRoot : hookPluginRoot
        recordBrokenTarget(broken, await classifyBundleTarget(pluginRoot, baseRoot, relativePath, false), {
          referencedBy: normalizeRelative(pluginRoot, hookManifestPath),
        })
      }
    }
  }

  return { referencedCount, broken }
}

function recordBrokenTarget(
  broken: BundleTargetIssue[],
  classified: Omit<BundleTargetIssue, "referencedBy"> | null,
  origin: { referencedBy: string },
): void {
  if (classified === null) return
  const entry: BundleTargetIssue = { ...classified, referencedBy: origin.referencedBy }
  if (broken.some((existing) => existing.relativePath === entry.relativePath && existing.reason === entry.reason)) return
  broken.push(entry)
}

async function classifyBundleTarget(
  bundleRoot: string,
  baseRoot: string,
  relativePath: string,
  allowEscape: boolean,
): Promise<Omit<BundleTargetIssue, "referencedBy"> | null> {
  const targetPath = resolve(baseRoot, relativePath)
  const bundleRootPath = resolve(bundleRoot)
  const bundleRootPrefix = bundleRootPath.endsWith(sep) ? bundleRootPath : `${bundleRootPath}${sep}`
  if (targetPath !== bundleRootPath && !targetPath.startsWith(bundleRootPrefix)) {
    if (allowEscape) return null
    return { relativePath: normalizePathSeparators(relativePath), reason: "missing" }
  }
  const size = await fileSize(targetPath)
  if (size === undefined) return { relativePath: normalizeRelative(bundleRoot, targetPath), reason: "missing" }
  if (size === 0) return { relativePath: normalizeRelative(bundleRoot, targetPath), reason: "zero bytes" }
  return null
}

async function findHookManifestPaths(root: string): Promise<string[]> {
  const paths = await findManifestPaths(root, "hooks.json")
  return paths.filter((path) => dirname(path).endsWith(`${sep}hooks`))
}

async function findManifestPaths(root: string, manifestName: string): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const paths: string[] = []
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue
    const entryPath = join(root, entry.name)
    if (entry.isDirectory()) {
      paths.push(...(await findManifestPaths(entryPath, manifestName)))
      continue
    }
    if (entry.isFile() && entry.name === manifestName) paths.push(entryPath)
  }
  return paths
}

function collectHookCommands(value: unknown, commands: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectHookCommands(item, commands)
    return
  }
  if (!isRecord(value)) return
  if (value["type"] === "command") {
    if (typeof value["command"] === "string") commands.push(value["command"])
    if (typeof value["commandWindows"] === "string") commands.push(value["commandWindows"])
  }
  for (const child of Object.values(value)) collectHookCommands(child, commands)
}

function extractPluginRootPaths(command: string): string[] {
  const paths: string[] = []
  const pluginRootPathPattern = /\$\{PLUGIN_ROOT\}([\\/][^"'\s]+)/g
  let match = pluginRootPathPattern.exec(command)
  while (match) {
    const rawPath = match[1]
    if (rawPath) paths.push(normalizePathSeparators(rawPath).replace(/^\//, ""))
    match = pluginRootPathPattern.exec(command)
  }
  return paths
}

function isPluginRuntimePathArg(arg: string): boolean {
  return (arg.startsWith("./") || arg.startsWith("../")) && arg.endsWith("/dist/cli.js")
}

interface ResolveSgBinaryOptions {
  readonly env: Record<string, string | undefined>
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly runtimeSgPath: string
  readonly pluginRoot: string
  readonly resolveModulePath: ResolveModulePath
}

// Mirrors packages/ast-grep-mcp/src/sg-cli-path.ts (Task 3 chain): env override ->
// CODEX_HOME runtime dir -> require.resolve (from the installed ast-grep-mcp component,
// which is the context the MCP runtime actually resolves in) -> Homebrew.
// The require step is emulated with node's walk-up node_modules lookup instead of
// createRequire: the MCP runtime is node, while doctor may run under bun, whose
// createRequire also consults the global bun install cache that node never sees.
function resolveSgBinary(options: ResolveSgBinaryOptions): SgResolution | null {
  const override = nonEmptyValue(options.env[SG_PATH_ENV_KEY])
  if (override !== undefined) {
    const overridePath = findValidExecutable(override, options.platform)
    if (overridePath !== null) return { path: overridePath, source: `env override ${SG_PATH_ENV_KEY}` }
  }

  const runtimePath = findValidExecutable(options.runtimeSgPath, options.platform)
  if (runtimePath !== null) return { path: runtimePath, source: "runtime dir" }

  const moduleContext = join(options.pluginRoot, "components", "ast-grep-mcp", "dist", "cli.js")
  const cliPackagePath = tryResolveModulePath(options.resolveModulePath, "@ast-grep/cli/package.json", moduleContext)
  if (cliPackagePath !== null) {
    const sgPath = findValidExecutable(join(dirname(cliPackagePath), "sg"), options.platform)
    if (sgPath !== null) return { path: sgPath, source: "@ast-grep/cli package" }
  }

  const platformPackage = platformPackageName(options.platform, options.arch)
  if (platformPackage !== null) {
    const packageJsonPath = tryResolveModulePath(options.resolveModulePath, `${platformPackage}/package.json`, moduleContext)
    if (packageJsonPath !== null) {
      const binaryPath = findValidExecutable(join(dirname(packageJsonPath), "ast-grep"), options.platform)
      if (binaryPath !== null) return { path: binaryPath, source: `${platformPackage} package` }
    }
  }

  if (options.platform === "darwin") {
    for (const homebrewPath of HOMEBREW_SG_PATHS) {
      if (isValidBinary(homebrewPath)) return { path: homebrewPath, source: "Homebrew" }
    }
  }

  return null
}

function runtimeDirSgPath(codexHome: string, platform: NodeJS.Platform, arch: string): string {
  return join(codexHome, "runtime", "ast-grep", `${platform}-${arch}`, platform === "win32" ? "sg.exe" : "sg")
}

function platformPackageName(platform: NodeJS.Platform, arch: string): string | null {
  const platformMap: Record<string, string> = {
    "darwin-arm64": "@ast-grep/cli-darwin-arm64",
    "darwin-x64": "@ast-grep/cli-darwin-x64",
    "linux-arm64": "@ast-grep/cli-linux-arm64-gnu",
    "linux-x64": "@ast-grep/cli-linux-x64-gnu",
    "win32-x64": "@ast-grep/cli-win32-x64-msvc",
    "win32-arm64": "@ast-grep/cli-win32-arm64-msvc",
    "win32-ia32": "@ast-grep/cli-win32-ia32-msvc",
  }
  return platformMap[`${platform}-${arch}`] ?? null
}

function defaultResolveModulePath(specifier: string, fromPath: string): string {
  let current = dirname(fromPath)
  for (;;) {
    const candidate = join(current, "node_modules", specifier)
    if (isExistingFile(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) throw new Error(`Cannot find module '${specifier}'`)
    current = parent
  }
}

function isExistingFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function tryResolveModulePath(resolveModulePath: ResolveModulePath, specifier: string, fromPath: string): string | null {
  try {
    return resolveModulePath(specifier, fromPath)
  } catch {
    return null
  }
}

function findValidExecutable(filePath: string, platform: NodeJS.Platform): string | null {
  for (const candidate of executableCandidates(filePath, platform)) {
    if (isValidBinary(candidate)) return candidate
  }
  return null
}

function executableCandidates(filePath: string, platform: NodeJS.Platform): string[] {
  if (platform !== "win32") return [filePath]
  const candidates = [filePath]
  const lowerPath = filePath.toLowerCase()
  if (WINDOWS_EXECUTABLE_EXTENSIONS.some((extension) => lowerPath.endsWith(extension))) return candidates
  for (const extension of WINDOWS_EXECUTABLE_EXTENSIONS) candidates.push(`${filePath}${extension}`)
  return candidates
}

function nonEmptyValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function isValidBinary(filePath: string): boolean {
  try {
    const stats = statSync(filePath)
    if (!stats.isFile()) return false
    const lowerPath = filePath.toLowerCase()
    if (lowerPath.endsWith(".cmd") || lowerPath.endsWith(".bat")) return stats.size > 0
    return stats.size > MIN_BINARY_SIZE_BYTES
  } catch {
    return false
  }
}

async function readBootstrapStateSummary(codexHome: string): Promise<BootstrapStateSummary | null> {
  const statePath = join(codexHome, "plugins", "data", PLUGIN_DATA_DIR_NAME, "bootstrap", "state.json")
  const raw = await readJson(statePath)
  if (raw === null) return null
  const lastStatus = raw["lastStatus"] === "success" || raw["lastStatus"] === "degraded" ? raw["lastStatus"] : null
  return {
    completedForVersion: typeof raw["completedForVersion"] === "string" ? raw["completedForVersion"] : null,
    lastStatus,
    degraded: parseDegradedEntries(raw["degraded"]),
  }
}

function parseDegradedEntries(value: unknown): readonly BootstrapDegradedEntry[] {
  if (!Array.isArray(value)) return []
  const entries: BootstrapDegradedEntry[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    if (typeof item["component"] !== "string" || typeof item["reason"] !== "string") continue
    entries.push({
      component: item["component"],
      reason: item["reason"],
      ...(typeof item["hint"] === "string" ? { hint: item["hint"] } : {}),
    })
  }
  return entries
}

function bootstrapDetails(state: BootstrapStateSummary | null, installedVersion: string | null): string[] {
  const installedLabel = installedVersion ?? "unknown"
  if (state === null || state.lastStatus === null) {
    return [`${BOOTSTRAP_PENDING_MESSAGE} (installed ${installedLabel}, state none)`]
  }
  const completed = state.completedForVersion
  if (completed === null || completed !== installedVersion) {
    const lines = [`${BOOTSTRAP_PENDING_MESSAGE} (installed ${installedLabel}, state ${completed ?? "none"}, lastStatus=${state.lastStatus})`]
    lines.push(...degradedDetailLines(state.degraded))
    return lines
  }
  const statusLabel = state.lastStatus === "success" ? "completed" : "degraded"
  const lines = [`bootstrap: ${statusLabel}@${completed} (lastStatus=${state.lastStatus})`]
  lines.push(...degradedDetailLines(state.degraded))
  return lines
}

function degradedDetailLines(entries: readonly BootstrapDegradedEntry[]): string[] {
  return entries.map(
    (entry) => `degraded component=${entry.component} reason=${entry.reason}${entry.hint === undefined ? "" : ` hint=${entry.hint}`}`,
  )
}

async function readJson(path: string): Promise<JsonRecord | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
    return isRecord(parsed) ? parsed : null
  } catch (error) {
    if (error instanceof Error) return null
    throw error
  }
}

async function fileSize(path: string): Promise<number | undefined> {
  try {
    const stats = await stat(path)
    return stats.isFile() ? stats.size : undefined
  } catch {
    return undefined
  }
}

function normalizeRelative(root: string, target: string): string {
  return normalizePathSeparators(relative(root, target))
}

function normalizePathSeparators(path: string): string {
  return path.split("\\").join("/")
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

import type { Dirent } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { findSgBinarySync, runtimeSlug, SG_PATH_ENV_KEY, sgBinaryName, type SgResolverOptions } from "@oh-my-opencode/utils"
import type { CheckResult, DoctorIssue } from "../framework/types"
import { gatherCodexSummary, type CodexDoctorDeps } from "./codex"

export const CODEX_COMPONENTS_CHECK_ID = "codex-components"
export const CODEX_COMPONENTS_CHECK_NAME = "codex-components"

const PLUGIN_DATA_DIR_NAME = "omo-sisyphuslabs"
const BOOTSTRAP_PENDING_MESSAGE = "bootstrap pending — start a Codex session"
const REINSTALL_FIX = "Reinstall: npx lazycodex-ai install (or upgrade: codex plugin marketplace upgrade sisyphuslabs)"

export interface CodexComponentsDoctorDeps extends CodexDoctorDeps {
  readonly env?: Record<string, string | undefined>
  readonly platform?: NodeJS.Platform
  readonly arch?: string
  readonly sgRunVersionProbeSync?: SgResolverOptions["runVersionProbeSync"]
  readonly sgWhich?: SgResolverOptions["which"]
}

interface JsonRecord {
  readonly [key: string]: unknown
}

interface BundleTargetIssue {
  readonly relativePath: string
  readonly referencedBy: string
  readonly reason: "missing" | "zero bytes"
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

  const runtimeSgDir = runtimeSgDirectory(codexHome, platform, arch)
  const runtimeSgPath = join(runtimeSgDir, sgBinaryName(platform))
  const sg = findSgBinarySync({
    arch,
    env,
    platform,
    runtimeDir: runtimeSgDir,
    ...(deps.sgRunVersionProbeSync === undefined ? {} : { runVersionProbeSync: deps.sgRunVersionProbeSync }),
    ...(deps.sgWhich === undefined ? {} : { which: deps.sgWhich }),
  })
  if (sg === null) {
    details.push("ast_grep: missing")
    issues.push({
      title: "ast_grep (sg) binary is missing",
      description: `sg was not found via the ${SG_PATH_ENV_KEY} override, the Codex runtime dir (${runtimeSgPath}), or PATH. The ast-grep skill runs degraded until sg is provisioned.`,
      fix: "Start a Codex session so LazyCodex bootstrap can provision the ast-grep skill runtime, then rerun: npx lazycodex-ai doctor (or omo doctor).",
      severity: "warning",
      affects: ["ast-grep skill"],
    })
  } else {
    details.push(`ast_grep: ok (${describeSgSource(sg, env, runtimeSgDir, platform)}: ${sg})`)
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
  const normalized = normalizePathSeparators(arg)
  return (
    normalized.endsWith(".js") &&
    normalized.includes("/dist/") &&
    (normalized.startsWith("./") ||
      normalized.startsWith("../") ||
      normalized.startsWith("components/") ||
      normalized.startsWith("/") || isAbsolute(arg))
  )
}

function runtimeSgDirectory(codexHome: string, platform: NodeJS.Platform, arch: string): string {
  return join(codexHome, "runtime", "ast-grep", runtimeSlug(platform, arch))
}

function describeSgSource(
  sgPath: string,
  env: Record<string, string | undefined>,
  runtimeSgDir: string,
  platform: NodeJS.Platform,
): string {
  const override = env[SG_PATH_ENV_KEY]?.trim()
  if (override !== undefined && override.length > 0 && sgPath === override) return `env override ${SG_PATH_ENV_KEY}`
  if (sgPath === join(runtimeSgDir, sgBinaryName(platform))) return "runtime dir"
  return "PATH"
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

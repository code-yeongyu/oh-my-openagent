import { existsSync, readFileSync } from "node:fs"

import { MIN_OPENCODE_VERSION, CHECK_IDS, CHECK_NAMES } from "../framework/constants"
import type { CheckResult, DoctorIssue, SystemInfo } from "../framework/types"
import { findOpenCodeBinary, getOpenCodeVersion, compareVersions } from "./system-binary"
import { getPluginInfo } from "./system-plugin"
import { getLatestPluginVersion, getLoadedPluginVersion, getSuggestedInstallTag } from "./system-loaded-version"
import { parseJsonc } from "../../../shared/jsonc-parser"
import { ACCEPTED_PACKAGE_NAMES, PUBLISHED_PACKAGE_NAME, PLUGIN_NAME, LEGACY_PLUGIN_NAME } from "../../../shared/plugin-identity"

const runtime = globalThis as typeof globalThis & { Bun?: { version?: string } }

interface SystemCheckDeps {
  findOpenCodeBinary: typeof findOpenCodeBinary
  getOpenCodeVersion: typeof getOpenCodeVersion
  compareVersions: typeof compareVersions
  getPluginInfo: typeof getPluginInfo
  getLoadedPluginVersion: typeof getLoadedPluginVersion
  getLatestPluginVersion: typeof getLatestPluginVersion
  getSuggestedInstallTag: typeof getSuggestedInstallTag
  configExists: typeof existsSync
  readConfigFile: (path: string) => string
  parseConfigContent: (content: string) => unknown
}

const defaultDeps: SystemCheckDeps = {
  findOpenCodeBinary,
  getOpenCodeVersion,
  compareVersions,
  getPluginInfo,
  getLoadedPluginVersion,
  getLatestPluginVersion,
  getSuggestedInstallTag,
  configExists: existsSync,
  readConfigFile: (path) => readFileSync(path, "utf-8"),
  parseConfigContent: (content) => parseJsonc<Record<string, unknown>>(content),
}

const BUN_POSTINSTALL_HELPER_PACKAGE_NAME = "@code-yeongyu/comment-checker"

function isConfigValid(configPath: string | null, deps: SystemCheckDeps): boolean {
  if (!configPath) return true
  if (!deps.configExists(configPath)) return false

  try {
    deps.parseConfigContent(deps.readConfigFile(configPath))
    return true
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }

    return false
  }
}

function getResultStatus(issues: DoctorIssue[]): CheckResult["status"] {
  if (issues.some((issue) => issue.severity === "error")) return "fail"
  if (issues.some((issue) => issue.severity === "warning")) return "warn"
  return "pass"
}

function buildMessage(status: CheckResult["status"], issues: DoctorIssue[]): string {
  if (status === "pass") return "System checks passed"
  if (status === "fail") return `${issues.length} system issue(s) detected`
  return `${issues.length} system warning(s) detected`
}

function getLoadedPackageName(installedPackagePath: string): string {
  const parts = installedPackagePath.split(/[\\/]/)
  const nodeModulesIndex = parts.lastIndexOf("node_modules")
  const packageName = nodeModulesIndex >= 0 ? parts[nodeModulesIndex + 1] : undefined
  return packageName !== undefined && ACCEPTED_PACKAGE_NAMES.some((acceptedName) => acceptedName === packageName)
    ? packageName
    : PUBLISHED_PACKAGE_NAME
}

export async function gatherSystemInfo(deps: SystemCheckDeps = defaultDeps): Promise<SystemInfo> {
  const [binaryInfo, pluginInfo] = await Promise.all([
    deps.findOpenCodeBinary(),
    Promise.resolve(deps.getPluginInfo()),
  ])
  const loadedInfo = deps.getLoadedPluginVersion()

  const opencodeVersion = binaryInfo ? await deps.getOpenCodeVersion(binaryInfo.path) : null
  const pluginVersion = pluginInfo.pinnedVersion ?? loadedInfo.expectedVersion ?? loadedInfo.loadedVersion

  return {
    opencodeVersion,
    opencodePath: binaryInfo?.path ?? null,
    pluginVersion,
    loadedVersion: loadedInfo.loadedVersion,
    bunVersion: runtime.Bun?.version ?? "unavailable",
    configPath: pluginInfo.configPath,
    configValid: isConfigValid(pluginInfo.configPath, deps),
    isLocalDev: pluginInfo.isLocalDev,
  }
}

export async function checkSystem(deps: SystemCheckDeps = defaultDeps): Promise<CheckResult> {
  const [systemInfo, pluginInfo] = await Promise.all([
    gatherSystemInfo(deps),
    Promise.resolve(deps.getPluginInfo()),
  ])
  const loadedInfo = deps.getLoadedPluginVersion()
  const latestVersion = await deps.getLatestPluginVersion(systemInfo.loadedVersion)
  const installTag = deps.getSuggestedInstallTag(systemInfo.loadedVersion)
  const issues: DoctorIssue[] = []

  if (!systemInfo.opencodePath) {
    issues.push({
      title: "OpenCode binary not found",
      description: "Install OpenCode CLI or desktop and ensure the binary is available.",
      fix: "Install from https://opencode.ai/docs",
      severity: "error",
      affects: ["doctor", "run"],
    })
  }

  if (
    systemInfo.opencodeVersion &&
    !deps.compareVersions(systemInfo.opencodeVersion, MIN_OPENCODE_VERSION)
  ) {
    issues.push({
      title: "OpenCode version below minimum",
      description: `Detected ${systemInfo.opencodeVersion}; required >= ${MIN_OPENCODE_VERSION}.`,
      fix: "Update OpenCode to the latest stable release",
      severity: "warning",
      affects: ["tooling", "doctor"],
    })
  }

  if (!pluginInfo.registered) {
    issues.push({
      title: `${PLUGIN_NAME} is not registered`,
      description: "Plugin entry is missing from OpenCode configuration.",
      fix: `Run: bunx ${PUBLISHED_PACKAGE_NAME} install`,
      severity: "error",
      affects: ["all agents"],
    })
  }

  if (pluginInfo.entry && !pluginInfo.isLocalDev) {
    const isLegacyName = pluginInfo.entry === LEGACY_PLUGIN_NAME
      || pluginInfo.entry.startsWith(`${LEGACY_PLUGIN_NAME}@`)

    if (isLegacyName) {
      const suggestedEntry = pluginInfo.entry.replace(LEGACY_PLUGIN_NAME, PLUGIN_NAME)
      issues.push({
        title: "Using legacy package name",
        description: `Your opencode.json references "${LEGACY_PLUGIN_NAME}" which has been renamed to "${PLUGIN_NAME}". The old name may stop working in a future release.`,
        fix: `Update your opencode.json plugin entry: "${pluginInfo.entry}" → "${suggestedEntry}"`,
        severity: "warning",
        affects: ["plugin loading"],
      })
    }
  }

  if (loadedInfo.expectedVersion && loadedInfo.loadedVersion && loadedInfo.expectedVersion !== loadedInfo.loadedVersion) {
    issues.push({
      title: "Loaded plugin version mismatch",
      description: `Cache expects ${loadedInfo.expectedVersion} but loaded ${loadedInfo.loadedVersion}.`,
      fix: `Reinstall: cd "${loadedInfo.cacheDir}" && bun install`,
      severity: "warning",
      affects: ["plugin loading"],
    })
  }

  if (
    systemInfo.loadedVersion &&
    latestVersion &&
    !deps.compareVersions(systemInfo.loadedVersion, latestVersion)
  ) {
    const loadedPackageName = getLoadedPackageName(loadedInfo.installedPackagePath)
    issues.push({
      title: "Loaded plugin is outdated",
      description: `Loaded ${systemInfo.loadedVersion}, latest ${latestVersion}.`,
      fix: `Update: cd "${loadedInfo.cacheDir}" && bun add ${loadedPackageName}@${installTag}\n` +
        `If Bun reports blocked postinstalls, inspect them: cd "${loadedInfo.cacheDir}" && bun pm untrusted\n` +
        `Then trust only OMO-related packages from that list: cd "${loadedInfo.cacheDir}" && bun pm trust ${loadedPackageName} ${BUN_POSTINSTALL_HELPER_PACKAGE_NAME}`,
      severity: "warning",
      affects: ["plugin features"],
    })
  }

  const status = getResultStatus(issues)
  return {
    name: CHECK_NAMES[CHECK_IDS.SYSTEM],
    status,
    message: buildMessage(status, issues),
    details: [
      systemInfo.opencodeVersion ? `OpenCode: ${systemInfo.opencodeVersion}` : "OpenCode: not detected",
      `Plugin expected: ${systemInfo.pluginVersion ?? "unknown"}`,
      `Plugin loaded: ${systemInfo.loadedVersion ?? "unknown"}`,
      `Bun: ${systemInfo.bunVersion ?? "unknown"}`,
    ],
    issues,
  }
}

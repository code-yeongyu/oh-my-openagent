import { existsSync, readFileSync } from "node:fs"

import { MIN_OPENCODE_VERSION, CHECK_IDS, CHECK_NAMES } from "../constants"
import type { CheckResult, DoctorIssue, SystemInfo } from "../types"
import { findOpenCodeBinary, getOpenCodeVersion, compareVersions } from "./system-binary"
import { getPluginInfo } from "./system-plugin"
import { getLatestPluginVersion, getLoadedPluginVersion } from "./system-loaded-version"
import { parseJsonc } from "../../../shared"

function isConfigValid(configPath: string | null): boolean {
  if (!configPath) return true
  if (!existsSync(configPath)) return false

  try {
    parseJsonc<Record<string, unknown>>(readFileSync(configPath, "utf-8"))
    return true
  } catch {
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

export async function gatherSystemInfo(): Promise<SystemInfo> {
  const [binaryInfo, pluginInfo] = await Promise.all([findOpenCodeBinary(), Promise.resolve(getPluginInfo())])
  const loadedInfo = getLoadedPluginVersion()

  const opencodeVersion = binaryInfo ? await getOpenCodeVersion(binaryInfo.path) : null
  const pluginVersion = pluginInfo.pinnedVersion ?? loadedInfo.expectedVersion

  return {
    opencodeVersion,
    opencodePath: binaryInfo?.path ?? null,
    pluginVersion,
    loadedVersion: loadedInfo.loadedVersion,
    bunVersion: Bun.version,
    configPath: pluginInfo.configPath,
    configValid: isConfigValid(pluginInfo.configPath),
    isLocalDev: pluginInfo.isLocalDev,
  }
}

export async function checkSystem(): Promise<CheckResult> {
  const [systemInfo, pluginInfo] = await Promise.all([gatherSystemInfo(), Promise.resolve(getPluginInfo())])
  const loadedInfo = getLoadedPluginVersion()
  const latestVersion = await getLatestPluginVersion(systemInfo.loadedVersion)
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
    !compareVersions(systemInfo.opencodeVersion, MIN_OPENCODE_VERSION)
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
      title: "oh-my-opencode is not registered",
      description: "Plugin entry is missing from OpenCode configuration.",
      fix: "Run: bunx oh-my-opencode install",
      severity: "error",
      affects: ["all agents"],
    })
  }

  if (loadedInfo.expectedVersion && loadedInfo.loadedVersion && loadedInfo.expectedVersion !== loadedInfo.loadedVersion) {
    issues.push({
      title: "Loaded plugin version mismatch",
      description: `Cache expects ${loadedInfo.expectedVersion} but loaded ${loadedInfo.loadedVersion}.`,
      fix: "Reinstall plugin dependencies in OpenCode cache",
      severity: "warning",
      affects: ["plugin loading"],
    })
  }

  if (
    systemInfo.loadedVersion &&
    latestVersion &&
    !compareVersions(systemInfo.loadedVersion, latestVersion)
  ) {
    issues.push({
      title: "Loaded plugin is outdated",
      description: `Loaded ${systemInfo.loadedVersion}, latest ${latestVersion}.`,
      fix: "Update: cd ~/.config/opencode && bun update oh-my-opencode",
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

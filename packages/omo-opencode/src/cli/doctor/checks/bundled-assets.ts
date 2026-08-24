import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { CHECK_IDS, CHECK_NAMES } from "../framework/constants"
import type { CheckResult, DoctorIssue } from "../framework/types"
import { getLoadedPluginVersion } from "./system-loaded-version"

export const REQUIRED_BUNDLED_ASSETS = [
  "dist/index.js",
  "bin/platform.js",
  "dist/skills/frontend/SKILL.md",
] as const

const REINSTALL_FIX = "Delete the version-tagged directory for this package under ~/.cache/opencode/packages (or the path reported below), then restart OpenCode so it reinstalls the plugin, and run `bunx oh-my-openagent doctor` again."

export interface BundledAssetsEvaluation {
  packageRoot: string | null
  checkedAssets: string[]
  missingAssets: string[]
}

export function evaluateBundledAssets(packageRoot: string | null): BundledAssetsEvaluation {
  if (!packageRoot) {
    return { packageRoot: null, checkedAssets: [], missingAssets: [] }
  }

  const missingAssets = REQUIRED_BUNDLED_ASSETS.filter((asset) => !existsSync(join(packageRoot, asset)))

  return {
    packageRoot,
    checkedAssets: [...REQUIRED_BUNDLED_ASSETS],
    missingAssets,
  }
}

function buildMissingAssetIssues(packageRoot: string, missingAssets: string[]): DoctorIssue[] {
  return missingAssets.map((asset) => ({
    title: "Missing bundled plugin asset",
    description: `${join(packageRoot, asset)} is missing from the installed plugin package. OpenCode can load a partially installed package without registering any OMO agents, tools, or hooks.`,
    fix: REINSTALL_FIX,
    affects: ["all OMO agents", "tools", "hooks"],
    severity: "error",
  }))
}

export async function checkBundledAssets(): Promise<CheckResult> {
  const loaded = getLoadedPluginVersion()
  const installedPackagePath = loaded.installedPackagePath
  const packageRoot = installedPackagePath && existsSync(installedPackagePath)
    ? dirname(installedPackagePath)
    : null

  if (!packageRoot) {
    return {
      name: CHECK_NAMES[CHECK_IDS.BUNDLED_ASSETS],
      status: "skip",
      message: "Installed plugin package not found; bundled asset verification skipped.",
      details: [
        `Resolved cache dir: ${loaded.cacheDir}`,
        "The SYSTEM check reports plugin registration problems.",
      ],
      issues: [],
    }
  }

  const evaluation = evaluateBundledAssets(packageRoot)

  if (evaluation.missingAssets.length === 0) {
    return {
      name: CHECK_NAMES[CHECK_IDS.BUNDLED_ASSETS],
      status: "pass",
      message: `All ${evaluation.checkedAssets.length} required bundled assets are present.`,
      details: [`Package root: ${packageRoot}`],
      issues: [],
    }
  }

  return {
    name: CHECK_NAMES[CHECK_IDS.BUNDLED_ASSETS],
    status: "fail",
    message: `${evaluation.missingAssets.length} of ${evaluation.checkedAssets.length} required bundled assets are missing from ${packageRoot}. The plugin likely fails during initialization while OpenCode keeps running with stock agents.`,
    details: evaluation.missingAssets.map((asset) => `missing: ${join(packageRoot, asset)}`),
    issues: buildMissingAssetIssues(packageRoot, evaluation.missingAssets),
  }
}

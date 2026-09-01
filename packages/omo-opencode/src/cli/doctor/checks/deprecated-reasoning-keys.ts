import { parse } from "jsonc-parser/lib/esm/main.js"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { CHECK_IDS, CHECK_NAMES } from "../framework/constants"
import type { CheckResult, DoctorIssue } from "../framework/types"

const CANONICAL_REPLACEMENT = new Map([
  ["variant", "reasoning"],
  ["reasoningEffort", "reasoning"],
  ["thinking", 'reasoning: "off" or provider_options.thinking'],
  ["textVerbosity", "provider_options.textVerbosity"],
  ["fallback_models", "models"],
])

const TUNING_CONTAINERS = new Set(["agents", "categories", "models"])
// Canonical migration output nests provider-native keys (thinking, textVerbosity) under these
// containers; their children must never be re-flagged as deprecated top-level keys.
const PASSTHROUGH_CONTAINERS = new Set(["provider_options", "providerOptions"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isHarnessBlock(key: string): boolean {
  return key.startsWith("[") && key.endsWith("]")
}

function collectIssues(configPath: string, value: unknown, prefix: string): DoctorIssue[] {
  if (!isRecord(value)) return []
  const issues: DoctorIssue[] = []

  for (const [key, child] of Object.entries(value)) {
    const path = prefix.length > 0 ? `${prefix}.${key}` : key
    const replacement = CANONICAL_REPLACEMENT.get(key)
    if (replacement !== undefined) {
      issues.push({
        title: "Deprecated config key",
        description: `${configPath}: ${path}`,
        fix: `Replace ${key} with ${replacement}, or run: oh-my-openagent config migrate`,
        severity: "warning",
        affects: [path],
      })
      continue
    }
    if (!isRecord(child)) continue
    if (PASSTHROUGH_CONTAINERS.has(key)) continue
    // A profile only scopes overrides; its own name is not part of the key path users edit.
    if (prefix.length === 0 && key === "profiles") {
      for (const profile of Object.values(child)) {
        issues.push(...collectIssues(configPath, profile, ""))
      }
      continue
    }
    if (key === "[opencode]") continue
    if (TUNING_CONTAINERS.has(key) || isHarnessBlock(key) || prefix.length > 0) {
      issues.push(...collectIssues(configPath, child, path))
    }
  }

  return issues
}

function userConfigPaths(): readonly string[] {
  const home = process.env.HOME ?? process.env.USERPROFILE
  if (home === undefined || home.length === 0) return []
  return [join(home, ".omo", "omo.jsonc"), join(home, ".omo", "omo.json")]
}

export async function checkDeprecatedReasoningKeys(): Promise<CheckResult> {
  const issues: DoctorIssue[] = []
  const scanned: string[] = []

  for (const configPath of userConfigPaths()) {
    if (!existsSync(configPath)) continue
    scanned.push(configPath)
    const parsed: unknown = parse(readFileSync(configPath, "utf-8"))
    issues.push(...collectIssues(configPath, parsed, ""))
  }

  return {
    name: CHECK_NAMES[CHECK_IDS.CONFIG],
    status: issues.length > 0 ? "warn" : "pass",
    message: issues.length > 0
      ? `${issues.length} deprecated config key(s) found`
      : "No deprecated config keys found",
    ...(scanned.length > 0 ? { details: scanned.map((path) => `Scanned: ${path}`) } : {}),
    issues,
  }
}

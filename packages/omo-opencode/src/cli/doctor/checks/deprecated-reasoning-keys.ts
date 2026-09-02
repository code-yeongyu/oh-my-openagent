import { parse } from "jsonc-parser/lib/esm/main.js"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { CHECK_IDS, CHECK_NAMES } from "../framework/constants"
import type { CheckResult, DoctorIssue } from "../framework/types"

type TuningContainer = "agents" | "categories" | "models"
type HarnessBlock = "[codex]" | "[senpi]" | "[opencode]"

export const DEPRECATED_CONFIG_KEY_REPLACEMENTS: readonly {
  readonly key: string
  readonly replacement: string
}[] = [
  { key: "variant", replacement: "reasoning" },
  { key: "reasoningEffort", replacement: "reasoning" },
  { key: "thinking", replacement: 'reasoning: "off" or provider_options.thinking' },
  { key: "textVerbosity", replacement: "provider_options.textVerbosity" },
  { key: "fallback_models", replacement: "a models chain" },
]

const REPLACEMENT_BY_KEY = new Map(DEPRECATED_CONFIG_KEY_REPLACEMENTS.map((rule) => [rule.key, rule]))

const TUNING_CONTAINERS = new Set(["agents", "categories", "models"])
const TYPED_HARNESS_BLOCKS = new Set<HarnessBlock>(["[codex]", "[senpi]"])
// Canonical migration output nests provider-native keys (thinking, textVerbosity) under these
// containers; their children must never be re-flagged as deprecated top-level keys.
const PASSTHROUGH_CONTAINERS = new Set(["provider_options", "providerOptions"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isHarnessBlock(key: string): boolean {
  return key.startsWith("[") && key.endsWith("]")
}

function containerForPath(path: string): TuningContainer | undefined {
  return path.split(".").find((part): part is TuningContainer => TUNING_CONTAINERS.has(part))
}

function harnessForPath(path: string): HarnessBlock | undefined {
  return path.split(".").find((part): part is HarnessBlock => part === "[codex]" || part === "[senpi]" || part === "[opencode]")
}

function isDeprecatedKeyPath(key: string, path: string): boolean {
  const container = containerForPath(path)
  if (container === undefined) return false
  if (key !== "fallback_models") return true
  if (container === "categories") return true
  if (container !== "agents") return false
  const harness = harnessForPath(path)
  return harness !== undefined && TYPED_HARNESS_BLOCKS.has(harness)
}

function formatFix(key: string, replacement: string): string {
  if (key === "fallback_models") return "Run: oh-my-openagent config migrate to convert fallback_models into a models chain"
  return `Replace ${key} with ${replacement}, or run: oh-my-openagent config migrate`
}

function collectIssues(configPath: string, value: unknown, prefix: string): DoctorIssue[] {
  if (!isRecord(value)) return []
  const issues: DoctorIssue[] = []

  for (const [key, child] of Object.entries(value)) {
    const path = prefix.length > 0 ? `${prefix}.${key}` : key
    const rule = REPLACEMENT_BY_KEY.get(key)
    if (rule !== undefined && isDeprecatedKeyPath(key, path)) {
      issues.push({
        title: "Deprecated config key",
        description: `${configPath}: ${path}`,
        fix: formatFix(key, rule.replacement),
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

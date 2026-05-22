import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseJsonc } from "../../../shared"
import type { DoctorIssue } from "../types"

type OpenCodeModelEntry = {
  limit?: { context?: number; output?: number }
}

type OpenCodeProviderEntry = {
  npm?: string
  models?: Record<string, OpenCodeModelEntry>
}

type OpenCodeConfig = {
  provider?: Record<string, OpenCodeProviderEntry>
}

// Providers that route through @ai-sdk/openai-compatible (or its forks) do NOT
// publish their context window to OpenCode's models.dev cache, so `limit` MUST
// be supplied inline in opencode.json. When it's missing, OpenCode's overflow
// detector sees `context === 0` and auto-compaction never triggers. Issue #4184.
const COMPAT_SDK_PREFIXES: readonly string[] = [
  "@ai-sdk/openai-compatible",
  "@ai-sdk/openai", // user-defined custom providers
]

function getUserOpencodeConfigCandidates(): string[] {
  const xdgConfig = process.env["XDG_CONFIG_HOME"]
  const configDir = xdgConfig ? join(xdgConfig, "opencode") : join(homedir(), ".config", "opencode")
  return [join(configDir, "opencode.json"), join(configDir, "opencode.jsonc")]
}

function getProjectOpencodeConfigCandidates(): string[] {
  const projectDir = join(process.cwd(), ".opencode")
  return [join(projectDir, "opencode.json"), join(projectDir, "opencode.jsonc")]
}

function readOpenCodeConfig(candidatePaths: readonly string[]): { path: string; config: OpenCodeConfig } | null {
  for (const path of candidatePaths) {
    if (!existsSync(path)) continue
    try {
      const content = readFileSync(path, "utf-8")
      const parsed = parseJsonc<OpenCodeConfig>(content)
      if (parsed) return { path, config: parsed }
    } catch {
      // ignore parse errors — the main config check surfaces them separately
    }
  }
  return null
}

function isOpenAiCompatProvider(entry: OpenCodeProviderEntry): boolean {
  if (!entry.npm) return false
  return COMPAT_SDK_PREFIXES.some((prefix) => entry.npm === prefix || entry.npm?.startsWith(`${prefix}@`))
}

function modelHasUsableLimit(entry: OpenCodeModelEntry): boolean {
  const context = entry.limit?.context
  return typeof context === "number" && context > 0
}

function collectIssuesFromConfig(
  config: OpenCodeConfig,
  configPath: string,
): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const providers = config.provider ?? {}
  for (const [providerId, providerEntry] of Object.entries(providers)) {
    if (!isOpenAiCompatProvider(providerEntry)) continue
    const models = providerEntry.models ?? {}
    for (const [modelId, modelEntry] of Object.entries(models)) {
      if (modelHasUsableLimit(modelEntry)) continue
      issues.push({
        title: "Custom provider model is missing limit.context",
        description:
          `${providerId}/${modelId} (npm: ${providerEntry.npm}) has no limit.context. OpenCode's auto-compaction relies on this to detect overflow; without it, sessions silently exhaust the context window and the agent stops emitting tool calls.`,
        fix:
          `Add limit.context (and ideally limit.output) to provider.${providerId}.models.${modelId} in ${configPath}. Example: "limit": { "context": 128000, "output": 8192 }`,
        severity: "warning",
        affects: ["auto-compaction", `${providerId}/${modelId}`],
      })
    }
  }
  return issues
}

export function collectCustomProviderLimitIssues(): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  for (const candidates of [getUserOpencodeConfigCandidates(), getProjectOpencodeConfigCandidates()]) {
    const found = readOpenCodeConfig(candidates)
    if (!found) continue
    issues.push(...collectIssuesFromConfig(found.config, found.path))
  }
  return issues
}

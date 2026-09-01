import { resolve } from "node:path"

import type { SenpiExtensionAPI, ComponentLogger } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"
import { skillsUsagePaths } from "./skills-usage-ledger"
import { extractSkillId, SkillsUsageTracker } from "./skills-usage-tracker"

/** File-read tool names tracked by the ledger, matching guard.ts classification. */
const READ_TOOL_NAMES = ["read", "cat", "less"] as const

/** Path arguments inspected by the ledger, matching guard.ts classification. */
const PATH_ARGUMENT_NAMES = ["path", "filePath", "file_path", "target"] as const

export interface SkillsUsageOptions {
  readonly resolveContext: (eventContext: unknown) => MemoryIdentityContext | undefined
  readonly resolveCwd?: () => string
  readonly logger?: ComponentLogger
  readonly now?: () => Date
}

/** Registers the Senpi tool-call watcher and returns its identity-scoped trackers. */
export function registerSkillsUsage(
  pi: SenpiExtensionAPI,
  options: SkillsUsageOptions,
): Map<string, SkillsUsageTracker> {
  const resolveCwd = options.resolveCwd ?? (() => process.cwd())
  const trackers = new Map<string, SkillsUsageTracker>()

  function trackerFor(context: MemoryIdentityContext): SkillsUsageTracker {
    const existing = trackers.get(context.identity)
    if (existing !== undefined) return existing
    const tracker = new SkillsUsageTracker({
      paths: skillsUsagePaths(context.identityPaths),
      repoDir: context.identityPaths.repo,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    })
    trackers.set(context.identity, tracker)
    return tracker
  }

  pi.on("tool_call", (payload): void => {
    const context = options.resolveContext(payload)
    if (context === undefined) return

    const event = readToolCall(payload)
    if (event === undefined || !isReadTool(event.toolName)) return

    for (const rawPath of extractPaths(event.input)) {
      const resolved = resolve(resolveCwd(), rawPath)
      if (extractSkillId(context.identityPaths.repo, resolved) === undefined) continue
      trackerFor(context).recordRead(resolved)
    }
  })

  return trackers
}

type ToolCall = {
  readonly toolName: string
  readonly input: Record<string, unknown>
}

function readToolCall(value: unknown): ToolCall | undefined {
  if (!isRecord(value)) return undefined
  const toolName = value.toolName
  const input = value.input
  if (typeof toolName !== "string" || !isRecord(input)) return undefined
  return { toolName, input }
}

function isReadTool(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase().replaceAll("-", "_")
  return READ_TOOL_NAMES.some((name) =>
    normalized === name
    || normalized.endsWith(`_${name}`)
    || normalized.endsWith(`:${name}`)
    || normalized.endsWith(`/${name}`)
  )
}

function extractPaths(input: Record<string, unknown>): string[] {
  const paths: string[] = []
  for (const name of PATH_ARGUMENT_NAMES) {
    const value = input[name]
    if (typeof value === "string" && value.length > 0) paths.push(value)
  }
  const multiple = input.paths
  if (Array.isArray(multiple)) {
    for (const value of multiple) {
      if (typeof value === "string" && value.length > 0) paths.push(value)
    }
  }
  return paths
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

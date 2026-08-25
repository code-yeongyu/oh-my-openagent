import { resolve } from "node:path"

import type { SenpiExtensionAPI, ComponentLogger } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"
import { memoryUsagePaths } from "./memory-usage-ledger"
import { extractMemoryUsagePath, MemoryUsageTracker } from "./memory-usage-tracker"

/** File-read tool names tracked by the ledger, matching guard.ts classification. */
const READ_TOOL_NAMES = ["read", "cat", "less"] as const

/** Path arguments inspected by the ledger, matching guard.ts classification. */
const PATH_ARGUMENT_NAMES = ["path", "filePath", "file_path", "target"] as const

export interface MemoryUsageOptions {
  readonly resolveContext: (eventContext: unknown) => MemoryIdentityContext | undefined
  readonly resolveCwd?: () => string
  readonly logger?: ComponentLogger
  readonly now?: () => Date
}

/** Registers the Senpi tool-call watcher and returns its identity-scoped trackers. */
export function registerMemoryUsage(
  pi: SenpiExtensionAPI,
  options: MemoryUsageOptions,
): Map<string, MemoryUsageTracker> {
  const resolveCwd = options.resolveCwd ?? (() => process.cwd())
  const trackers = new Map<string, MemoryUsageTracker>()

  function trackerFor(context: MemoryIdentityContext): MemoryUsageTracker {
    const existing = trackers.get(context.identity)
    if (existing !== undefined) return existing
    const tracker = new MemoryUsageTracker({
      paths: memoryUsagePaths(context.identityPaths),
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
      if (extractMemoryUsagePath(context.identityPaths.repo, resolved) === undefined) continue
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
    || normalized.endsWith(`/${name}`),
  )
}

function extractPaths(input: Record<string, unknown>): string[] {
  const paths: string[] = []
  for (const arg of PATH_ARGUMENT_NAMES) {
    const value = input[arg]
    if (typeof value === "string" && value.length > 0) paths.push(value)
  }
  return paths
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

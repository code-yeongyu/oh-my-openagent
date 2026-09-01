import { lstatSync, readdirSync, realpathSync } from "@oh-my-opencode/memory-core/fs"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"

import type { ToolCallEventResult } from "@code-yeongyu/senpi"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"

const FILE_TOOL_NAMES = ["read", "write", "edit", "ls", "find", "grep", "glob"] as const
const ENUMERATION_TOOL_NAMES = new Set(["ls", "find", "grep", "glob"])
const PATH_ARGUMENT_NAMES = ["path", "filePath", "file_path", "target"] as const
const BASH_ADVISORY = "omo-senpi memory guard advisory: bash command references another memory identity; shell text is not blocked because this soft guard is not a security boundary"

export interface MemoryGuardOptions {
  readonly getContext: (eventContext: unknown) => MemoryIdentityContext | undefined
  readonly resolveCwd?: () => string
}

type ToolCall = {
  readonly toolName: string
  readonly input: Record<string, unknown>
}

type GuardRoots = {
  readonly agentsRoot: string
  readonly ownRoot: string
  readonly foreignRoots: readonly string[]
}

/**
 * Registers the soft in-process guard for file tools.
 *
 * Bash is deliberately advisory-only: command-string inspection is bypassable and therefore is not
 * a security boundary. The hard filesystem policy introduced by plan todo 31 is responsible for
 * enforcing shell and post-canonicalization access once that Senpi capability is available.
 */
export function registerMemoryGuard(
  pi: SenpiExtensionAPI,
  componentContext: ComponentContext,
  options: MemoryGuardOptions,
): void {
  const resolveCwd = options.resolveCwd ?? (() => process.cwd())
  const warnedBashSessions = new Set<string>()

  pi.on("tool_call", (payload, eventContext): ToolCallEventResult | undefined => {
    const context = options.getContext(eventContext)
    if (context === undefined) return undefined

    const event = readToolCall(payload)
    if (event === undefined) return undefined

    const roots = resolveGuardRoots(context)
    if (matchesToolName(event.toolName, "bash")) {
      adviseBashOnce(event, eventContext, roots, warnedBashSessions, componentContext)
      return undefined
    }

    const operation = classifyFileOperation(event.toolName, componentContext)
    if (operation === undefined) return undefined

    const recursive = ENUMERATION_TOOL_NAMES.has(operation)
    for (const rawPath of extractTargetPaths(event.input, operation === "patch")) {
      if (!isForbiddenTarget(rawPath, resolveCwd(), roots, recursive)) continue
      return {
        block: true,
        reason: `cross-identity memory access denied: ${event.toolName} to ${rawPath} belongs to another memory identity`,
      }
    }
    return undefined
  })
}

function readToolCall(value: unknown): ToolCall | undefined {
  if (!isRecord(value)) return undefined
  const toolName = value.toolName
  const input = value.input
  if (typeof toolName !== "string" || !isRecord(input)) return undefined
  return { toolName, input }
}

function classifyFileOperation(toolName: string, context: ComponentContext): string | undefined {
  for (const name of FILE_TOOL_NAMES) {
    if (matchesToolName(toolName, name)) return name
  }
  if (matchesToolName(toolName, "apply_patch")) return "patch"
  return isRegisteredPatchTool(toolName, context) ? "patch" : undefined
}

function isRegisteredPatchTool(toolName: string, context: ComponentContext): boolean {
  const capturedTools = context.getCapturedTools?.() ?? []
  const normalizedTarget = toolName.toLowerCase()
  for (const tool of capturedTools) {
    const name = Reflect.get(tool, "name")
    if (typeof name !== "string" || name.toLowerCase() !== normalizedTarget) continue
    const normalized = normalizeToolName(name)
    return /(?:^|[^a-z0-9])(?:apply_)?patch(?:$|[^a-z0-9])/.test(normalized)
  }
  return false
}

function matchesToolName(toolName: string, expected: string): boolean {
  const normalized = normalizeToolName(toolName)
  const suffix = normalizeToolName(expected)
  return normalized === suffix || normalized.endsWith(`_${suffix}`) || normalized.endsWith(`:${suffix}`) || normalized.endsWith(`/${suffix}`)
}

function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase().replaceAll("-", "_")
}

function extractTargetPaths(input: Record<string, unknown>, patchTool: boolean): string[] {
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

  if (patchTool && typeof input.input === "string") {
    paths.push(...extractPatchDirectivePaths(input.input))
  }
  return paths
}

function extractPatchDirectivePaths(patch: string): string[] {
  const paths: string[] = []
  const directive = /^\*\*\* (?:Add|Update|Delete) File:\s*(.+?)\s*$/gm
  const move = /^\*\*\* Move to:\s*(.+?)\s*$/gm
  for (const expression of [directive, move]) {
    let match = expression.exec(patch)
    while (match !== null) {
      const path = match[1]
      if (path !== undefined && path.length > 0) paths.push(path)
      match = expression.exec(patch)
    }
  }
  return paths
}

function resolveGuardRoots(context: MemoryIdentityContext): GuardRoots {
  const ownRoot = resolve(context.identityPaths.root)
  const agentsRoot = dirname(ownRoot)
  const foreignRoots: string[] = []

  try {
    for (const entry of readdirSync(agentsRoot, { withFileTypes: true })) {
      if (entry.name === context.identity) continue
      foreignRoots.push(join(agentsRoot, entry.name))
    }
  } catch (error) {
    if (!isMissingPathError(error)) throw error
  }

  return { agentsRoot, ownRoot, foreignRoots }
}

function isForbiddenTarget(rawPath: string, cwd: string, roots: GuardRoots, recursive: boolean): boolean {
  if (rawPath.includes("\0")) return false
  const lexical = resolve(cwd, rawPath)
  const candidates = uniquePaths([lexical, canonicalizeFromNearestExisting(lexical)])
  const agentsRoots = uniquePaths([roots.agentsRoot, canonicalizeFromNearestExisting(roots.agentsRoot)])
  const ownRoots = uniquePaths([roots.ownRoot, canonicalizeFromNearestExisting(roots.ownRoot)])
  const foreignRoots = uniquePaths(roots.foreignRoots.flatMap((root) => [root, canonicalizeFromNearestExisting(root)]))

  for (const candidate of candidates) {
    if (ownRoots.some((root) => isWithin(root, candidate))) continue
    if (agentsRoots.some((root) => candidate === root)) return true
    if (recursive && agentsRoots.some((root) => isWithin(candidate, root))) return true
    if (foreignRoots.some((root) => isWithin(root, candidate))) return true
  }
  return false
}

function canonicalizeFromNearestExisting(target: string): string | undefined {
  let candidate = target
  const missingSegments: string[] = []
  while (true) {
    try {
      lstatSync(candidate)
      return resolve(realpathSync(candidate), ...missingSegments.reverse())
    } catch (error) {
      if (!isMissingPathError(error)) return undefined
      const parent = dirname(candidate)
      if (parent === candidate) return undefined
      missingSegments.push(basename(candidate))
      candidate = parent
    }
  }
}

function uniquePaths(paths: readonly (string | undefined)[]): string[] {
  return [...new Set(paths.filter((path): path is string => path !== undefined).map((path) => resolve(path)))]
}

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

function adviseBashOnce(
  event: ToolCall,
  eventContext: unknown,
  roots: GuardRoots,
  warnedSessions: Set<string>,
  componentContext: ComponentContext,
): void {
  const command = event.input.command
  if (typeof command !== "string") return

  const forbiddenLiterals = [roots.agentsRoot, ...roots.foreignRoots]
  if (!forbiddenLiterals.some((root) => command.includes(root))) return

  const sessionId = readSessionId(eventContext)
  if (warnedSessions.has(sessionId)) return
  warnedSessions.add(sessionId)
  componentContext.logger.warn(BASH_ADVISORY, { sessionId })
}

function readSessionId(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.sessionManager)) return "unknown-session"
  const manager = value.sessionManager
  const getSessionId = manager.getSessionId
  if (typeof getSessionId !== "function") return "unknown-session"
  const sessionId = Reflect.apply(getSessionId, manager, [])
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : "unknown-session"
}

function isMissingPathError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false
  return error.code === "ENOENT" || error.code === "ENOTDIR"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

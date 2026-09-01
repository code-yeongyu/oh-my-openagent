import { realpathSync } from "node:fs"
import { isAbsolute, relative, resolve, sep, win32 } from "node:path"

import type { SenpiExtensionAPI } from "../../extension/types"
import {
  BUILTIN_CATEGORY_NAMES,
  BUILTIN_SKILL_NAMES,
  CURATED_AGENTS,
  getBuiltinSkillsRoot,
  hashSessionId,
  type OmoNativeEventName,
} from "./product-identity"

type ToolResult = {
  readonly toolName: string
  readonly input: Record<string, unknown>
  readonly isError: boolean
}

type SpawnTarget = { readonly kind: "category" | "subagent"; readonly name: string }

type ToolTelemetryOptions = {
  readonly captureEvent: (name: OmoNativeEventName, properties: Readonly<Record<string, unknown>>) => void
  readonly diagnostics?: (message: string, details?: unknown) => void
  readonly hashSessionId?: (sessionId: string) => string
  readonly skillsRoot?: string
}

const BUILTIN_SKILLS = new Set<string>(BUILTIN_SKILL_NAMES)
const BUILTIN_CATEGORIES = new Set<string>(BUILTIN_CATEGORY_NAMES)
const BUILTIN_AGENTS = new Set<string>(CURATED_AGENTS)

export function registerOmoNativeToolTelemetry(
  pi: SenpiExtensionAPI,
  options: ToolTelemetryOptions,
): void {
  const featureUsage = new Map<string, Set<string>>()
  const sessionHash = options.hashSessionId ?? hashSessionId
  const skillsRoot = options.skillsRoot ?? getBuiltinSkillsRoot()

  pi.on("tool_result", (payload: unknown, eventContext: unknown): void => {
    const event = readToolResult(payload, options.diagnostics)
    if (event === undefined) return
    const sessionId = extractSessionId(eventContext)
    if (sessionId === undefined) return
    const shared = { $session_id: sessionHash(sessionId) }

    if (matchesToolName(event.toolName, "read") && !event.isError) {
      const skillName = builtinSkillName(event.input.path, eventContext, skillsRoot)
      if (skillName !== undefined) options.captureEvent("skill_loaded", { ...shared, skill_name: skillName })
      return
    }

    if (matchesToolName(event.toolName, "task") && !event.isError) {
      const targets = spawnTargets(event.input)
      const batchSizeBucket = bucketBatchSize(Array.isArray(event.input.tasks) ? event.input.tasks.length : 1)
      const background = event.input.run_in_background === true
      for (const target of targets) {
        const allowlist = target.kind === "category" ? BUILTIN_CATEGORIES : BUILTIN_AGENTS
        options.captureEvent("delegation_started", {
          ...shared,
          kind: target.kind,
          name: allowlist.has(target.name) ? target.name : "custom",
          background,
          batch_size_bucket: batchSizeBucket,
        })
      }
      return
    }

    const feature = featureForTool(event.toolName)
    if (feature === undefined) return
    const used = featureUsage.get(sessionId) ?? new Set<string>()
    if (used.has(feature)) return
    used.add(feature)
    featureUsage.set(sessionId, used)
    options.captureEvent("feature_used", { ...shared, feature })
  })

  pi.on("session_shutdown", (_payload: unknown, eventContext: unknown): void => {
    const sessionId = extractSessionId(eventContext)
    if (sessionId !== undefined) featureUsage.delete(sessionId)
  })
}

function readToolResult(
  value: unknown,
  diagnostics: ToolTelemetryOptions["diagnostics"],
): ToolResult | undefined {
  if (!isRecord(value) || value.type !== "tool_result" || typeof value.toolName !== "string") return undefined
  if (!isRecord(value.input)) {
    diagnostics?.("omo-native tool_result missing input", { toolName: value.toolName })
    return undefined
  }
  return { toolName: value.toolName, input: value.input, isError: value.isError === true }
}

type PathSemantics = Pick<typeof win32, "isAbsolute" | "relative" | "sep">

function builtinSkillName(rawPath: unknown, eventContext: unknown, skillsRoot: string): string | undefined {
  if (typeof rawPath !== "string" || rawPath.length === 0 || rawPath.includes("\0")) return undefined
  try {
    const root = realpathSync(skillsRoot)
    const cwd = isRecord(eventContext) && typeof eventContext.cwd === "string" ? eventContext.cwd : process.cwd()
    const target = realpathSync(resolve(cwd, rawPath))
    return builtinSkillNameFromCanonicalPaths(root, target, { isAbsolute, relative, sep })
  } catch {
    return undefined
  }
}

export function builtinSkillNameFromCanonicalPaths(
  root: string,
  target: string,
  path: PathSemantics,
): string | undefined {
  const windows = path.sep === "\\"
  const comparableRoot = windows ? windowsPathWithoutNamespace(root) : root
  const comparableTarget = windows ? windowsPathWithoutNamespace(target) : target
  const pathFromRoot = path.relative(comparableRoot, comparableTarget)
  if (pathFromRoot === "" || pathFromRoot.startsWith(`..${path.sep}`) || pathFromRoot === ".." || path.isAbsolute(pathFromRoot)) return undefined
  const parts = pathFromRoot.split(path.sep)
  if (parts.length !== 2) return undefined
  const skillName = parts[0]
  const fileName = parts[1]
  if (skillName === undefined || fileName === undefined) return undefined
  if (windows) {
    if (fileName.toLowerCase() !== "skill.md") return undefined
    const builtinName = skillName.toLowerCase()
    return BUILTIN_SKILLS.has(builtinName) ? builtinName : undefined
  }
  return fileName === "SKILL.md" && BUILTIN_SKILLS.has(skillName) ? skillName : undefined
}

function windowsPathWithoutNamespace(path: string): string {
  if (path.startsWith("\\\\?\\UNC\\")) return `\\\\${path.slice(8)}`
  if (path.startsWith("\\\\?\\")) return path.slice(4)
  return path
}

function spawnTargets(input: Record<string, unknown>): SpawnTarget[] {
  if (!Array.isArray(input.tasks)) {
    const target = spawnTarget(input, input)
    return target === undefined ? [] : [target]
  }
  return input.tasks.flatMap((item) => {
    if (!isRecord(item)) return []
    const target = spawnTarget(item, input)
    return target === undefined ? [] : [target]
  })
}

function spawnTarget(item: Record<string, unknown>, parent: Record<string, unknown>): SpawnTarget | undefined {
  const itemCategory = identifier(item.category)
  const itemSubagent = identifier(item.subagent_type)
  const category = itemCategory ?? (itemSubagent === undefined ? identifier(parent.category) : undefined)
  const subagent = itemSubagent ?? (itemCategory === undefined ? identifier(parent.subagent_type) : undefined)
  if ((category === undefined) === (subagent === undefined)) return undefined
  return category === undefined ? { kind: "subagent", name: subagent ?? "" } : { kind: "category", name: category }
}

function featureForTool(toolName: string): "goal_tool" | "team_create" | "memory_tool" | undefined {
  if (matchesToolName(toolName, "create_goal")) return "goal_tool"
  if (matchesToolName(toolName, "team_create")) return "team_create"
  if (matchesToolName(toolName, "memory_apply_patch") || matchesToolName(toolName, "memory")) return "memory_tool"
  return undefined
}

function bucketBatchSize(size: number): "1" | "2_4" | "5_plus" {
  if (size <= 1) return "1"
  return size <= 4 ? "2_4" : "5_plus"
}

function extractSessionId(eventContext: unknown): string | undefined {
  if (!isRecord(eventContext) || !isRecord(eventContext.sessionManager)) return undefined
  const getSessionId = eventContext.sessionManager.getSessionId
  if (typeof getSessionId !== "function") return undefined
  const sessionId: unknown = getSessionId.call(eventContext.sessionManager)
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined
}

function matchesToolName(toolName: string, expected: string): boolean {
  const normalized = normalizeToolName(toolName)
  const suffix = normalizeToolName(expected)
  return normalized === suffix || normalized.endsWith(`_${suffix}`) || normalized.endsWith(`:${suffix}`) || normalized.endsWith(`/${suffix}`)
}

function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase().replaceAll("-", "_")
}

function identifier(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

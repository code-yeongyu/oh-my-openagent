import { lstatSync, readdirSync, realpathSync } from "@oh-my-opencode/memory-core/fs"
import { isDarwinAutomountTriggerPath } from "@oh-my-opencode/utils/path-containment"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"

import type { ToolCallEventResult, ToolResultEventResult } from "@code-yeongyu/senpi"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"
import { unverifiedReceiptNotice } from "./receipt-read-guard"
import { isGrantedProjectMemoryRead } from "./project-memory-grants"
import { isWithin as isWithinPath, scanForeignRoots, type AreaEntry, type ForeignRootScan } from "./guard-foreign-roots"
import { TRANSIENT_DIRNAME } from "./transient-identity"

const FILE_TOOL_NAMES = ["read", "write", "edit", "ls", "find", "grep", "glob"] as const
const ENUMERATION_TOOL_NAMES = new Set(["ls", "find", "grep", "glob"])
const PATH_ARGUMENT_NAMES = ["path", "filePath", "file_path", "target"] as const
const NODE_PATH = { isAbsolute, relative, resolve }
/** Per session; past it an ancestor call is denied rather than left unchecked. */
const MAX_PENDING_ANCESTOR_CHECKS = 256
const BASH_ADVISORY =
  "omo-senpi memory guard advisory: bash command references another memory identity; shell text is not blocked because this soft guard is not a security boundary"

export interface MemoryGuardOptions {
  readonly getContext: (eventContext: unknown) => MemoryIdentityContext | undefined
  readonly resolveCwd?: () => string
}

type ToolCall = {
  readonly toolCallId: string | undefined
  readonly toolName: string
  readonly input: Record<string, unknown>
}

/** What an ancestor enumeration was cleared against, re-listed when its result arrives. */
type AncestorCheck = {
  /** Each physical memory area once, by its canonical form. */
  readonly areas: readonly string[]
  /** Own roots to compare listed entries against, including the lexical own root re-rooted under its canonical area. */
  readonly ownRoots: readonly string[]
}

type PendingAncestorCheck = AncestorCheck & {
  readonly toolName: string
  readonly rawPath: string
}

type TargetVerdict = { readonly kind: "inside" } | ({ readonly kind: "ancestor" } & AncestorCheck)

type GuardRoots = {
  /** Every memory area a bound run may not touch outside its own root, lexically. */
  readonly deniedRoots: readonly string[]
  readonly ownRoot: string
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
  // Per session, the ancestor enumerations allowed at tool_call whose results are still outstanding.
  const pendingAncestorChecks = new Map<string, Map<string, PendingAncestorCheck>>()

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
    let ancestor: PendingAncestorCheck | undefined
    for (const rawPath of extractTargetPaths(event.input, operation === "patch")) {
      const cwd = resolveCwd()
      // Built-ins open path.resolve()d targets; suffix-classified external tools may open raw strings.
      const name = normalizeToolName(event.toolName)
      const target =
        name === operation || name === "apply_patch"
          ? resolve(cwd, rawPath)
          : isAbsolute(rawPath)
            ? rawPath
            : `${cwd}/${rawPath}`
      if (operation === "read" && isGrantedProjectMemoryRead(context, target)) continue
      const verdict = classifyTarget(target, cwd, roots, recursive)
      if (verdict === undefined) continue
      if (verdict.kind === "inside") {
        return {
          block: true,
          reason: `cross-identity memory access denied: ${event.toolName} to ${rawPath} belongs to another memory identity`,
        }
      }
      const scan = listForeignRoots(verdict)
      if (scan.kind !== "clear") return { block: true, reason: ancestorDenyReason(event.toolName, rawPath, scan) }
      ancestor = { areas: verdict.areas, ownRoots: verdict.ownRoots, toolName: event.toolName, rawPath }
    }
    if (ancestor === undefined) return undefined
    // The result is re-checked on tool_result; a call that cannot be matched to its result is not allowed.
    const sessionId = readSessionId(eventContext)
    const pending = pendingAncestorChecks.get(sessionId) ?? new Map<string, PendingAncestorCheck>()
    if (event.toolCallId === undefined || pending.size >= MAX_PENDING_ANCESTOR_CHECKS) {
      return {
        block: true,
        reason: ancestorDenyReason(ancestor.toolName, ancestor.rawPath, {
          kind: "unlisted",
          area: ancestor.areas[0] ?? ancestor.rawPath,
        }),
      }
    }
    pending.set(event.toolCallId, ancestor)
    pendingAncestorChecks.set(sessionId, pending)
    return undefined
  })

  // ONE tool_result registration for the whole guard: senpi runs a PostToolUse hook (one hookRunId index) per
  // handler on every tool call, and the EQ goldens pin that count. The ancestor re-check (enumeration tools) and
  // the receipt notice (read tools) never apply to the same call; a replaced result is final.
  pi.on(
    "tool_result",
    (payload, eventContext) => recheckAncestorResult(payload, eventContext) ?? unverifiedReceiptNotice(payload),
  )

  // The host checks only the enumeration root, so an identity created while the walk ran would be read.
  // Re-list the areas once the result exists and, if anything foreign appeared, replace the whole result.
  function recheckAncestorResult(payload: unknown, eventContext: unknown): ToolResultEventResult | undefined {
    if (!isRecord(payload) || typeof payload.toolCallId !== "string") return undefined
    const sessionId = readSessionId(eventContext)
    const pending = pendingAncestorChecks.get(sessionId)
    const check = pending?.get(payload.toolCallId)
    if (pending === undefined || check === undefined) return undefined
    pending.delete(payload.toolCallId)
    if (pending.size === 0) pendingAncestorChecks.delete(sessionId)

    const scan = listForeignRoots(check)
    if (scan.kind === "clear") return undefined
    // An empty object, not null or undefined: every host merge takes `override.details ?? result.details`,
    // so only a non-nullish value drops the tool's own details (grep's matches and file paths). `{}` is what
    // the host's own error results carry, and the grep, ls and find renderers fall back to the text for it.
    return {
      content: [{ type: "text", text: ancestorDenyReason(check.toolName, check.rawPath, scan) }],
      isError: true,
      details: {},
    }
  }

  // A call blocked by a later handler, or aborted before it ran, ends without a tool_result. On the agent loop
  // an executed call reaches tool_result before tool_execution_end; the Cursor exec bridge emits
  // tool_execution_end first, so its result skips the re-check, but that path discards a tool_result override
  // anyway. Pending checks are never released on agent_end: a nested walk from a background cell can outlive a run.
  pi.on("tool_execution_end", (payload, eventContext) => {
    if (!isRecord(payload) || typeof payload.toolCallId !== "string") return
    const sessionId = readSessionId(eventContext)
    const pending = pendingAncestorChecks.get(sessionId)
    pending?.delete(payload.toolCallId)
    if (pending?.size === 0) pendingAncestorChecks.delete(sessionId)
  })
  pi.on("session_shutdown", (_payload, eventContext) => {
    pendingAncestorChecks.delete(readSessionId(eventContext))
  })
}

function listForeignRoots(check: AncestorCheck): ForeignRootScan {
  return scanForeignRoots(check.areas, check.ownRoots, readAreaEntries, NODE_PATH)
}

function readAreaEntries(dir: string): readonly AreaEntry[] {
  return readdirSync(dir, { withFileTypes: true }).map((entry) => ({ name: entry.name, isFile: entry.isFile() }))
}

/** Names only the memory area, never the identity found in it. */
function ancestorDenyReason(
  toolName: string,
  rawPath: string,
  scan: Exclude<ForeignRootScan, { readonly kind: "clear" }>,
): string {
  return scan.kind === "foreign"
    ? `cross-identity memory access denied: ${toolName} to ${rawPath} would enumerate another memory identity found under ${scan.area}`
    : `cross-identity memory access denied: ${toolName} to ${rawPath} could not be checked for another memory identity under ${scan.area}`
}

function readToolCall(value: unknown): ToolCall | undefined {
  if (!isRecord(value)) return undefined
  const toolName = value.toolName
  const input = value.input
  if (typeof toolName !== "string" || !isRecord(input)) return undefined
  return { toolCallId: typeof value.toolCallId === "string" ? value.toolCallId : undefined, toolName, input }
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
  return (
    normalized === suffix ||
    normalized.endsWith(`_${suffix}`) ||
    normalized.endsWith(`:${suffix}`) ||
    normalized.endsWith(`/${suffix}`)
  )
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

/**
 * Structural, not enumerated (issue #7765): the verdict is "inside a memory area but outside your
 * own root", so guard construction costs no directory listing and its cost cannot grow with the
 * number of runs the machine has executed. It is also strictly stronger than the old sibling scan,
 * which could only deny identity directories that happened to exist at the time of the call.
 *
 * Both areas are denied because a transient run's own root lives under `transient-runs/`
 * (transient-identity.ts) while durable memory stays under `agents/`.
 */
function resolveGuardRoots(context: MemoryIdentityContext): GuardRoots {
  const ownRoot = resolve(context.identityPaths.root)
  const durableAgentsRoot = dirname(resolve(context.durableRoot))
  const memoryRoot = dirname(durableAgentsRoot)
  return {
    ownRoot,
    deniedRoots: uniquePaths([dirname(ownRoot), durableAgentsRoot, join(memoryRoot, TRANSIENT_DIRNAME)]),
  }
}

/**
 * `inside`: the target is in a memory area outside the own root. `ancestor`: a recursive tool would walk into
 * a memory area from above, which is denied only when that area holds a foreign root (#12301).
 */
function classifyTarget(
  rawPath: string,
  cwd: string,
  roots: GuardRoots,
  recursive: boolean,
): TargetVerdict | undefined {
  if (rawPath.includes("\0")) return undefined
  const lexical = resolve(cwd, rawPath)
  const candidates = uniquePaths([lexical, canonicalizeFromNearestExisting(rawPath)])
  const deniedRoots = uniquePaths(roots.deniedRoots.flatMap((root) => [root, canonicalizeFromNearestExisting(root)]))
  const ownRoots = uniquePaths([roots.ownRoot, canonicalizeFromNearestExisting(roots.ownRoot)])

  let ancestor = false
  for (const candidate of candidates) {
    if (ownRoots.some((root) => isWithin(root, candidate))) continue
    // Also denies a direct read of a stray file such as agents/.DS_Store, which the ancestor scan skips;
    // the structural rule over-approximates there, harmlessly.
    if (deniedRoots.some((root) => isWithin(root, candidate))) return { kind: "inside" }
    if (recursive && deniedRoots.some((root) => isWithin(candidate, root))) ancestor = true
  }
  return ancestor ? { kind: "ancestor", ...ancestorScanInputs(roots, ownRoots) } : undefined
}

/**
 * The verdict must not depend on which path form reached a directory: list each physical area once by its
 * canonical form, and compare against the own roots plus the lexical own root re-rooted under the canonical
 * area (a case-variant own directory under a symlinked home lists as `<canonical>/agents/Global`).
 */
function ancestorScanInputs(roots: GuardRoots, ownRoots: readonly string[]): AncestorCheck {
  const areas = roots.deniedRoots.map((root) => ({
    lexical: root,
    canonical: canonicalizeFromNearestExisting(root) ?? root,
  }))
  const rerooted = areas
    .filter((area) => isWithin(area.lexical, roots.ownRoot))
    .map((area) => resolve(area.canonical, relative(area.lexical, roots.ownRoot)))
  return {
    areas: uniquePaths(areas.map((area) => area.canonical)),
    ownRoots: uniquePaths([...ownRoots, ...rerooted]),
  }
}

function canonicalizeFromNearestExisting(target: string): string | undefined {
  // A macOS automount trigger stays lexical: lstat/realpath under it can park the host loop (#11545).
  if (isDarwinAutomountTriggerPath(target)) return undefined
  let candidate = target
  const missingSegments: string[] = []
  while (true) {
    try {
      lstatSync(candidate)
      return resolve(realpathSync.native(candidate), ...missingSegments.reverse())
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
  return isWithinPath(root, target, NODE_PATH)
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

  // A sibling identity path always contains its area root literally, so matching the areas is
  // equivalent to the old per-sibling literal list - without listing anything.
  if (!roots.deniedRoots.some((root) => command.includes(root))) return

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

import type { SkillInvocationState } from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"

// Session-scoped state feeding the senpi-task invocation gate for plan-gated agents (metis/momus).
// Three observation channels, deliberately separated because they carry different trust levels:
// - invoked: a `read` tool result on skills/<name>/SKILL.md or a raw `/skill:<name>` input; feeds
//   only the forbids check (start-work), never the requires check.
// - user-requested: raw USER input naming the skill (/skill:ulw-plan or a plain-text ulw-plan
//   mention) AFTER stripping injected <ultrawork-mode>/<system-reminder> blocks, so a directive
//   that merely references ulw-plan cannot arm the gate. A model cannot manufacture this channel.
// - plan artifact: a successful read/write/edit on a .omo/plans/*.md path at ANY root (worktrees
//   and external checkouts included), or an apply_patch whose patch body touches one.
// load_skills on a task spawn arms the CHILD only and is deliberately not a parent-session record.

export type SkillInvocationTracker = {
  readonly stateFor: (sessionId: string) => SkillInvocationState
}

const SKILL_COMMAND_PREFIX = "/skill:"
const SKILL_MD_PATH_PATTERN = /[\\/]skills[\\/]([^\\/]+)[\\/]SKILL\.md$/i
const PLAN_ARTIFACT_PATH_PATTERN = /(^|[\\/])\.omo[\\/]plans[\\/][^\\/]+\.md$/i
const PLAN_ARTIFACT_PATCH_PATTERN = /\.omo[\\/]plans[\\/][^\s"'`]+\.md/i
const INJECTED_BLOCK_PATTERNS = [
  /<ultrawork-mode>[\s\S]*?<\/ultrawork-mode>/gi,
  /<system-reminder>[\s\S]*?<\/system-reminder>/gi,
]
const USER_REQUEST_PATTERNS: Readonly<Record<string, RegExp>> = {
  "ulw-plan": /\bulw[-_ ]?plan\b/i,
}
const PLAN_ARTIFACT_PATH_TOOLS: ReadonlySet<string> = new Set(["read", "write", "edit"])

export function createSkillInvocationTracker(pi: SenpiExtensionAPI): SkillInvocationTracker {
  const invokedBySession = new Map<string, Set<string>>()
  const requestedBySession = new Map<string, Set<string>>()
  const planArtifactSessions = new Set<string>()

  const record = (target: Map<string, Set<string>>, sessionId: string | undefined, skill: string | undefined): void => {
    if (sessionId === undefined || skill === undefined || skill.length === 0) return
    const existing = target.get(sessionId)
    if (existing !== undefined) {
      existing.add(skill)
      return
    }
    target.set(sessionId, new Set([skill]))
  }

  pi.on("tool_result", (payload, eventCtx) => {
    const event = asToolResultEvent(payload)
    if (event === undefined || event.isError) return
    const sessionId = extractSessionId(eventCtx)
    if (event.toolName === "read") record(invokedBySession, sessionId, skillNameFromPath(event.path))
    if (sessionId !== undefined && touchesPlanArtifact(event)) planArtifactSessions.add(sessionId)
  })

  pi.on("input", (payload, eventCtx) => {
    const text = asInputText(payload)
    if (text === undefined) return
    const sessionId = extractSessionId(eventCtx)
    if (text.startsWith(SKILL_COMMAND_PREFIX)) {
      // Mirror senpi's parse (see the ultrawork component): the skill name runs to the first space.
      const spaceIndex = text.indexOf(" ")
      const skill = (
        spaceIndex === -1 ? text.slice(SKILL_COMMAND_PREFIX.length) : text.slice(SKILL_COMMAND_PREFIX.length, spaceIndex)
      ).trim()
      record(invokedBySession, sessionId, skill)
      record(requestedBySession, sessionId, skill)
      return
    }
    const visible = stripInjectedBlocks(text)
    for (const [skill, pattern] of Object.entries(USER_REQUEST_PATTERNS)) {
      if (pattern.test(visible)) record(requestedBySession, sessionId, skill)
    }
  })

  pi.on("session_shutdown", (_payload, eventCtx) => {
    const sessionId = extractSessionId(eventCtx)
    if (sessionId === undefined) return
    invokedBySession.delete(sessionId)
    requestedBySession.delete(sessionId)
    planArtifactSessions.delete(sessionId)
  })

  return {
    stateFor: (sessionId) => ({
      hasInvoked: (skill) => invokedBySession.get(sessionId)?.has(skill) ?? false,
      hasUserRequested: (skill) => requestedBySession.get(sessionId)?.has(skill) ?? false,
      hasPlanArtifact: () => planArtifactSessions.has(sessionId),
    }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function extractSessionId(eventCtx: unknown): string | undefined {
  if (!isRecord(eventCtx) || !isRecord(eventCtx["sessionManager"])) return undefined
  const getSessionId = eventCtx["sessionManager"]["getSessionId"]
  if (typeof getSessionId !== "function") return undefined
  const id: unknown = getSessionId.call(eventCtx["sessionManager"])
  return typeof id === "string" && id.length > 0 ? id : undefined
}

type ToolResultEvent = {
  readonly toolName: string
  readonly path: string | undefined
  readonly patchText: string | undefined
  readonly isError: boolean
}

function asToolResultEvent(payload: unknown): ToolResultEvent | undefined {
  if (!isRecord(payload) || payload["type"] !== "tool_result") return undefined
  const toolName = payload["toolName"]
  if (typeof toolName !== "string") return undefined
  const input = payload["input"]
  const path = isRecord(input) && typeof input["path"] === "string" ? input["path"] : undefined
  const patchText = isRecord(input) && typeof input["input"] === "string" ? input["input"] : undefined
  return { toolName, path, patchText, isError: payload["isError"] === true }
}

function touchesPlanArtifact(event: ToolResultEvent): boolean {
  if (PLAN_ARTIFACT_PATH_TOOLS.has(event.toolName)) {
    return event.path !== undefined && PLAN_ARTIFACT_PATH_PATTERN.test(event.path)
  }
  if (event.toolName === "apply_patch") {
    return event.patchText !== undefined && PLAN_ARTIFACT_PATCH_PATTERN.test(event.patchText)
  }
  return false
}

function asInputText(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const text = payload["text"]
  return typeof text === "string" ? text : undefined
}

function stripInjectedBlocks(text: string): string {
  let visible = text
  for (const pattern of INJECTED_BLOCK_PATTERNS) visible = visible.replace(pattern, "")
  return visible
}

function skillNameFromPath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  return SKILL_MD_PATH_PATTERN.exec(path)?.[1]
}

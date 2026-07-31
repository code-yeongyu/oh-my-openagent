import type { SkillInvocationState } from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"

// Session-scoped record of which skills were invoked, feeding the senpi-task invocation gate for
// plan-gated agents (metis/momus). Two invocation channels are observed: a `read` tool result whose
// path ends in skills/<name>/SKILL.md, and a raw `/skill:<name>` user input (senpi expands the
// slash command after input hooks, so the hook sees the command form). load_skills on a task spawn
// arms the CHILD only and is deliberately not recorded as a parent-session invocation.

export type SkillInvocationTracker = {
  readonly stateFor: (sessionId: string) => SkillInvocationState
}

const SKILL_COMMAND_PREFIX = "/skill:"
const SKILL_MD_PATH_PATTERN = /[\\/]skills[\\/]([^\\/]+)[\\/]SKILL\.md$/i

export function createSkillInvocationTracker(pi: SenpiExtensionAPI): SkillInvocationTracker {
  const invokedBySession = new Map<string, Set<string>>()

  const record = (sessionId: string | undefined, skill: string | undefined): void => {
    if (sessionId === undefined || skill === undefined || skill.length === 0) return
    const existing = invokedBySession.get(sessionId)
    if (existing !== undefined) {
      existing.add(skill)
      return
    }
    invokedBySession.set(sessionId, new Set([skill]))
  }

  pi.on("tool_result", (payload, eventCtx) => {
    const event = asToolResultEvent(payload)
    if (event === undefined || event.isError || event.toolName !== "read") return
    record(extractSessionId(eventCtx), skillNameFromPath(event.path))
  })

  pi.on("input", (payload, eventCtx) => {
    const text = asInputText(payload)
    if (text === undefined || !text.startsWith(SKILL_COMMAND_PREFIX)) return
    // Mirror senpi's parse (see the ultrawork component): the skill name runs to the first space.
    const spaceIndex = text.indexOf(" ")
    const skill = (
      spaceIndex === -1 ? text.slice(SKILL_COMMAND_PREFIX.length) : text.slice(SKILL_COMMAND_PREFIX.length, spaceIndex)
    ).trim()
    record(extractSessionId(eventCtx), skill)
  })

  pi.on("session_shutdown", (_payload, eventCtx) => {
    const sessionId = extractSessionId(eventCtx)
    if (sessionId !== undefined) invokedBySession.delete(sessionId)
  })

  return {
    stateFor: (sessionId) => ({
      hasInvoked: (skill) => invokedBySession.get(sessionId)?.has(skill) ?? false,
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

function asToolResultEvent(payload: unknown): { readonly toolName: string; readonly path: string | undefined; readonly isError: boolean } | undefined {
  if (!isRecord(payload) || payload["type"] !== "tool_result") return undefined
  const toolName = payload["toolName"]
  if (typeof toolName !== "string") return undefined
  const input = payload["input"]
  const path = isRecord(input) && typeof input["path"] === "string" ? input["path"] : undefined
  return { toolName, path, isError: payload["isError"] === true }
}

function asInputText(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const text = payload["text"]
  return typeof text === "string" ? text : undefined
}

function skillNameFromPath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  return SKILL_MD_PATH_PATTERN.exec(path)?.[1]
}

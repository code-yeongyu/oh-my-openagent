import type { SkillInvocationState } from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"
import {
  depositSessionHandoff,
  discardSessionHandoff,
  type PlanTouch,
  shutdownKeepsSession,
  takeSessionHandoff,
} from "./skill-invocation-handoff"

// Session-scoped state feeding the senpi-task invocation gate for plan-gated agents (plan-consultant/plan-reviewer).
// Three observation channels, deliberately separated because they carry different trust levels:
// - invoked: a `read` tool result on skills/<name>/SKILL.md or an expanded `<skill name="...">`
//   block; feeds only the forbids check (ulw-execute), never the requires check.
// - user-requested: raw USER input requesting the skill AFTER stripping injected
//   <ultrawork-mode>/<system-reminder> blocks, so a directive that merely references ulw-plan
//   cannot arm the gate. Two sub-channels, both user-input only: the explicit skill token
//   (`ulw-plan`/`ulw plan`, or an expanded skill block naming it), and an own-words request for a
//   plan before coding - the clause the ulw-plan SKILL.md contract promises in both editions and
//   which previously had no implementation, denying plan-consultant/plan-reviewer to users who simply asked for a
//   plan. Input whose `source` is "extension" is programmatically injected by an extension and is
//   therefore agent-manufacturable, so it never feeds this channel.
// - plan artifact: a successful read/write/edit on a .omo/plans/*.md path at ANY root (worktrees
//   and external checkouts included), or an apply_patch whose patch body touches one. Touches are
//   counted per normalized path (backslashes become forward slashes; roots stay distinct) with a
//   monotonic per-tracker sequence for recency, feeding planArtifactReferences.
// load_skills on a task spawn arms the CHILD only and is deliberately not a parent-session record.

export type SkillInvocationTracker = {
  readonly stateFor: (sessionId: string) => SkillInvocationState
}

const SKILL_COMMAND_PREFIX = "/skill:"
// senpi expands `/skill:<name>` into this block BEFORE the input event fires, so the raw prefix
// almost never survives to a handler. Match the NAME ATTRIBUTE: keying off the body would let any
// other skill that merely mentions "ulw-plan" arm the gate by accident.
const EXPANDED_SKILL_BLOCK_PATTERN = /<skill\s+name="([^"]+)"/gi
// The expansion is `<skill name="X" ...>...body...</skill>` followed by the user's own typed text.
// The body is skill documentation, not something the user said, so it is stripped before any
// text matching - otherwise a skill whose docs mention ulw-plan would arm the gate. A truncated
// block with no closing tag is stripped to the end of the input for the same reason.
const EXPANDED_SKILL_BLOCK_BODY_PATTERNS: readonly RegExp[] = [
  /<skill\s+name="[^"]*"[\s\S]*?<\/skill>/gi,
  /<skill\s+name="[^"]*"[\s\S]*$/i,
]
// Input injected programmatically by an extension - never a human keystroke.
const AGENT_MANUFACTURABLE_INPUT_SOURCE = "extension"
// Replay trusts only the engine's own human-input sources, recorded on the session entry. Anything else
// (absent, `extension`, an unknown or misspelled value, or a value written on the message itself) is
// unknown origin and never arms the user-request channel.
const REPLAY_TRUSTED_INPUT_SOURCES: ReadonlySet<string> = new Set(["interactive", "rpc"])
const SKILL_MD_PATH_PATTERN = /[\\/]skills[\\/]([^\\/]+)[\\/]SKILL\.md$/i
const PLAN_ARTIFACT_PATH_PATTERN = /(^|[\\/])\.omo[\\/]plans[\\/][^\\/]+\.md$/i
const PLAN_ARTIFACT_PATCH_PATTERN = /\.omo[\\/]plans[\\/][^\s"'`]+\.md/i
const PLAN_ARTIFACT_PATCH_PATTERN_GLOBAL = new RegExp(PLAN_ARTIFACT_PATCH_PATTERN.source, "gi")
const INJECTED_BLOCK_PATTERNS = [
  /<ultrawork-mode>[\s\S]*?<\/ultrawork-mode>/gi,
  /<system-reminder>[\s\S]*?<\/system-reminder>/gi,
]
const USER_REQUEST_PATTERNS: Readonly<Record<string, RegExp>> = {
  "ulw-plan": /\bulw[-_ ]?plan\b/i,
}
// Own-words requests for a plan before implementation, per the ulw-plan SKILL.md contract. Kept
// deliberately narrow: each alternative requires an explicit planning noun plus a request or
// ordering cue, so ordinary work instructions ("fix the login bug") never arm the gate.
const OWN_WORDS_PLAN_REQUEST_PATTERNS: readonly RegExp[] = [
  // English: "plan this before coding", "make/write/create a (work) plan first", "plan before you code"
  /\b(?:make|write|create|draw|draft|build)\s+(?:me\s+)?(?:a|an|the)?\s*(?:work|implementation|action)?\s*plan\b/i,
  /\bplan\b[^.!?\n]{0,40}\bbefore\s+(?:you\s+)?(?:cod(?:e|ing)|implement|start|work)/i,
  /\bbefore\s+(?:you\s+)?(?:cod(?:e|ing)|implement|start)\b[^.!?\n]{0,40}\bplan\b/i,
  /\bplan\s+(?:it|this|that|the\s+work)\s+(?:out\s+)?first\b/i,
  // Korean: "계획부터 세워줘", "작업 계획을 먼저 세우자", "계획 작성해줘". The Sino-Korean stems (작성/수립) require the
  // 해 that turns the noun into a verb: bare "계획 작성" is a noun phrase, and a pasted transcript
  // saying "승인은 계획 작성까지만 허가" mentions planning without requesting it.
  /계획(?:서)?(?:부터|을|를|\s)*\s*(?:먼저\s*)?(?:세워|세우|짜|작성해|수립해)/,
  /(?:먼저|우선)\s*계획(?:서)?(?:을|를)?\s*(?:세워|세우|짜|작성해|수립해)/,
]

function isOwnWordsPlanRequest(text: string): boolean {
  return OWN_WORDS_PLAN_REQUEST_PATTERNS.some((pattern) => pattern.test(text))
}

// Skill names carried by expanded `<skill name="...">` blocks in one input.
function expandedSkillBlockNames(text: string): readonly string[] {
  const names: string[] = []
  for (const match of text.matchAll(EXPANDED_SKILL_BLOCK_PATTERN)) {
    const name = match[1]?.trim()
    if (name !== undefined && name.length > 0) names.push(name)
  }
  return [...new Set(names)]
}
const PLAN_ARTIFACT_PATH_TOOLS: ReadonlySet<string> = new Set(["read", "write", "edit"])

export function createSkillInvocationTracker(pi: SenpiExtensionAPI): SkillInvocationTracker {
  const invokedBySession = new Map<string, Set<string>>()
  const requestedBySession = new Map<string, Set<string>>()
  const planTouchesBySession = new Map<string, Map<string, PlanTouch>>()
  const adoptedSessions = new Set<string>()
  let planTouchSequence = 0

  const record = (target: Map<string, Set<string>>, sessionId: string | undefined, skill: string | undefined): void => {
    if (sessionId === undefined || skill === undefined || skill.length === 0) return
    const existing = target.get(sessionId)
    if (existing !== undefined) {
      existing.add(skill)
      return
    }
    target.set(sessionId, new Set([skill]))
  }

  // Adopt the session's handoff once per session per generation, before this generation records
  // anything for it, so the rebuilt tracker starts from what the retired one observed.
  const adoptHandoff = (sessionId: string | undefined): void => {
    if (sessionId === undefined || adoptedSessions.has(sessionId)) return
    adoptedSessions.add(sessionId)
    const handoff = takeSessionHandoff(sessionId)
    if (handoff === undefined) return
    for (const skill of handoff.invoked) record(invokedBySession, sessionId, skill)
    for (const skill of handoff.requested) record(requestedBySession, sessionId, skill)
    if (handoff.planTouches.length > 0) {
      const touches = planTouchesBySession.get(sessionId) ?? new Map<string, PlanTouch>()
      for (const [path, touch] of handoff.planTouches) if (!touches.has(path)) touches.set(path, { ...touch })
      planTouchesBySession.set(sessionId, touches)
    }
    planTouchSequence = Math.max(planTouchSequence, handoff.planTouchSequence)
  }

  const depositHandoff = (sessionId: string): void => {
    depositSessionHandoff(sessionId, {
      invoked: [...(invokedBySession.get(sessionId) ?? [])],
      requested: [...(requestedBySession.get(sessionId) ?? [])],
      planTouches: [...(planTouchesBySession.get(sessionId) ?? [])].map(([path, touch]) => [path, { ...touch }] as const),
      planTouchSequence,
    })
  }

  const observeToolResult = (event: ToolResultEvent, sessionId: string | undefined): void => {
    if (event.isError) return
    if (event.toolName === "read") record(invokedBySession, sessionId, skillNameFromPath(event.path))
    if (sessionId === undefined) return
    const touched = planArtifactPathsTouched(event)
    if (touched.length === 0) return
    let touches = planTouchesBySession.get(sessionId)
    if (touches === undefined) {
      touches = new Map()
      planTouchesBySession.set(sessionId, touches)
    }
    for (const path of touched) {
      planTouchSequence += 1
      const prior = touches.get(path)
      touches.set(path, { count: (prior?.count ?? 0) + 1, lastTouchedAt: planTouchSequence })
    }
  }

  const observeUserInput = (text: string, sessionId: string | undefined): void => {
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
    // The expanded form of that same command: the user picked the skill, so it counts as both an
    // invocation (forbids channel) and a request (requires channel), keyed on the name attribute.
    for (const skill of expandedSkillBlockNames(text)) {
      record(invokedBySession, sessionId, skill)
      record(requestedBySession, sessionId, skill)
    }
    const visible = stripInjectedBlocks(text)
    for (const [skill, pattern] of Object.entries(USER_REQUEST_PATTERNS)) {
      if (pattern.test(visible)) record(requestedBySession, sessionId, skill)
    }
    if (isOwnWordsPlanRequest(visible)) record(requestedBySession, sessionId, "ulw-plan")
  }

  const forget = (sessionId: string): void => {
    invokedBySession.delete(sessionId)
    requestedBySession.delete(sessionId)
    planTouchesBySession.delete(sessionId)
  }

  const snapshot = (sessionId: string): Snapshot => ({
    invoked: [...(invokedBySession.get(sessionId) ?? [])],
    requested: [...(requestedBySession.get(sessionId) ?? [])],
    planTouches: [...(planTouchesBySession.get(sessionId) ?? [])].map(([path, touch]) => [path, { ...touch }] as const),
  })

  const restore = (sessionId: string, kept: Snapshot): void => {
    for (const skill of kept.invoked) record(invokedBySession, sessionId, skill)
    for (const skill of kept.requested) record(requestedBySession, sessionId, skill)
    if (kept.planTouches.length === 0) return
    const touches = planTouchesBySession.get(sessionId) ?? new Map<string, PlanTouch>()
    for (const [path, touch] of kept.planTouches) if (!touches.has(path)) touches.set(path, touch)
    planTouchesBySession.set(sessionId, touches)
  }

  pi.on("tool_result", (payload, eventCtx) => {
    const event = asToolResultEvent(payload)
    if (event === undefined) return
    const sessionId = extractSessionId(eventCtx)
    adoptHandoff(sessionId)
    observeToolResult(event, sessionId)
  })

  pi.on("input", (payload, eventCtx) => {
    const event = asInputEvent(payload)
    if (event === undefined) return
    // Extension-injected text is code the model can drive; it must never arm a gate that exists to
    // prove a HUMAN asked. An absent source means a plain host that only delivers user input.
    if (event.source === AGENT_MANUFACTURABLE_INPUT_SOURCE) return
    const sessionId = extractSessionId(eventCtx)
    adoptHandoff(sessionId)
    observeUserInput(event.text, sessionId)
  })

  // A restarted or restored session has no live events for its past turns, so its own transcript is
  // replayed through the same observers. Tool results replay from any engine. A user entry replays
  // only when the engine recorded a trusted `inputSource` on the entry: an entry with no source cannot
  // be told apart from injected input, so it never arms the user-request channel.
  pi.on("session_start", (_payload, eventCtx) => {
    const sessionId = extractSessionId(eventCtx)
    if (sessionId === undefined) return
    // A host that cannot read the branch has nothing to replay; keep the live state rather than wipe it.
    const persisted = persistedMessages(eventCtx)
    if (persisted === undefined) return
    // Same-process transitions hand state over (adoptHandoff); on an engine that records no input
    // source, that handoff can hold a typed request the transcript cannot prove. Keep it: snapshot the
    // live state, rebuild from the transcript, then union the snapshot back (touch counts from the
    // transcript win, since every live touch is also persisted).
    adoptHandoff(sessionId)
    const kept = snapshot(sessionId)
    forget(sessionId)
    const calls = new Map<string, { readonly name: string; readonly args: unknown }>()
    for (const { message, inputSource } of persisted) {
      const role = message["role"]
      if (role === "user") {
        if (typeof inputSource !== "string" || !REPLAY_TRUSTED_INPUT_SOURCES.has(inputSource)) continue
        observeUserInput(userText(message["content"]), sessionId)
      } else if (role === "assistant") {
        for (const call of toolCalls(message["content"])) calls.set(call.id, call)
      } else if (role === "toolResult") {
        const callId = message["toolCallId"]
        const call = typeof callId === "string" ? calls.get(callId) : undefined
        if (call === undefined) continue
        const event = asToolResultEvent({
          type: "tool_result",
          toolName: call.name,
          input: call.args,
          isError: message["isError"],
        })
        if (event !== undefined) observeToolResult(event, sessionId)
      }
    }
    restore(sessionId, kept)
  })

  pi.on("session_shutdown", (payload, eventCtx) => {
    const sessionId = extractSessionId(eventCtx)
    if (sessionId === undefined) return
    if (shutdownKeepsSession(payload)) depositHandoff(sessionId)
    else discardSessionHandoff(sessionId)
    forget(sessionId)
    adoptedSessions.delete(sessionId)
  })

  return {
    stateFor: (sessionId) => {
      adoptHandoff(sessionId)
      return {
        hasInvoked: (skill) => invokedBySession.get(sessionId)?.has(skill) ?? false,
        hasUserRequested: (skill) => requestedBySession.get(sessionId)?.has(skill) ?? false,
        hasPlanArtifact: () => (planTouchesBySession.get(sessionId)?.size ?? 0) > 0,
        planArtifactReferences: () => {
          const touches = planTouchesBySession.get(sessionId)
          if (touches === undefined) return []
          return [...touches.entries()]
            .map(([path, touch]) => ({ path, count: touch.count, lastTouchedAt: touch.lastTouchedAt }))
            .sort((a, b) => b.count - a.count || b.lastTouchedAt - a.lastTouchedAt)
        },
      }
    },
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

type Snapshot = {
  readonly invoked: readonly string[]
  readonly requested: readonly string[]
  readonly planTouches: readonly (readonly [string, PlanTouch])[]
}

type PersistedMessage = { readonly message: Record<string, unknown>; readonly inputSource: unknown }

function persistedMessages(eventCtx: unknown): readonly PersistedMessage[] | undefined {
  if (!isRecord(eventCtx) || !isRecord(eventCtx["sessionManager"])) return undefined
  const manager = eventCtx["sessionManager"]
  const read = typeof manager["getBranch"] === "function" ? manager["getBranch"] : manager["getEntries"]
  if (typeof read !== "function") return undefined
  const entries: unknown = read.call(manager)
  if (!Array.isArray(entries)) return undefined
  return entries.flatMap((entry: unknown) =>
    isRecord(entry) && entry["type"] === "message" && isRecord(entry["message"])
      ? [{ message: entry["message"], inputSource: entry["inputSource"] }]
      : [],
  )
}

function userText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .flatMap((block: unknown) => (isRecord(block) && block["type"] === "text" && typeof block["text"] === "string" ? [block["text"]] : []))
    .join("\n")
}

function toolCalls(content: unknown): readonly { readonly id: string; readonly name: string; readonly args: unknown }[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((block: unknown) =>
    isRecord(block) && block["type"] === "toolCall" && typeof block["id"] === "string" && typeof block["name"] === "string"
      ? [{ id: block["id"], name: block["name"], args: block["arguments"] }]
      : [],
  )
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

// Returns the distinct normalized plan paths touched by one tool event: the single tool path for
// read/write/edit, or every distinct .omo/plans/*.md match in an apply_patch body (each counted
// once per event no matter how often the patch repeats it). Keys normalize backslashes to forward
// slashes but otherwise keep the observed path, so different worktree roots never collapse.
function planArtifactPathsTouched(event: ToolResultEvent): readonly string[] {
  if (PLAN_ARTIFACT_PATH_TOOLS.has(event.toolName)) {
    if (event.path === undefined || !PLAN_ARTIFACT_PATH_PATTERN.test(event.path)) return []
    return [normalizePlanPath(event.path)]
  }
  if (event.toolName === "apply_patch") {
    if (event.patchText === undefined) return []
    const matches = event.patchText.match(PLAN_ARTIFACT_PATCH_PATTERN_GLOBAL)
    if (matches === null) return []
    return [...new Set(matches.map(normalizePlanPath))]
  }
  return []
}

function normalizePlanPath(path: string): string {
  return path.replace(/\\/g, "/")
}

type InputEvent = {
  readonly text: string
  readonly source: string | undefined
}

function asInputEvent(payload: unknown): InputEvent | undefined {
  if (!isRecord(payload)) return undefined
  const text = payload["text"]
  if (typeof text !== "string") return undefined
  const source = payload["source"]
  return { text, source: typeof source === "string" ? source : undefined }
}

function stripInjectedBlocks(text: string): string {
  let visible = text
  for (const pattern of INJECTED_BLOCK_PATTERNS) visible = visible.replace(pattern, "")
  for (const pattern of EXPANDED_SKILL_BLOCK_BODY_PATTERNS) visible = visible.replace(pattern, "")
  return visible
}

function skillNameFromPath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  return SKILL_MD_PATH_PATTERN.exec(path)?.[1]
}

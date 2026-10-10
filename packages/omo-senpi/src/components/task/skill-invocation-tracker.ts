import type { SkillInvocationState } from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"

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
//   monotonic per-store sequence for recency, feeding planArtifactReferences.
// load_skills on a task spawn arms the CHILD only and is deliberately not a parent-session record.
//
// The three channels live in a store held OUTSIDE the factory. senpi tears down the extension runner
// and re-registers every component on a reload, a session switch and a resume, and it loads packaged
// extensions through an uncached importer, so a store built inside createSkillInvocationTracker()
// comes back empty the moment the extension reloads: a session that had been planning for hours
// silently loses the gate and can no longer spawn plan-consultant/plan-reviewer. The ultrawork
// component documents the same failure and fixes it the same way (see components/ultrawork/index.ts).
// The store also has to survive the reload's own teardown: senpi emits `session_shutdown` with
// reason "reload" to the retiring runner while the SAME session continues, so that one reason keeps
// the session's evidence and every other reason (quit/new/fork/resume) still drops it.

export type SkillInvocationTracker = {
  readonly stateFor: (sessionId: string) => SkillInvocationState
}

// The tracker's whole state. A value rather than a closure so it can outlive one registration;
// tests build their own through createSkillInvocationStore().
export type SkillInvocationStore = {
  readonly revision: number
  readonly invokedBySession: Map<string, Set<string>>
  readonly requestedBySession: Map<string, Set<string>>
  readonly planTouchesBySession: Map<string, Map<string, { count: number; lastTouchedAt: number }>>
  planTouchSequence: number
}

// Bumped when a channel's meaning changes (a new pattern, a new recording rule), so a slot left by an
// older bundle starts clean instead of arming the gate on evidence this build would not record.
const SKILL_INVOCATION_STORE_REVISION = 1

export function createSkillInvocationStore(): SkillInvocationStore {
  return {
    revision: SKILL_INVOCATION_STORE_REVISION,
    invokedBySession: new Map(),
    requestedBySession: new Map(),
    planTouchesBySession: new Map(),
    planTouchSequence: 0,
  }
}

// One store per process, shared by every evaluation of this bundle, so a re-registration picks the
// recorded channels up again. Exported so a test can pin the cross-bundle key itself, exactly as
// TASK_TERMINAL_OBSERVERS_KEY does for the terminal-edge ledger.
export const SKILL_INVOCATION_STORE_KEY = Symbol.for("omo.skillInvocationTracker")

export function sharedSkillInvocationStore(): SkillInvocationStore {
  const registry = globalThis as unknown as Record<symbol, unknown>
  const existing = registry[SKILL_INVOCATION_STORE_KEY]
  if (isSkillInvocationStore(existing)) return existing
  const created = createSkillInvocationStore()
  registry[SKILL_INVOCATION_STORE_KEY] = created
  return created
}

function isSkillInvocationStore(value: unknown): value is SkillInvocationStore {
  if (typeof value !== "object" || value === null) return false
  const store = value as SkillInvocationStore
  return (
    store.revision === SKILL_INVOCATION_STORE_REVISION &&
    store.invokedBySession instanceof Map &&
    store.requestedBySession instanceof Map &&
    store.planTouchesBySession instanceof Map &&
    typeof store.planTouchSequence === "number"
  )
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

// The one teardown that does not end a session: senpi rebuilds the runtime for the same session when
// the config changes, and everything the user already asked for still stands afterwards.
const SESSION_CONTINUING_SHUTDOWN_REASON = "reload"

export function createSkillInvocationTracker(
  pi: SenpiExtensionAPI,
  store: SkillInvocationStore = sharedSkillInvocationStore(),
): SkillInvocationTracker {
  const { invokedBySession, requestedBySession, planTouchesBySession } = store

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
    if (sessionId === undefined) return
    const touched = planArtifactPathsTouched(event)
    if (touched.length === 0) return
    let touches = planTouchesBySession.get(sessionId)
    if (touches === undefined) {
      touches = new Map()
      planTouchesBySession.set(sessionId, touches)
    }
    for (const path of touched) {
      store.planTouchSequence += 1
      const prior = touches.get(path)
      touches.set(path, { count: (prior?.count ?? 0) + 1, lastTouchedAt: store.planTouchSequence })
    }
  })

  pi.on("input", (payload, eventCtx) => {
    const event = asInputEvent(payload)
    if (event === undefined) return
    // Extension-injected text is code the model can drive; it must never arm a gate that exists to
    // prove a HUMAN asked. An absent source means a plain host that only delivers user input.
    if (event.source === AGENT_MANUFACTURABLE_INPUT_SOURCE) return
    const text = event.text
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
  })

  pi.on("session_shutdown", (payload, eventCtx) => {
    if (shutdownReason(payload) === SESSION_CONTINUING_SHUTDOWN_REASON) return
    const sessionId = extractSessionId(eventCtx)
    if (sessionId === undefined) return
    invokedBySession.delete(sessionId)
    requestedBySession.delete(sessionId)
    planTouchesBySession.delete(sessionId)
  })

  return {
    stateFor: (sessionId) => ({
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

// Absent or malformed reasons come from hosts that predate the field, and they drop the state exactly
// as they did before.
function shutdownReason(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const reason = payload["reason"]
  return typeof reason === "string" ? reason : undefined
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

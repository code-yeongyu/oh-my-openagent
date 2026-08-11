import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { SENPI_ULTRAWORK_DIRECTIVE } from "./generated-directive"

// `ulw(?!-)` keeps generous matching ("하이ulw", "ulw_helper.ts") while skipping the
// `ulw-` skill-name family (ulw-plan, ulw-loop, ulw-research): typing a skill name
// must not arm ultrawork mode on top of the skill itself.
const ULTRAWORK_CURRENT_PROMPT_PATTERN = /(?:ultrawork|ulw(?!-))/i
const ULTRAWORK_DISABLED_FLAG = "omo-senpi-ultrawork-disabled"
const ULTRAWORK_MODE_OPEN_TAG = "<ultrawork-mode>"
const ULTRAWORK_MODE_CLOSE_TAG = "</ultrawork-mode>"
const SKILL_COMMAND_PREFIX = "/skill:"
const ULTRAWORK_SKILL_NAME = "ultrawork"
const ULTRAWORK_CUSTOM_TYPE = "omo-ultrawork:directive"

// Re-arm nudge for a session whose transcript already holds the full directive:
// injecting ~17KB again only re-pays tokens for rules the model can already see.
// The reminder must NOT carry the "<ultrawork-mode>" open tag, so it never reads
// as a fresh directive block to the tag-pair guard (or to the model).
const ULTRAWORK_REMINDER =
  "<omo-ultrawork-reminder>ultrawork mode is already armed for this session - the ultrawork directive above remains binding; re-read it and continue.</omo-ultrawork-reminder>"

interface SenpiInputEvent {
  type: "input"
  text: string
  source: "interactive" | "rpc" | "extension"
  streamingBehavior?: "steer" | "followUp"
}

export interface ArmingSnapshot {
  readonly wasArmed: boolean
  readonly compactRearmPending: boolean
}

export type UltraworkInvocationStage = "none" | "first_arm" | "remention" | "post_compact_rearm"
export type UltraworkRoute = "none" | "direct" | "skill_args" | "skill_expansion" | "embedded_directive"
export type UltraworkSuppressionReason =
  | "none"
  | "extension_source"
  | "no_keyword"
  | "skill_name_only"
  | "skill_expansion"
  | "embedded_directive"

export interface UltraworkClassification {
  readonly matchedUlw: boolean
  readonly matchedUltrawork: boolean
  readonly occurrenceCount: number
  readonly effective: boolean
  readonly stage: UltraworkInvocationStage
  readonly route: UltraworkRoute
  readonly suppressionReason: UltraworkSuppressionReason
}

type SenpiInputEventResult = { action: "continue" } | { action: "transform"; text: string }

// The structural slice of senpi's ExtensionContext the arming ledger reads. Every
// event handler receives the live ExtensionContext, so the session id is available
// on input events directly and on the session lifecycle events that feed the tracker.
interface SessionEventContext {
  readonly sessionManager?: {
    getSessionId(): string
  }
}

export interface SessionArming {
  trackSession(sessionId: string | undefined): void
  currentSessionId(): string | undefined
  rearmOnCompact(sessionId: string | undefined): void
  isArmed(sessionId: string | undefined): boolean
  isCompactRearmPending?(sessionId: string | undefined): boolean
  markArmed(sessionId: string | undefined): void
}

// Senpi tears down the extension runner and re-registers every component during
// a session switch or resume, and it loads PACKAGED extensions through an
// uncached importer (Jiti `moduleCache: false` in core/extensions/loader.ts), so
// every module-scope binding in this bundle is reconstructed on each load. A
// ledger held at module scope — or inside register() — forgets every armed
// session there and re-injects the full ~17KB directive on the next trigger, the
// exact token burn this guard exists to stop. The default ledger therefore hangs
// off globalThis (process-lifetime, survives re-evaluation), keyed by a
// registered symbol so every evaluation of the bundle shares one ledger — but
// ONLY while the directive text matches exactly: a slot left by an older bundle
// armed its sessions against a directive their transcripts may no longer hold,
// so a directive mismatch must start a fresh ledger, not reuse the stale one.
// Tests inject isolated ledgers through the factory parameter instead.
const ARMING_LEDGER_KEY = Symbol.for("omo.ultrawork.arming")

interface SharedArmingSlot {
  readonly directive: string
  readonly arming: SessionArming
}

function isCurrentArmingSlot(value: unknown): value is SharedArmingSlot {
  if (typeof value !== "object" || value === null) {
    return false
  }
  const slot = value as SharedArmingSlot
  // The slot stores the directive TEXT itself, not a hash: string `===` compares
  // by value, so a re-evaluated bundle's fresh constant still matches, while any
  // edit to the directive (or a hash collision between distinct directives, which
  // a 32-bit FNV-1a revision demonstrably allowed) can never reuse stale arming.
  // A bare ledger from a pre-slot bundle has no directive to match, so it is
  // discarded here exactly like a mismatched one.
  return slot.directive === SENPI_ULTRAWORK_DIRECTIVE && typeof slot.arming === "object" && slot.arming !== null
}

export function sharedSessionArming(): SessionArming {
  const registry = globalThis as unknown as Record<symbol, unknown>
  const existing = registry[ARMING_LEDGER_KEY]
  if (isCurrentArmingSlot(existing)) {
    return existing.arming
  }
  const created = createSessionArming()
  const slot: SharedArmingSlot = { directive: SENPI_ULTRAWORK_DIRECTIVE, arming: created }
  registry[ARMING_LEDGER_KEY] = slot
  return created
}

export function createUltraworkComponent(arming: SessionArming = sharedSessionArming()): OmoSenpiComponent {
  return {
    name: "ultrawork",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      pi.on("input", (payload: unknown, eventCtx: unknown): SenpiInputEventResult =>
        handleInput(pi, payload, ctx, arming, sessionIdFromEventCtx(eventCtx)),
      )
      pi.on("session_start", (_payload: unknown, eventCtx: unknown) => {
        arming.trackSession(sessionIdFromEventCtx(eventCtx))
      })
      pi.on("session_before_switch", (_payload: unknown, eventCtx: unknown) => {
        arming.trackSession(sessionIdFromEventCtx(eventCtx))
      })
      pi.on("session_compact", (payload: unknown, eventCtx: unknown) => {
        // A REJECTED compaction leaves the transcript (and the directive) intact;
        // re-arming there would re-inject ~17KB the session still holds.
        if (isRejectedCompaction(payload)) return
        arming.rearmOnCompact(sessionIdFromEventCtx(eventCtx))
      })
    },
  }
}

export function isUltraworkInput(text: string): boolean {
  return ULTRAWORK_CURRENT_PROMPT_PATTERN.test(text)
}

export function armingSnapshot(sessionId: string | undefined): ArmingSnapshot {
  const registry = globalThis as unknown as Record<symbol, unknown>
  const existing = registry[ARMING_LEDGER_KEY]
  if (!isCurrentArmingSlot(existing)) {
    return { wasArmed: false, compactRearmPending: false }
  }
  return snapshotSessionArming(existing.arming, sessionId)
}

export function classifyUltraworkInput(
  input: { readonly text: string; readonly source: SenpiInputEvent["source"] },
  snapshot: ArmingSnapshot,
): UltraworkClassification {
  const matches = [...input.text.matchAll(new RegExp(ULTRAWORK_CURRENT_PROMPT_PATTERN.source, "gi"))]
  let matchedUlw = false
  let matchedUltrawork = false
  for (const match of matches) {
    if (match[0].toLowerCase() === "ulw") {
      matchedUlw = true
    } else {
      matchedUltrawork = true
    }
  }

  const base = {
    matchedUlw,
    matchedUltrawork,
    occurrenceCount: matches.length,
  }

  if (input.source === "extension") {
    return { ...base, effective: false, stage: "none", route: "none", suppressionReason: "extension_source" }
  }

  if (matches.length === 0) {
    return { ...base, effective: false, stage: "none", route: "none", suppressionReason: "no_keyword" }
  }

  if (input.text.includes(ULTRAWORK_MODE_OPEN_TAG) && input.text.includes(ULTRAWORK_MODE_CLOSE_TAG)) {
    return {
      ...base,
      effective: false,
      stage: "none",
      route: "embedded_directive",
      suppressionReason: "embedded_directive",
    }
  }

  let route: UltraworkRoute = "direct"
  if (input.text.startsWith(SKILL_COMMAND_PREFIX)) {
    const spaceIndex = input.text.indexOf(" ")
    const skillName =
      spaceIndex === -1 ? input.text.slice(SKILL_COMMAND_PREFIX.length) : input.text.slice(SKILL_COMMAND_PREFIX.length, spaceIndex)
    if (skillName === ULTRAWORK_SKILL_NAME) {
      return { ...base, effective: false, stage: "none", route: "skill_expansion", suppressionReason: "skill_expansion" }
    }

    const argsStart = spaceIndex === -1 ? input.text.length : spaceIndex + 1
    const matchedInArgs = matches.some((match) => (match.index ?? -1) >= argsStart)
    if (!matchedInArgs) {
      return { ...base, effective: false, stage: "none", route: "none", suppressionReason: "skill_name_only" }
    }
    route = "skill_args"
  }

  const stage: UltraworkInvocationStage = snapshot.compactRearmPending
    ? "post_compact_rearm"
    : snapshot.wasArmed
      ? "remention"
      : "first_arm"
  return { ...base, effective: true, stage, route, suppressionReason: "none" }
}

/**
 * Once-per-session arming ledger. The full directive rides in on a session's FIRST
 * trigger; later triggers in that same session get the short reminder because the
 * transcript already holds every rule. Only an accepted compaction re-arms a
 * session (its transcript loses the directive block there). Switching sessions
 * never re-arms: a session switched back into still holds its directive, and
 * deleting the id on switch would recreate the per-turn accumulation this guards
 * against. Hosts that expose no session id anywhere fall back to one anonymous
 * ledger slot, reset by the same compaction event.
 */
export function createSessionArming(): SessionArming {
  const armedSessionIds = new Set<string>()
  const compactRearmPendingSessionIds = new Set<string>()
  let currentSessionId: string | undefined
  let anonymousArmed = false
  let anonymousCompactRearmPending = false

  return {
    trackSession(sessionId) {
      currentSessionId = sessionId
    },
    currentSessionId() {
      return currentSessionId
    },
    rearmOnCompact(sessionId) {
      const target = sessionId ?? currentSessionId
      if (target === undefined) {
        anonymousArmed = false
        anonymousCompactRearmPending = true
        return
      }
      armedSessionIds.delete(target)
      compactRearmPendingSessionIds.add(target)
    },
    isArmed(sessionId) {
      if (sessionId === undefined) return anonymousArmed
      return armedSessionIds.has(sessionId)
    },
    isCompactRearmPending(sessionId) {
      if (sessionId === undefined) return anonymousCompactRearmPending
      return compactRearmPendingSessionIds.has(sessionId)
    },
    markArmed(sessionId) {
      if (sessionId === undefined) {
        anonymousArmed = true
        anonymousCompactRearmPending = false
        return
      }
      armedSessionIds.add(sessionId)
      compactRearmPendingSessionIds.delete(sessionId)
    },
  }
}

function snapshotSessionArming(arming: SessionArming, sessionId: string | undefined): ArmingSnapshot {
  return {
    wasArmed: arming.isArmed(sessionId),
    compactRearmPending: arming.isCompactRearmPending?.(sessionId) ?? false,
  }
}

function handleInput(
  pi: SenpiExtensionAPI,
  payload: unknown,
  ctx: ComponentContext,
  arming: SessionArming,
  eventSessionId: string | undefined,
): SenpiInputEventResult {
  if (ctx.config.getFlag(ULTRAWORK_DISABLED_FLAG) === true) {
    return { action: "continue" }
  }

  if (!isSenpiInputEvent(payload)) {
    return { action: "continue" }
  }

  if (payload.source === "extension") {
    return { action: "continue" }
  }

  if (!isUltraworkInput(payload.text)) {
    return { action: "continue" }
  }

  // The input event's own ctx names the live session; the lifecycle tracker covers
  // hosts that only expose the id on session events.
  const sessionId = eventSessionId ?? arming.currentSessionId()
  const classification = classifyUltraworkInput(payload, snapshotSessionArming(arming, sessionId))

  // A pasted transcript (or an earlier injection) already carries the directive
  // block; injecting again would duplicate the same ~17KB of rules in one turn.
  // Require the matched tag PAIR: merely mentioning "<ultrawork-mode>" in a
  // question must not silently disarm a legitimate trigger. The paste still counts
  // as arming: the session's context now holds the full directive, so the next
  // plain trigger only needs the reminder.
  if (classification.route === "embedded_directive") {
    arming.markArmed(sessionId)
    return { action: "continue" }
  }

  // `/skill:ultrawork` expansion already inlines the full SKILL.md, whose body
  // IS the directive block, so arming again would duplicate it in one turn. The
  // expansion still counts as arming for the same reason a pasted block does.
  if (classification.route === "skill_expansion") {
    arming.markArmed(sessionId)
    return { action: "continue" }
  }

  if (!classification.effective) {
    return { action: "continue" }
  }

  // Any defined streamingBehavior means senpi will QUEUE this prompt instead of
  // sending it now, which changes how the directive has to travel.
  const isQueued = payload.streamingBehavior !== undefined
  return armUltrawork(pi, payload.text, isQueued, arming, sessionId)
}

/**
 * Arm ultrawork mode.
 *
 * Idle prompts get the directive as a hidden custom message: senpi converts custom
 * messages into `role: "user"` context (core/messages.ts `convertToLlm`) so the model
 * still receives every rule, while `display: false` keeps the TUI from rendering ~17KB
 * of directive above what the user actually typed (interactive-mode renders
 * `case "custom"` only when `message.display`). `sendCustomMessage` appends
 * synchronously on that path, so the directive lands ahead of the user message this
 * very `input` event is still gating. The typed text stays byte-identical, so senpi's
 * native `/skill:` expansion cannot be disturbed by this hook.
 *
 * A QUEUED prompt cannot use that route. Senpi drains its steering and follow-up
 * queues one message at a time by default (`PendingMessageQueue` in agent.ts, and
 * `getFollowUpMode()` defaulting to "one-at-a-time") and runs an assistant turn per
 * drained message, so a separate hidden message would be answered on its own turn
 * before the user's actual ask arrived. Keep the pair atomic by carrying the directive
 * inside that one queued message instead. Appending rather than prepending is what
 * preserves `/skill:` expansion, which only fires while the text still STARTS with the
 * command.
 */
function armUltrawork(
  pi: SenpiExtensionAPI,
  text: string,
  isQueued: boolean,
  arming: SessionArming,
  sessionId: string | undefined,
): SenpiInputEventResult {
  // An armed session's transcript already holds the full directive; the short
  // reminder re-points the model at that block without re-paying ~17KB per trigger.
  const content = arming.isArmed(sessionId) ? ULTRAWORK_REMINDER : SENPI_ULTRAWORK_DIRECTIVE
  arming.markArmed(sessionId)

  if (isQueued) {
    return { action: "transform", text: `${text}\n${content}` }
  }

  pi.sendMessage({
    customType: ULTRAWORK_CUSTOM_TYPE,
    content,
    display: false,
  })

  return { action: "continue" }
}

function isSessionEventContext(value: unknown): value is SessionEventContext {
  return typeof value === "object" && value !== null
}

function sessionIdFromEventCtx(value: unknown): string | undefined {
  if (!isSessionEventContext(value)) {
    return undefined
  }
  const sessionManager = value.sessionManager
  if (sessionManager === undefined || typeof sessionManager.getSessionId !== "function") {
    return undefined
  }
  const sessionId = sessionManager.getSessionId()
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined
}

function isRejectedCompaction(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && "accepted" in payload && payload.accepted === false
}

function isSenpiInputEvent(value: unknown): value is SenpiInputEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>
  if (candidate["type"] !== "input") {
    return false
  }

  if (typeof candidate["text"] !== "string" || candidate["text"].length === 0) {
    return false
  }

  return candidate["source"] === "interactive" || candidate["source"] === "rpc" || candidate["source"] === "extension"
}

// The closed set of mechanical rule gates (Design record "Mechanical gate set").
//
// A rule whose meaning fits one of these ids is `mechanical`: code enforces it (todo 9) and its
// structured parts live in `params`. Anything else is `behavioral` prose. The set is closed on
// purpose: a rule file naming any other gate id is rejected by the parser, never ignored.

export const GATE_IDS = [
  "language",
  "link_label",
  "mention_requester",
  "status_sync",
  "progress_edit",
  "typing_while_writing",
  "image_viewport",
  "bot_ignore",
  "one_request_one_thread",
  "work_item_header",
  "numbered_options",
  "decision_nag",
  "topic_scope",
  "reply_language_follows_user",
  "session_unit",
] as const

export type GateId = (typeof GATE_IDS)[number]

export type GateParams = Readonly<Record<string, unknown>>

const GATE_ID_SET: ReadonlySet<string> = new Set(GATE_IDS)

export function isGateId(value: unknown): value is GateId {
  return typeof value === "string" && GATE_ID_SET.has(value)
}

/**
 * Gates whose params are a map resolved key by key: for each key, the most specific rule that
 * sets it wins (a thread rule may change only `slack` while the scope-wide rule keeps `telegram`).
 * Every other gate resolves as a whole params object.
 */
export const PER_KEY_GATES: ReadonlySet<GateId> = new Set<GateId>(["session_unit"])

/** What one session is on each surface (`session_unit` gate); the router derives binding keys from it. */
export const SESSION_UNIT_OPTIONS = {
  slack: ["thread", "chat"],
  discord: ["thread", "chat"],
  telegram: ["topic", "chat"],
  notion: ["discussion", "page"],
  feishu: ["thread", "chat"],
  github: ["issue"],
  dm: ["dm_thread", "dm"],
} as const satisfies Record<string, readonly string[]>

export type SessionUnitPlatform = keyof typeof SESSION_UNIT_OPTIONS

export const SESSION_UNIT_DEFAULTS: Readonly<Record<SessionUnitPlatform, string>> = {
  slack: "thread",
  discord: "thread",
  telegram: "topic",
  notion: "discussion",
  feishu: "thread",
  github: "issue",
  dm: "dm_thread",
}

export function isSessionUnitPlatform(value: string): value is SessionUnitPlatform {
  return Object.hasOwn(SESSION_UNIT_OPTIONS, value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function describeGateParamsViolation(gate: GateId, params: unknown): string | null {
  if (!isPlainObject(params)) return `params for gate '${gate}' must be a map`
  if (gate === "language") {
    const allow = params.allow
    if (!Array.isArray(allow) || allow.length === 0 || !allow.every((tag) => typeof tag === "string" && tag.length > 0)) {
      return "params.allow for gate 'language' must be a non-empty list of language tags"
    }
    return null
  }
  if (gate === "session_unit") {
    const entries = Object.entries(params)
    if (entries.length === 0) return "params for gate 'session_unit' must name at least one platform"
    for (const [platform, unit] of entries) {
      if (!isSessionUnitPlatform(platform)) {
        return `unknown session_unit platform '${platform}' (known: ${Object.keys(SESSION_UNIT_OPTIONS).join(", ")})`
      }
      const options: readonly string[] = SESSION_UNIT_OPTIONS[platform]
      if (typeof unit !== "string" || !options.includes(unit)) {
        return `session_unit '${platform}' must be one of ${options.join(", ")}`
      }
    }
  }
  return null
}

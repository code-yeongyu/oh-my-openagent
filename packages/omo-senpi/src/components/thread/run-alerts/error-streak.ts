import { completionOutcome, type AgentEndFacts } from "../gateway/completion"

export type RunErrorClass = "rate_limit" | "auth" | "overloaded" | "network" | "unknown"

export type RunEnd =
  | {
      readonly kind: "error"
      readonly errorClass: RunErrorClass
      readonly provider?: string
      readonly model?: string
    }
  | { readonly kind: "aborted" }
  | { readonly kind: "completed" }

type StreakFacts = {
  readonly session_id: string
  readonly count: number
  readonly classes: Readonly<Partial<Record<RunErrorClass, number>>>
  readonly aborted: number
  readonly first_at: number
  readonly last_at: number
}

export type ErrorStreakEvent =
  | (StreakFacts & {
      readonly event: "error_streak"
      readonly provider?: string
      readonly model?: string
      readonly repeat: boolean
    })
  | (StreakFacts & { readonly event: "error_streak_recovered"; readonly recovered_at: number })

const ERROR_CLASS_PATTERNS: readonly (readonly [RunErrorClass, RegExp])[] = [
  ["rate_limit", /rate.?limit|\b429\b|too many requests|usage.?limit|quota/i],
  ["auth", /\b40[13]\b|unauthori[sz]ed|forbidden|authenticat|api.?key|credential|permission/i],
  ["overloaded", /overloaded|\b5(?:29|03)\b|unavailable|capacity/i],
  [
    "network",
    /fetch failed|network|socket hang up|timed? ?out|\bE(?:CONNRESET|CONNREFUSED|TIMEDOUT|NOTFOUND|AI_AGAIN|PIPE)\b/i,
  ],
]

/** The class of a provider error; the error text itself never leaves this function. */
export function classifyRunError(errorMessage: unknown): RunErrorClass {
  if (typeof errorMessage !== "string") return "unknown"
  return ERROR_CLASS_PATTERNS.find(([, pattern]) => pattern.test(errorMessage))?.[0] ?? "unknown"
}

export function runEndOf(event: AgentEndFacts): RunEnd {
  const outcome = completionOutcome(event)
  if (outcome === "cancelled") return { kind: "aborted" }
  if (outcome === "completed") return { kind: "completed" }
  const last = [...(event.messages ?? [])]
    .reverse()
    .find((message) => (message as { readonly role?: unknown } | null)?.role === "assistant") as
    { readonly errorMessage?: unknown; readonly provider?: unknown; readonly model?: unknown } | undefined
  return {
    kind: "error",
    errorClass: classifyRunError(last?.errorMessage),
    ...(typeof last?.provider === "string" ? { provider: last.provider } : {}),
    ...(typeof last?.model === "string" ? { model: last.model } : {}),
  }
}

type Streak = {
  count: number
  classes: Partial<Record<RunErrorClass, number>>
  aborted: number
  firstAt: number
  lastAt: number
  provider: string | undefined
  model: string | undefined
  alertedAt: number | undefined
}

export type ErrorStreakDetectorOptions = {
  readonly threshold: number
  /** 0: no still-failing alert. */
  readonly realertMs: number
  readonly now: () => number
}

/**
 * Counts each session's consecutive runs that ended with an error (#14430). The `threshold`-th sends one alert; while the
 * streak lasts, the first error at least `realertMs` after the last alert sends a still-failing one; the first normal
 * run after an alerted streak sends one recovered notice. An aborted run neither counts, alerts nor ends a streak.
 * Only a session with an open streak holds state.
 */
export function createErrorStreakDetector(options: ErrorStreakDetectorOptions) {
  const streaks = new Map<string, Streak>()

  const facts = (sessionId: string, streak: Streak): StreakFacts => ({
    session_id: sessionId,
    count: streak.count,
    classes: { ...streak.classes },
    aborted: streak.aborted,
    first_at: streak.firstAt,
    last_at: streak.lastAt,
  })

  return {
    observe(sessionId: string, end: RunEnd): ErrorStreakEvent | undefined {
      const streak = streaks.get(sessionId)
      if (end.kind === "aborted") {
        if (streak !== undefined) streak.aborted++
        return undefined
      }
      if (end.kind === "completed") {
        streaks.delete(sessionId)
        if (streak?.alertedAt === undefined) return undefined
        return { event: "error_streak_recovered", ...facts(sessionId, streak), recovered_at: options.now() }
      }
      const at = options.now()
      const current: Streak = streak ?? {
        count: 0,
        classes: {},
        aborted: 0,
        firstAt: at,
        lastAt: at,
        provider: undefined,
        model: undefined,
        alertedAt: undefined,
      }
      current.count++
      current.classes[end.errorClass] = (current.classes[end.errorClass] ?? 0) + 1
      current.lastAt = at
      current.provider = end.provider ?? current.provider
      current.model = end.model ?? current.model
      streaks.set(sessionId, current)
      if (current.count < options.threshold) return undefined
      const repeat = current.alertedAt !== undefined
      if (repeat && (options.realertMs <= 0 || at - (current.alertedAt ?? at) < options.realertMs)) return undefined
      current.alertedAt = at
      return {
        event: "error_streak",
        ...facts(sessionId, current),
        ...(current.provider === undefined ? {} : { provider: current.provider }),
        ...(current.model === undefined ? {} : { model: current.model }),
        repeat,
      }
    },
  }
}

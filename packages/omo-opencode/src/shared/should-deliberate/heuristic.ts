// Conservative, lexical heuristic detecting whether a user message warrants
// formal deliberation via Themis. Contract: docs/adr/003-themis-auto-trigger.md.
// Caller routes trigger to /deliberate or task(subagent_type="themis", ...).

export interface ShouldDeliberateContext {
  /** When false, short-circuit to `trigger: false`. Default: true. */
  enabled?: boolean
}

export interface ShouldDeliberateResult {
  trigger: boolean
  reason: string
}

const VERSUS_PATTERN = /\b(?:vs\.?|versus)\b/i

const OPTION_OR_PATTERN = /\b[a-z][a-z0-9_.+#-]{1,30}\s+or\s+[a-z][a-z0-9_.+#-]{1,30}\b/i

const CONSTRAINT_PAIRS: ReadonlyArray<readonly [RegExp, RegExp, string]> = [
  [/\bcost\b/i, /\bquality\b/i, "cost vs quality"],
  [/\bspeed|fast(?:er)?\b/i, /\bsafe(?:ty)?\b/i, "speed vs safety"],
  [/\blatency\b/i, /\baccuracy\b/i, "latency vs accuracy"],
  [/\bprice\b/i, /\bperformance\b/i, "price vs performance"],
  [/\bscope\b/i, /\bdeadline\b/i, "scope vs deadline"],
  [/\bfeature(?:s)?\b/i, /\bstability\b/i, "feature vs stability"],
  [/\bshort.?term\b/i, /\blong.?term\b/i, "short-term vs long-term"],
  [/\bsimplicity|simple\b/i, /\bpower(?:ful)?\b/i, "simplicity vs power"],
]

const ETHICS_MARKERS =
  /\b(ethics|ethical|is it ok to|should we even|safety|harm|catastrophic|irreversible|risk of)\b/i

const IMPLEMENTATION_VERB =
  /^\s*(?:fix|add|implement|update|change|write|create|delete|remove|refactor)\b/i

/**
 * Detect competing-options signal.
 *
 * Two shapes accepted:
 * - explicit `vs` / `versus` between named candidates
 * - `<word> or <word>?` in a question shorter than 200 chars
 *   AND the message is not a clear implementation request
 */
function detectCompetingOptions(message: string): string | null {
  if (VERSUS_PATTERN.test(message)) {
    return "competing-options(versus marker)"
  }
  const isQuestion = message.includes("?")
  const isImpl = IMPLEMENTATION_VERB.test(message)
  if (isQuestion && !isImpl && OPTION_OR_PATTERN.test(message) && message.length < 200) {
    return "competing-options(option-or-option question)"
  }
  return null
}

/**
 * Detect conflicting-constraints signal.
 *
 * Returns the pair label when both halves of a documented antagonistic
 * pair appear in the message.
 */
function detectConflictingConstraints(message: string): string | null {
  for (const [a, b, label] of CONSTRAINT_PAIRS) {
    if (a.test(message) && b.test(message)) {
      return `conflicting-constraints(${label})`
    }
  }
  return null
}

/**
 * Detect ethical / safety / risk signal combined with an option marker.
 */
function detectEthicsWithOptions(message: string): string | null {
  if (!ETHICS_MARKERS.test(message)) return null
  if (VERSUS_PATTERN.test(message) || OPTION_OR_PATTERN.test(message)) {
    return "ethical-safety-risk(option marker present)"
  }
  return null
}

export function shouldDeliberate(
  userMessage: string,
  context?: ShouldDeliberateContext,
): ShouldDeliberateResult {
  if (context?.enabled === false) {
    return { trigger: false, reason: "auto-trigger disabled" }
  }
  if (!userMessage || !userMessage.trim()) {
    return { trigger: false, reason: "empty message" }
  }

  const ethicsSignal = detectEthicsWithOptions(userMessage)
  if (ethicsSignal) {
    return { trigger: true, reason: ethicsSignal }
  }

  const optionsSignal = detectCompetingOptions(userMessage)
  if (optionsSignal) {
    return { trigger: true, reason: optionsSignal }
  }

  const constraintSignal = detectConflictingConstraints(userMessage)
  if (constraintSignal) {
    return { trigger: true, reason: constraintSignal }
  }

  return { trigger: false, reason: "no deliberation signals detected" }
}

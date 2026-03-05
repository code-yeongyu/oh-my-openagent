/**
 * Correction detection patterns.
 *
 * CK's pushback signals (from his own description):
 * - "this is wrong"
 * - impatience/annoyance in tone
 * - "this is not what I want"
 * - "you didn't understand my request"
 *
 * Each pattern has a severity:
 * - "hard": Explicit rejection ("this is wrong", "no", "redo")
 * - "soft": Frustration signal ("not what I want", "you didn't understand")
 *
 * Hard corrections dock trust more than soft ones.
 */

export const HOOK_NAME = "correction-detector"

export interface CorrectionPattern {
  pattern: RegExp
  severity: "hard" | "soft"
  label: string
}

export const CORRECTION_PATTERNS: CorrectionPattern[] = [
  // Hard corrections — explicit rejection
  {
    pattern: /\b(this is wrong|that's wrong|that is wrong|you('re| are) wrong)\b/i,
    severity: "hard",
    label: "explicit_wrong",
  },
  {
    pattern: /\b(no[,.]?\s+(that's not|that isn't|this isn't|this is not)\s+(right|correct|what))/i,
    severity: "hard",
    label: "explicit_no",
  },
  {
    pattern: /\b(redo (this|that|it)|do (this|that|it) again|start over|try again)\b/i,
    severity: "hard",
    label: "explicit_redo",
  },
  {
    pattern: /\b(completely wrong|totally wrong|way off|miss(ed|ing) the (point|mark))\b/i,
    severity: "hard",
    label: "strong_rejection",
  },
  {
    pattern: /\b(revert|undo|roll\s?back|back out)\b/i,
    severity: "hard",
    label: "revert_request",
  },

  // Soft corrections — frustration / misunderstanding signals
  {
    pattern: /\b((this|that) is not what I (want|asked|meant|need))/i,
    severity: "soft",
    label: "not_what_wanted",
  },
  {
    pattern: /\b(you didn't understand|you misunderstood|you('re| are) not (listening|understanding|getting))/i,
    severity: "soft",
    label: "misunderstanding",
  },
  {
    pattern: /\b(I (already|just) (said|told|explained|asked))\b/i,
    severity: "soft",
    label: "impatience_repeat",
  },
  {
    pattern: /\b(raise your standards|think harder|don't bring me garbage)\b/i,
    severity: "soft",
    label: "standards_trigger",
  },
  {
    pattern: /\b(not useful|useless|waste of time|doesn't help|didn't help)\b/i,
    severity: "soft",
    label: "low_value",
  },
  {
    pattern: /\b(I('ll| will) (just )?do it myself)\b/i,
    severity: "soft",
    label: "giving_up_on_agent",
  },
]

/**
 * Minimum message length to scan.
 * Very short messages (< 5 chars) are likely "ok", "yes", "no" — not corrections.
 * But "no" itself could be a correction, so we set this low.
 */
export const MIN_MESSAGE_LENGTH = 2

/**
 * Trust score dock per severity level.
 * These values are written into the correction event for the trust scorer to read.
 */
export const SEVERITY_WEIGHTS: Record<string, number> = {
  hard: 1.0,
  soft: 0.5,
}

/**
 * Path to system events file where correction events are emitted.
 */
export const SYSTEM_EVENTS_PATH = "AI/_state/system-events.jsonl"

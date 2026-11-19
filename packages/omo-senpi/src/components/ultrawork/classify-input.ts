import type { SessionRole } from "@oh-my-opencode/senpi-task"

import {
  maskNegatedInvocations,
  NOT_AFTER_IDENTIFIER,
  NOT_BEFORE_PATH,
  NOT_INTO_IDENTIFIER,
  stripQuotedRegions,
  stripQuotedSpans,
} from "../skill-pointers/strip-quoted-regions"
import type { ArmingSnapshot } from "./session-arming"

export type InputSource = "interactive" | "rpc" | "extension"

// The keyword arms only as a word of its own: "ulw", "ulw loop", a leading "ulw-loop" or "ulw-plan." do;
// "ulwfoo", "ulw_helper", "mass-ulw-refactor", "ulw-plan.md" and ".omo/ulw/" do not (#9738). Quoted,
// injected, relayed and negated regions are blanked before this pattern runs.
const ULTRAWORK_KEYWORD = /\b(?:ultrawork|ulw)\b/i
const ULTRAWORK_CURRENT_PROMPT_PATTERN = new RegExp(
  String.raw`${NOT_AFTER_IDENTIFIER}\b(?:ultrawork|ulw)\b${NOT_INTO_IDENTIFIER}${NOT_BEFORE_PATH}`,
  "i",
)
const ULTRAWORK_MODE_OPEN_TAG = "<ultrawork-mode>"
const ULTRAWORK_MODE_CLOSE_TAG = "</ultrawork-mode>"
const SKILL_COMMAND_PREFIX = "/skill:"
const ULTRAWORK_SKILL_NAME = "ultrawork"

export type UltraworkInvocationStage = "none" | "first_arm" | "remention" | "post_compact_rearm"
export type UltraworkRoute = "none" | "direct" | "skill_args" | "skill_expansion" | "embedded_directive"
export type UltraworkSuppressionReason =
  | "none"
  | "extension_source"
  | "child_session"
  | "no_keyword"
  | "identifier_reference"
  | "negated_mention"
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

export function isUltraworkInput(text: string): boolean {
  return ULTRAWORK_CURRENT_PROMPT_PATTERN.test(stripQuotedRegions(text))
}

export function classifyUltraworkInput(
  input: { readonly text: string; readonly source: InputSource; readonly sessionRole?: SessionRole },
  snapshot: ArmingSnapshot,
): UltraworkClassification {
  const quotedText = stripQuotedSpans(input.text)
  const visibleText = maskNegatedInvocations(quotedText)
  const matches = [...visibleText.matchAll(new RegExp(ULTRAWORK_CURRENT_PROMPT_PATTERN.source, "gi"))]
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

  if (input.sessionRole !== undefined) {
    return { ...base, effective: false, stage: "none", route: "none", suppressionReason: "child_session" }
  }

  if (input.source === "extension") {
    return { ...base, effective: false, stage: "none", route: "none", suppressionReason: "extension_source" }
  }

  if (matches.length === 0) {
    const suppressionReason = ULTRAWORK_KEYWORD.test(visibleText)
      ? "identifier_reference"
      : ULTRAWORK_KEYWORD.test(quotedText)
        ? "negated_mention"
        : "no_keyword"
    return { ...base, effective: false, stage: "none", route: "none", suppressionReason }
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
      spaceIndex === -1
        ? input.text.slice(SKILL_COMMAND_PREFIX.length)
        : input.text.slice(SKILL_COMMAND_PREFIX.length, spaceIndex)
    if (skillName === ULTRAWORK_SKILL_NAME) {
      return {
        ...base,
        effective: false,
        stage: "none",
        route: "skill_expansion",
        suppressionReason: "skill_expansion",
      }
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

import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { Type, type Static } from "typebox"

import { containsSecretLikeMaterial, isValidHint, type RecallNudge } from "@oh-my-opencode/memory-core"

export const KIBITZER_NUDGE_TOOL_NAME = "nudge"

const KIBITZER_NUDGE_DESCRIPTION =
  "Surface one stored memory to the primary agent as a read-only hint. Call it only when the memory would change what the agent does next."

export const KibitzerNudgeParams = Type.Object({
  path: Type.String({ description: "Memory path copied exactly from the candidates input." }),
  hint: Type.String({ description: "One factual sentence carrying the useful information from the memory, at most 200 characters, on a single line. State the fact itself, not a judgment about whether to nudge, and never filler such as 'placeholder'." }),
}, { additionalProperties: false })

export interface KibitzerNudgeToolInput {
  /** Paths offered this launch; anything else is fabricated. */
  readonly candidates: ReadonlySet<string>
  /** Paths already surfaced in this session; they never repeat. */
  readonly surfaced: ReadonlySet<string>
  /** Authoritative cap (memory.recall.max_items) for THIS run's accepted nudges. */
  readonly maxItems: number
  /** The array the runner owns: every accepted nudge is recorded here, in call order. */
  readonly accepted: RecallNudge[]
}

// The agent loop honors an inline `isError` on the returned result (senpi builtin tool convention);
// the base AgentToolResult type does not declare it, so it is intersected on here. `terminate` is
// the loop's own early-termination hint (pi-agent-core AgentToolResult).
export type KibitzerNudgeToolResult = AgentToolResult<undefined> & { readonly isError?: boolean }

export type KibitzerNudgeTool = Omit<
  ToolDefinition<typeof KibitzerNudgeParams, undefined>,
  "execute" | "renderCall" | "renderResult"
> & {
  readonly execute: (
    toolCallId: string,
    params: Static<typeof KibitzerNudgeParams>,
  ) => Promise<KibitzerNudgeToolResult>
}

/**
 * The kibitzer judge's ONLY output channel, as an in-process closure over the launch input: the
 * same contract the old `-e` nudge extension enforced in the spawned child, but validated against
 * the live launch state synchronously at call time so a rejected call returns an error result the
 * judge can read and correct. Hint-shape rules come from memory-core's `isValidHint`; candidate
 * and surfaced membership mirror `validateNudges`, which the parent still runs over the collected
 * set before persisting (defence in depth - duplicates, should the judge repeat a path, are
 * dropped there, not here).
 *
 * Once `accepted` reaches `maxItems` nothing more can be recorded this run, so the result carries
 * `terminate: true` and the agent loop ends the turn on the tool batch. Without it the judge has to
 * produce one more assistant message with nothing to say, and senpi's empty-assistant recovery
 * settles a second silent stop as an error (issue #7963).
 */
export function createKibitzerNudgeTool(input: KibitzerNudgeToolInput): KibitzerNudgeTool {
  return {
    name: KIBITZER_NUDGE_TOOL_NAME,
    label: "Kibitzer",
    description: KIBITZER_NUDGE_DESCRIPTION,
    parameters: KibitzerNudgeParams,
    execute: async (_toolCallId, params) => {
      const rejection = rejectNudge(params, input)
      if (rejection !== undefined) {
        return {
          content: [{ type: "text", text: `Nudge rejected: ${rejection} Correct the call once, or end the run.` }],
          details: undefined,
          isError: true,
          ...capReached(input),
        }
      }
      input.accepted.push({ path: params.path, hint: params.hint })
      const capped = capReached(input)
      return {
        content: [{ type: "text", text: capped.terminate === true
          ? `Nudge recorded for ${params.path}. The maxItems limit (${input.maxItems}) is reached; the run ends here.`
          : `Nudge recorded for ${params.path}.` }],
        details: undefined,
        ...capped,
      }
    },
  }
}

function capReached(input: KibitzerNudgeToolInput): { readonly terminate?: true } {
  return input.accepted.length >= input.maxItems ? { terminate: true } : {}
}

function rejectNudge(params: Static<typeof KibitzerNudgeParams>, input: KibitzerNudgeToolInput): string | undefined {
  if (!input.candidates.has(params.path)) {
    return `"${params.path}" is not one of the offered candidates.`
  }
  if (input.surfaced.has(params.path)) {
    return `"${params.path}" was already surfaced in this session.`
  }
  if (params.path === "system/" || params.path.startsWith("system/")) {
    return `"${params.path}" is a system/ path and cannot be nudged.`
  }
  if (!isValidHint(params.hint)) {
    return "The hint must state a memory fact in one non-empty line of at most 200 characters, not comment on whether the memory is relevant or worth nudging."
  }
  if (containsSecretLikeMaterial(params.hint)) {
    return "The hint was rejected because it contains secret-like material."
  }
  if (input.accepted.length >= input.maxItems) {
    return `The maxItems limit (${input.maxItems}) for this run has been reached.`
  }
  return undefined
}

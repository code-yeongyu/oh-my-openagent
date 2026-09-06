import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { Type, type Static } from "typebox"

import { containsSecretLikeMaterial, isValidHint, type RecallNudge } from "@oh-my-opencode/memory-core"

export const MEMORIAN_NUDGE_TOOL_NAME = "nudge"

const MEMORIAN_NUDGE_DESCRIPTION =
  "Surface one stored memory to the primary agent as a read-only hint. Call it only when the memory would change what the agent does next."

export const MemorianNudgeParams = Type.Object({
  path: Type.String({ description: "Memory path copied exactly from the candidates input." }),
  hint: Type.String({ description: "One factual sentence, at most 200 characters, on a single line." }),
}, { additionalProperties: false })

export interface MemorianNudgeToolInput {
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
// the base AgentToolResult type does not declare it, so it is intersected on here.
export type MemorianNudgeToolResult = AgentToolResult<undefined> & { readonly isError?: boolean }

export type MemorianNudgeTool = Omit<
  ToolDefinition<typeof MemorianNudgeParams, undefined>,
  "execute" | "renderCall" | "renderResult"
> & {
  readonly execute: (
    toolCallId: string,
    params: Static<typeof MemorianNudgeParams>,
  ) => Promise<MemorianNudgeToolResult>
}

/**
 * The memorian judge's ONLY output channel, as an in-process closure over the launch input: the
 * same contract the old `-e` nudge extension enforced in the spawned child, but validated against
 * the live launch state synchronously at call time so a rejected call returns an error result the
 * judge can read and correct. Hint-shape rules come from memory-core's `isValidHint`; candidate
 * and surfaced membership mirror `validateNudges`, which the parent still runs over the collected
 * set before persisting (defence in depth - duplicates, should the judge repeat a path, are
 * dropped there, not here).
 */
export function createMemorianNudgeTool(input: MemorianNudgeToolInput): MemorianNudgeTool {
  return {
    name: MEMORIAN_NUDGE_TOOL_NAME,
    label: "Nudge",
    description: MEMORIAN_NUDGE_DESCRIPTION,
    parameters: MemorianNudgeParams,
    execute: async (_toolCallId, params) => {
      const rejection = rejectNudge(params, input)
      if (rejection !== undefined) {
        return {
          content: [{ type: "text", text: `Nudge rejected: ${rejection} Correct the call once, or end the run.` }],
          details: undefined,
          isError: true,
        }
      }
      input.accepted.push({ path: params.path, hint: params.hint })
      return {
        content: [{ type: "text", text: `Nudge recorded for ${params.path}.` }],
        details: undefined,
      }
    },
  }
}

function rejectNudge(params: Static<typeof MemorianNudgeParams>, input: MemorianNudgeToolInput): string | undefined {
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
    return "The hint must be one non-empty line of at most 200 characters."
  }
  if (containsSecretLikeMaterial(params.hint)) {
    return "The hint was rejected because it contains secret-like material."
  }
  if (input.accepted.length >= input.maxItems) {
    return `The maxItems limit (${input.maxItems}) for this run has been reached.`
  }
  return undefined
}

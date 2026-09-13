// The config boundary of the resident Kibitzer: `memory.recall` (root, layer and per-agent override
// already merged by `resolveAgentRecallSettings`) becomes the values the sidecar, its child starter
// and the machine-wide wake slot consume. Nothing here has a default of its own - the schema owns
// the defaults, and the sidecar's fallback constants exist only for callers that bypass config.

import type { OmoMemoryRecall } from "@oh-my-opencode/omo-config-core"

import type { KibitzerEventCaps } from "./events"

export interface KibitzerSidecarSettings {
  /** `memory.recall.category`: the category the child is pinned to. */
  readonly category: string
  /** `memory.recall.tool_budget`: child tool calls one wake may spend. */
  readonly toolBudget: number
  /** `memory.recall.sidecar_max_tokens`: the context window the 60% reseed threshold is taken from. */
  readonly sidecarMaxTokens: number
  /** `memory.recall.max_concurrent_wakes`: machine-wide concurrent wake leases. */
  readonly maxConcurrentWakes: number
  /** `memory.recall.event_caps`: per-event character caps of the event stream. */
  readonly eventCaps: KibitzerEventCaps
}

export function resolveKibitzerSidecarSettings(recall: OmoMemoryRecall): KibitzerSidecarSettings {
  return {
    category: recall.category,
    toolBudget: recall.tool_budget,
    sidecarMaxTokens: recall.sidecar_max_tokens,
    maxConcurrentWakes: recall.max_concurrent_wakes,
    eventCaps: {
      toolArgs: recall.event_caps.tool_args,
      resultHead: recall.event_caps.result_head,
      assistant: recall.event_caps.assistant,
      prompt: recall.event_caps.prompt,
    },
  }
}

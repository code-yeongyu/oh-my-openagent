import { describe, expect, test } from "bun:test"

import { createTaskRecord, type ResolvedModelRecord, type TaskRecord } from "../state"
import { MODEL_NOT_FOUND_ANSWERS, NOT_MODEL_NOT_FOUND_ANSWERS } from "./__fixtures__/model-not-found-inventory"
import { runtimeFallbackCandidates, terminalFailureMessage } from "./credential-failure"
import { refusalOf } from "./model-refusals"

function rung(provider: string, modelId: string): ResolvedModelRecord {
  return { source: "category", provider, model_id: modelId, display: `${provider}/${modelId}` }
}

const PRIMARY = rung("opencode-go", "faux-1")
const SIBLING = rung("opencode-go", "minimax-m2.7")
const OTHER = rung("zai", "glm-5.3")

function record(fallbacks: readonly ResolvedModelRecord[]): TaskRecord {
  return createTaskRecord({
    category: "quick",
    parent_session_id: "session-parent",
    root_session_id: "session-root",
    depth: 1,
    execution_mode: "in-process",
    notify_on_terminal: false,
    model: PRIMARY.display,
    requested_model: PRIMARY,
    resolved_model: PRIMARY,
    fallback_models: [...fallbacks],
  })
}

describe("a model its route does not serve (#11355)", () => {
  test.each(MODEL_NOT_FOUND_ANSWERS)("#given %s #when the refusal is classified #then its reason is model_not_found", (_label, message) => {
    expect(refusalOf(record([]), message, "2026-11-01T00:00:00.000Z").reason).toBe("model_not_found")
  })

  test.each(MODEL_NOT_FOUND_ANSWERS)("#given %s #when the candidates are computed #then the rest of the designated chain is walked in order, the same-provider sibling included", (_label, message) => {
    expect(runtimeFallbackCandidates(record([SIBLING, OTHER]), message)).toEqual({ remaining: [SIBLING, OTHER], skipped: [] })
  })

  test.each(MODEL_NOT_FOUND_ANSWERS)("#given %s #when the terminal message is built #then it is the provider's answer, not a credential or usage-limit hint", (_label, message) => {
    expect(terminalFailureMessage(record([]), message)).toBe(message)
  })

  test.each(NOT_MODEL_NOT_FOUND_ANSWERS)("#given %s #when the refusal is classified #then it is not model_not_found", (_label, message) => {
    expect(refusalOf(record([]), message, "2026-11-01T00:00:00.000Z").reason).not.toBe("model_not_found")
  })
})

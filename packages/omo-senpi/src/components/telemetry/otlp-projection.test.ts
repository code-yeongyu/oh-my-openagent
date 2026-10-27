import { expect, test } from "bun:test"
import { isOtlpEvent, projectOtlpEvent, OTLP_SPANS } from "./otlp-projection"

// Independent examples from omo-telemetry's pinned omo-senpi v4 artifact.
for (const [event, property, wire] of [
  ["category_config", "cat_architect", "omo.cat_architect"],
  ["computer_use_activation", "active", "omo.active"],
  ["computer_use_engine_error", "code", "omo.code"],
  ["computer_use_permission_denied", "permission", "omo.permission"],
  ["daily_active", "day_utc", "omo.day_utc"],
  ["delegation_completed", "task_seq", "omo.task_seq"],
  ["delegation_started", "background", "omo.background"],
  ["feature_used", "feature", "omo.feature"],
  ["handoff_hint", "action", "omo.action"],
  ["kibitzer_summary", "wakes_total", "omo.wakes_total"],
  ["parallelism_summary", "schema_kind", "omo.schema_kind"],
  ["process_crashed", "exit_code", "process.exit.code"],
  ["prompt_submitted", "is_real_user_prompt", "omo.prompt.is_real_user"],
  ["session_started", "session_role", "omo.session.role"],
  ["session_summary", "session_role", "omo.session.role"],
  ["skill_loaded", "skill_name", "omo.skill_name"],
  ["turn_completed", "turn_index", "omo.turn.index"],
] as const) {
  test(`OTLP projection pins ${event} and drops unlisted attributes`, () => {
    expect(isOtlpEvent(event)).toBe(true)
    expect(projectOtlpEvent(event, { [property]: 1, $session_id: "hash", unknown: "private", prompt_text: "private" })).toEqual({
      [wire]: 1,
      ...(event === "process_crashed" ? {} : { "session.id": "hash" }),
    })
  })
}

test("OTLP drops events not present in the pinned artifact", () => {
  expect(isOtlpEvent("omo_senpi_daily_active")).toBe(false)
  expect(projectOtlpEvent("omo_senpi_daily_active", { reason: "session_start", $session_id: "hash" })).toEqual({})
})

test("OTLP turn projection includes cache tokens in input and maps cost and provider", () => {
  expect(projectOtlpEvent("turn_completed", {
    input_tokens: 10, cache_read_tokens: 20, cache_write_tokens: 30,
    output_tokens: 5, reasoning_tokens: 2, total_tokens: 65,
    cost_1e4: 123, cost_usd: 0.0123, provider: "google",
    request_model_id: "gemini-3.1-pro", response_model_id: "gemini-3.1-pro",
  })).toEqual({
    "gen_ai.usage.input_tokens": 60,
    "gen_ai.usage.cache_read.input_tokens": 20,
    "gen_ai.usage.cache_creation.input_tokens": 30,
    "gen_ai.usage.output_tokens": 5,
    "gen_ai.usage.reasoning.output_tokens": 2,
    "omo.usage.total_tokens": 65,
    "omo.cost.usd_1e4": 123,
    "omo.provider": "google",
    "gen_ai.provider.name": "gcp.gemini",
    "gen_ai.request.model": "gemini-3.1-pro",
    "gen_ai.response.model": "gemini-3.1-pro",
  })
})

test("OTLP summary cost uses the pinned integer cost field and excludes non-finite attributes", () => {
  expect(projectOtlpEvent("session_summary", { cost_1e4: 50, turns: NaN })).toEqual({ "omo.cost.usd_1e4": 50 })
})

test("OTLP spans allow only the pinned turn attributes", () => {
  expect(OTLP_SPANS).toEqual({
    "omo.turn": [
      "gen_ai.operation.name", "gen_ai.provider.name", "gen_ai.request.model", "gen_ai.response.model",
      "omo.model_id", "omo.provider", "omo.session.role", "omo.turn.index", "session.id",
    ],
  })
})

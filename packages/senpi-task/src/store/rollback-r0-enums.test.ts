import { describe, expect, test } from "bun:test"
import { IsolationBackendKindSchema } from "@oh-my-opencode/omo-config-core"
import {
  BACKGROUND_MODES,
  COST_REPORT_STATUSES,
  DURATION_SOURCE_STATUSES,
  RESIDENCY_STATES,
  RESOLVED_MODEL_SOURCES,
  RUNNER_KINDS,
  TASK_STATUSES,
  TOKEN_COVERAGE_STATUSES,
} from "../state"
import { R0_ENUM_FIELDS, validateR0Enums } from "./__fixtures__/r0-ebd01f84e-enums"
import { parseR0PersistedReasons } from "./__fixtures__/r0-ebd01f84e-reasons"

function recordWith(path: string, value: unknown): Record<string, unknown> {
  const nest = (parts: readonly string[]): unknown => {
    const [key, ...rest] = parts
    if (key === undefined) return value
    return key === "*" ? [nest(rest)] : { [key]: nest(rest) }
  }
  const [first, ...rest] = path.split(".")
  if (first === undefined) throw new Error("empty enum path")
  const record: Record<string, unknown> = { [first]: nest(rest) }
  if (first === "spawn_spec") Object.assign(record[first] ?? {}, { version: 1 })
  return record
}

describe("R0 persisted enum compatibility", () => {
  for (const [path, values] of Object.entries({
    status: TASK_STATUSES,
    residency_state: RESIDENCY_STATES,
    runner_kind: RUNNER_KINDS,
    background_mode: BACKGROUND_MODES,
    "resolved_model.source": RESOLVED_MODEL_SOURCES,
    "requested_model.source": RESOLVED_MODEL_SOURCES,
    "fallback_models.*.source": RESOLVED_MODEL_SOURCES,
    "fallback_attempts.*.source": RESOLVED_MODEL_SOURCES,
    "isolation.backend": IsolationBackendKindSchema.options,
    "spawn_spec.isolation.backend": IsolationBackendKindSchema.options,
    "run_stats.token_status": TOKEN_COVERAGE_STATUSES,
    "run_stats.cost_status": COST_REPORT_STATUSES,
    "run_stats.duration_status": DURATION_SOURCE_STATUSES,
  })) {
    test(`#given current ${path} vocabulary #when read by R0 #then every value remains readable`, () => {
      for (const value of values) expect(() => parseR0PersistedReasons(recordWith(path, value))).not.toThrow()
    })
  }
  for (const [path, values] of Object.entries(R0_ENUM_FIELDS)) {
    test(`#given ${path} #when a future value appears #then the frozen R0 rule detects it`, () => {
      for (const value of values) expect(() => parseR0PersistedReasons(recordWith(path, value))).not.toThrow()
      const future = recordWith(path, "unsupported-future-value")
      if (path === "pending_steering.*.deliver_as") {
        expect(validateR0Enums(future)).toEqual([path])
      } else expect(() => parseR0PersistedReasons(future)).toThrow(`R0 rejects ${path}`)
    })
  }
  test("#given an additive strict-close flag #when R0 validates enums #then it ignores rather than honors the obligation", () => {
    expect(() =>
      parseR0PersistedReasons({
        fallback_closing_child: { requires_confirmation: true },
      }),
    ).not.toThrow()
  })
})

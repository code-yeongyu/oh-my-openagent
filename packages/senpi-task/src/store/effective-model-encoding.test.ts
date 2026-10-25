import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { makeRecord } from "../tools/output/__fixtures__/records"
import type { TaskRecord } from "../state"
import { parseTaskRecord } from "./record-parse"
import { writeRecord } from "./record-write"

// Verbatim copy of the effective_model parsing a PRE-F12 omo build runs (the base
// `parseOptionalResolvedModel` and its helpers from packages/senpi-task/src/store/
// record-blocks-parse.ts at ca349abc7a^ - the commit right before #10097's F12 change).
// Older builds parse effective_model through exactly this logic and rethrow any parse
// error in readRecord, so a record this copy cannot load is a record a downgrade or an
// older process sharing the task store cannot load either.
const BASE_RESOLVED_MODEL_SOURCES = ["category", "explicit", "agent"] as const

function baseReadString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== "string") throw new Error(`${key} is not a string`)
  return value
}

function baseReadOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${key} is not a string`)
  return value
}

function baseIsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function baseReadResolvedModelSource(record: Record<string, unknown>): string {
  const source = baseReadString(record, "source")
  switch (source) {
    case "category":
    case "explicit":
    case "agent":
      return source
    default:
      throw new Error(`resolved_model.source must be ${BASE_RESOLVED_MODEL_SOURCES.join(" or ")}`)
  }
}

function baseReadResolvedModel(value: Record<string, unknown>): Record<string, unknown> {
  const variant = baseReadOptionalString(value, "variant")
  const legacyReasoningEffort = baseReadOptionalString(value, "reasoning_effort")
  const reasoning = baseReadOptionalString(value, "reasoning")
  return {
    provider: baseReadString(value, "provider"),
    model_id: baseReadString(value, "model_id"),
    display: baseReadString(value, "display"),
    source: baseReadResolvedModelSource(value),
    ...(variant === undefined ? {} : { variant }),
    ...(legacyReasoningEffort === undefined ? {} : { reasoning_effort: legacyReasoningEffort }),
    ...(reasoning === undefined ? {} : { reasoning }),
  }
}

function baseParseOptionalResolvedModel(
  record: Record<string, unknown>,
  key: "requested_model" | "resolved_model" | "effective_model" = "resolved_model",
): Record<string, unknown> | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (!baseIsRecord(value)) throw new Error(`${key} is not an object`)
  return baseReadResolvedModel(value)
}

// End of base parser copy.

const SPAWN_RESOLVED = {
  source: "category",
  provider: "anthropic",
  model_id: "claude-sonnet-4-5",
  display: "anthropic/claude-sonnet-4-5",
} as const

function liveSwitchRecord(effectiveSource: TaskRecord["effective_model"] extends undefined ? never : NonNullable<TaskRecord["effective_model"]>): TaskRecord {
  return {
    ...makeRecord({
      task_id: "st_00000001",
      resolved_model: SPAWN_RESOLVED,
    }),
    effective_model: effectiveSource,
  }
}

function writeAndReadRaw(record: TaskRecord): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), "effective-model-encoding-"))
  const path = join(dir, "tasks", `${record.task_id}.json`)
  try {
    writeRecord(path, record, "create", process.platform)
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("effective_model stored encoding (F12 rollback compatibility)", () => {
  test("#given a live operator set switch persisted by the new code #when an older build parses it #then the record still loads with provider and model intact", () => {
    const stored = writeAndReadRaw(liveSwitchRecord({
      provider: "anthropic",
      model_id: "claude-opus-5-5",
      display: "anthropic/claude-opus-5-5",
      reasoning: "high",
      source: "set",
      switched_by_operator: true,
    }))
    const parsed = baseParseOptionalResolvedModel(stored, "effective_model")
    expect(parsed).toMatchObject({ provider: "anthropic", model_id: "claude-opus-5-5" })
  })

  test("#given a live fallback-revert persisted by the new code #when an older build parses it #then the record still loads", () => {
    const stored = writeAndReadRaw(liveSwitchRecord({
      provider: "kimi-coding",
      model_id: "kimi-for-coding-highspeed-unlocked",
      display: "kimi-coding/kimi-for-coding-highspeed-unlocked",
      source: "fallback-revert",
    }))
    const parsed = baseParseOptionalResolvedModel(stored, "effective_model")
    expect(parsed).toMatchObject({ provider: "kimi-coding", model_id: "kimi-for-coding-highspeed-unlocked" })
  })

  test("#given a live set switch with the operator flag #when the record is written and re-parsed by the new parser #then the same EffectiveModelRecord comes back", () => {
    const live = liveSwitchRecord({
      provider: "anthropic",
      model_id: "claude-opus-5-5",
      display: "anthropic/claude-opus-5-5",
      reasoning: "high",
      source: "set",
      switched_by_operator: true,
    })
    const parsed = parseTaskRecord(writeAndReadRaw(live), "stored.json")
    expect(parsed.effective_model).toEqual(live.effective_model)
  })

  test("#given a live fallback without the operator flag #when the record is written and re-parsed by the new parser #then the same EffectiveModelRecord comes back", () => {
    const live = liveSwitchRecord({
      provider: "anthropic",
      model_id: "claude-haiku-4-5",
      display: "anthropic/claude-haiku-4-5",
      source: "fallback",
    })
    const parsed = parseTaskRecord(writeAndReadRaw(live), "stored.json")
    expect(parsed.effective_model).toEqual(live.effective_model)
  })

  test("#given an old-union spawn stamp with a service tier #when the record is written and re-parsed #then effective_model is byte-identical", () => {
    const stamped = {
      ...makeRecord({ task_id: "st_00000002", resolved_model: SPAWN_RESOLVED }),
      effective_model: {
        provider: SPAWN_RESOLVED.provider,
        model_id: SPAWN_RESOLVED.model_id,
        display: SPAWN_RESOLVED.display,
        source: "category",
        service_tier: "priority",
      },
    } as TaskRecord
    const stored = writeAndReadRaw(stamped)
    expect(stored["effective_model"]).toEqual(stamped.effective_model)
    const parsed = parseTaskRecord(stored, "stored.json")
    expect(parsed.effective_model).toEqual(stamped.effective_model)
  })

  test("#given a record written by this branch's earlier head (live kind in source, no change block) #when the new parser loads it #then the live kind and operator flag survive", () => {
    const earlierHead = {
      ...makeRecord({ task_id: "st_00000003", resolved_model: SPAWN_RESOLVED }),
      effective_model: {
        provider: "anthropic",
        model_id: "claude-opus-5-5",
        display: "anthropic/claude-opus-5-5",
        source: "set",
        switched_by_operator: true,
      },
    } as Record<string, unknown>
    const parsed = parseTaskRecord(earlierHead, "earlier-head.json")
    expect(parsed.effective_model).toEqual({
      provider: "anthropic",
      model_id: "claude-opus-5-5",
      display: "anthropic/claude-opus-5-5",
      source: "set",
      switched_by_operator: true,
    })
  })
})

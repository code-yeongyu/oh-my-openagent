import { MODEL_REFUSAL_REASONS, type ModelRefusal, type ModelRefusalReason } from "../state"
import { isRecord, readOptionalString, readString } from "./scalar-read"

/**
 * `model_refusals` is diagnostic provenance: a malformed entry or a reason a newer build added is dropped,
 * never a reason to lose the whole record.
 */
export function parseOptionalModelRefusals(record: Record<string, unknown>): readonly ModelRefusal[] | undefined {
  const value = record["model_refusals"]
  if (!Array.isArray(value)) return undefined
  const refusals = value.flatMap((entry: unknown) => {
    const refusal = parseRefusal(entry)
    return refusal === undefined ? [] : [refusal]
  })
  return refusals.length === 0 ? undefined : refusals
}

function parseRefusal(value: unknown): ModelRefusal | undefined {
  if (!isRecord(value)) return undefined
  try {
    const reason = readString(value, "reason")
    if (!isRefusalReason(reason)) return undefined
    const detail = readOptionalString(value, "detail")
    const resets = readOptionalString(value, "resets")
    return {
      model: readString(value, "model"),
      reason,
      at: readString(value, "at"),
      ...(detail === undefined ? {} : { detail }),
      ...(resets === undefined ? {} : { resets }),
    }
  } catch {
    return undefined
  }
}

function isRefusalReason(value: string): value is ModelRefusalReason {
  return (MODEL_REFUSAL_REASONS as readonly string[]).includes(value)
}

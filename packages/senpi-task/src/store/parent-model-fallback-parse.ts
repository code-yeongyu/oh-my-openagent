import { PARENT_MODEL_FALLBACK_REASONS, type ParentModelFallback, type ParentModelFallbackReason } from "../state"
import { isRecord, readOptionalString, readOptionalStringArray, readString } from "./scalar-read"

/**
 * `parent_model_fallback` is display provenance: a malformed block or a reason a newer build added is
 * dropped, never a reason to lose the whole record.
 */
export function parseOptionalParentModelFallback(record: Record<string, unknown>): ParentModelFallback | undefined {
  const value = record["parent_model_fallback"]
  if (!isRecord(value)) return undefined
  try {
    const reason = readString(value, "reason")
    if (!(PARENT_MODEL_FALLBACK_REASONS as readonly string[]).includes(reason)) return undefined
    const detail = readOptionalString(value, "detail")
    const resets = readOptionalString(value, "resets")
    const interrupted = readOptionalStringArray(value, "interrupted_tools")
    return {
      from_model: readString(value, "from_model"),
      reason: reason as ParentModelFallbackReason,
      at: readString(value, "at"),
      ...(detail === undefined ? {} : { detail }),
      ...(resets === undefined ? {} : { resets }),
      ...(interrupted === undefined || interrupted.length === 0 ? {} : { interrupted_tools: interrupted }),
    }
  } catch {
    return undefined
  }
}

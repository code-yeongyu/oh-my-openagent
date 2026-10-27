import type { ModelFallbackRecord } from "../state/model-fallback"
import { isRecord, readOptionalString, readString } from "./scalar-read"

export function parseModelFallback(value: unknown): ModelFallbackRecord | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("model fallback is not an object")
  const limit = readOptionalString(value, "limit")
  if (limit !== undefined && limit !== "model" && limit !== "account") throw new Error("invalid model fallback limit")
  const resetsAt = readOptionalString(value, "resets_at")
  return {
    from: readString(value, "from"),
    reason: readString(value, "reason"),
    ...(limit === undefined ? {} : { limit }),
    ...(resetsAt === undefined ? {} : { resets_at: resetsAt }),
  }
}

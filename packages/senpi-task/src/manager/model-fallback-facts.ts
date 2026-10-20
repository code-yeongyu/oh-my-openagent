import type { TaskRecord } from "../state"
import type { ModelFallbackRecord } from "../state/model-fallback"
import type { ManagedChildEvent } from "./child-handle"
import { usageLimitScope } from "./credential-failure"

function stringField(value: object, key: string): string | undefined {
  const field = Reflect.get(value, key)
  return typeof field === "string" && field.length > 0 ? field : undefined
}

/** Keep only the diagnostic facts the status needs, never the raw transport response. */
export function modelFailure(event: ManagedChildEvent, record: TaskRecord): ModelFallbackRecord | undefined {
  const message = event.message
  if (typeof message !== "object" || message === null || Reflect.get(message, "role") !== "assistant" ||
    Reflect.get(message, "stopReason") !== "error") return undefined
  const reason = stringField(message, "errorMessage") ?? "provider error"
  const diagnostic = Reflect.get(message, "providerDiagnostic")
  const details = typeof diagnostic === "object" && diagnostic !== null ? diagnostic : undefined
  const category = details === undefined ? undefined : stringField(details, "category")
  const limit = usageLimitScope(reason) ?? (category === "quota" || category === "rate_limit" ? "account" : undefined)
  const resetsAt = details === undefined ? undefined : stringField(details, "resetsAt")
  const provider = stringField(message, "provider")
  const model = stringField(message, "model")
  return {
    from: provider !== undefined && model !== undefined ? `${provider}/${model}` : record.effective_model?.display ?? record.model,
    reason,
    ...(limit === undefined ? {} : { limit }),
    ...(resetsAt === undefined ? {} : { resets_at: resetsAt }),
  }
}

export function runtimeFallbackNotice(record: TaskRecord, reason: string, limit?: "model" | "account",
  from = record.effective_model?.display ?? record.resolved_model?.display ?? record.model): ModelFallbackRecord {
  const failure = record.model_failure?.from === from ? record.model_failure : undefined
  return {
    from,
    reason,
    ...(failure === undefined ? {} : failure),
    ...(limit === undefined ? {} : { limit }),
  }
}

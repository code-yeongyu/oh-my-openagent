import type {
  ReflectionCompletionRecord,
  ReflectionLiveSession,
} from "./completion-contracts"
import { deliverReflectionCompletion } from "./completion-delivery"
import { ensureReflectionCompletion } from "./completion-records"

export * from "./completion-contracts"
export {
  consumePendingReflectionCompletions,
  safeNotify,
} from "./completion-delivery"
export * from "./completion-records"
export * from "./completion-renderers"

export async function recordReflectionCompletion(
  completionsDir: string,
  record: ReflectionCompletionRecord,
  live?: ReflectionLiveSession,
): Promise<ReflectionCompletionRecord> {
  const durable = await ensureReflectionCompletion(completionsDir, record)
  if (!live || durable.delivery.status === "consumed") {
    return durable
  }
  const delivered = await deliverReflectionCompletion(completionsDir, durable, live)
  await live.onCompletion?.(delivered.runId)
  return delivered
}

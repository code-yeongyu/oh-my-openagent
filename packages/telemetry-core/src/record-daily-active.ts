import { recordDailyActive as recordInjectedDailyActive, type RecordDailyActiveInput as InjectedInput } from "./injected-daily-active"
import { createDefaultPostHogTransport } from "./posthog-transport"

export type RecordDailyActiveInput = Omit<InjectedInput, "transportFactory"> & { readonly transportFactory?: InjectedInput["transportFactory"] }

export function recordDailyActive(input: RecordDailyActiveInput): Promise<void> {
  return recordInjectedDailyActive({ ...input, transportFactory: input.transportFactory ?? createDefaultPostHogTransport })
}

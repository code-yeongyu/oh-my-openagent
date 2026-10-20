import {
  createEventTelemetryClient as createInjectedEventTelemetryClient,
  type CreateEventTelemetryClientInput as InjectedInput,
  type EventTelemetryClient,
} from "./injected-events"
import { createDefaultPostHogTransport } from "./posthog-transport"

export type { EventPropertyAllowlist, EventTelemetryProperties, EventTelemetrySetTimeout, EventTelemetryClient } from "./injected-events"
export type CreateEventTelemetryClientInput = Omit<InjectedInput, "transportFactory"> & { readonly transportFactory?: InjectedInput["transportFactory"] }

export function createEventTelemetryClient(input: CreateEventTelemetryClientInput): EventTelemetryClient {
  return createInjectedEventTelemetryClient({ ...input, transportFactory: input.transportFactory ?? createDefaultPostHogTransport })
}

import { createTelemetryClient as createInjectedTelemetryClient, type CreateTelemetryClientInput } from "./injected-client"
import { createDefaultPostHogTransport } from "./posthog-transport"
import type { TelemetryClient } from "./types"

export { createDefaultPostHogTransport, type PostHogTransportOptions } from "./posthog-transport"
export { TelemetryDeliveryError } from "./telemetry-delivery-error"
export { createImmediateSender } from "./posthog-immediate-send"
export { isTelemetryClientEnabled, type TelemetryClientEnabledInput } from "./injected-client"

export function createTelemetryClient(
  input: Omit<CreateTelemetryClientInput, "transportFactory"> & {
    readonly transportFactory?: CreateTelemetryClientInput["transportFactory"]
  },
): TelemetryClient {
  return createInjectedTelemetryClient({ ...input, transportFactory: input.transportFactory ?? createDefaultPostHogTransport })
}

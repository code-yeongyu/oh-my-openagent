import { createTelemetryClient as createInjectedTelemetryClient, type CreateTelemetryClientInput } from "./injected-client"
import { createDefaultPostHogTransport } from "./posthog-transport"
import type { TelemetryClient } from "./types"

export {
  TELEMETRY_CONSENT_FILE_ENV,
  TELEMETRY_CONSENT_FILE_MODE,
  TELEMETRY_CONSENT_STATE_FILE,
  readTelemetryConsentEnabled,
  readTelemetryConsentState,
  resolveTelemetryConsentStatePath,
  writeTelemetryConsentState,
} from "./consent-state"
export type {
  ResolveTelemetryConsentStatePathOptions,
  TelemetryConsentState,
} from "./consent-state"
export { createDefaultPostHogTransport } from "./posthog-transport"
export { isTelemetryClientEnabled, type TelemetryClientEnabledInput } from "./injected-client"

export function createTelemetryClient(
  input: Omit<CreateTelemetryClientInput, "transportFactory"> & {
    readonly transportFactory?: CreateTelemetryClientInput["transportFactory"]
  },
): TelemetryClient {
  return createInjectedTelemetryClient({ ...input, transportFactory: input.transportFactory ?? createDefaultPostHogTransport })
}

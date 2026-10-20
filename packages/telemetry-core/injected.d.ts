import type {
  CreateEventTelemetryClientInput as DefaultEventInput,
  EventTelemetryClient,
  RecordDailyActiveInput as DefaultDailyInput,
  TelemetryClient,
  TelemetryTransportFactory,
} from "./index"

export type * from "./index"
export {
  DEFAULT_POSTHOG_HOST,
  DEFAULT_POSTHOG_API_KEY,
  UNCONFIGURED_POSTHOG_API_KEY,
  isTelemetryClientEnabled,
  createConsentGatedFetch,
  shouldDisableTelemetry,
  getTelemetryApiKey,
  isConfiguredTelemetryApiKey,
  createUuidV7Generator,
  createEventId,
  hasTelemetryApiKey,
  getTelemetryHost,
  getDefaultTelemetryOsProvider,
  getTelemetryDistinctId,
  resolveTelemetryStateDir,
  getTelemetryActivityStateFilePath,
  getDailyActiveCaptureState,
  getTelemetryDiagnosticsFilePath,
  writeTelemetryDiagnostic,
  cleanupTelemetryDiagnostics,
} from "./index"

type WithTransport<T> = Omit<T, "transportFactory"> & { readonly transportFactory: TelemetryTransportFactory }

export type CreateEventTelemetryClientInput = WithTransport<DefaultEventInput>
export type RecordDailyActiveInput = WithTransport<DefaultDailyInput>
export type CreateTelemetryClientInput = WithTransport<Parameters<typeof import("./index").createTelemetryClient>[0]>

export declare function createTelemetryClient(
  input: CreateTelemetryClientInput,
): TelemetryClient
export declare function createEventTelemetryClient(
  input: CreateEventTelemetryClientInput,
): EventTelemetryClient
export declare function recordDailyActive(input: RecordDailyActiveInput): Promise<void>

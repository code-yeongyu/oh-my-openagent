import { getDailyActiveCaptureState } from "./activity-state"
import { createTelemetryClient, isTelemetryClientEnabled } from "./posthog-client"
import { getTelemetryDistinctId } from "./machine-id"
import type {
  TelemetryDiagnosticInput,
  TelemetryEnv,
  TelemetryOsProvider,
  TelemetryProductConfig,
  TelemetryTransportFactory,
} from "./types"

export type RecordDailyActiveInput = {
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
  readonly env?: TelemetryEnv
  readonly now?: Date
  readonly osProvider?: TelemetryOsProvider
  readonly product: TelemetryProductConfig
  readonly reason: string
  readonly source: string
  readonly stateDir: string
  readonly transportFactory?: TelemetryTransportFactory
}

export async function recordDailyActive(input: RecordDailyActiveInput): Promise<void> {
  if (!isTelemetryClientEnabled(input)) {
    return
  }

  const osProvider = input.osProvider
  const client = createTelemetryClient({
    diagnostics: input.diagnostics,
    env: input.env,
    osProvider,
    product: input.product,
    source: input.source,
    transportFactory: input.transportFactory,
  })

  if (!client.enabled) {
    return
  }

  const activityState = getDailyActiveCaptureState({
    diagnostics: input.diagnostics,
    stateDir: input.stateDir,
    now: input.now,
  })

  if (!activityState.captureDaily) {
    await client.shutdown()
    return
  }

  client.trackActive({
    dayUTC: activityState.dayUTC,
    distinctId: getTelemetryDistinctId(input.product.machineIdPrefix, osProvider),
    reason: input.reason,
  })
  await client.flush()
  await client.shutdown()
}

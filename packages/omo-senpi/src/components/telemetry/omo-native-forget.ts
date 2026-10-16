import {
  getDefaultTelemetryOsProvider,
  getTelemetryDistinctId,
  requestTelemetryForget,
  type TelemetryEnv,
  type TelemetryForgetResult,
  type TelemetryOsProvider,
} from "@oh-my-opencode/telemetry-core"

import { createOmoNativeProductConfig, readOmoNativeInstallId } from "./product-identity"

export type ForgetOmoNativeInstallInput = {
  readonly env?: TelemetryEnv
  readonly stateDir?: string
  readonly osProvider?: TelemetryOsProvider
  readonly fetchFn?: typeof fetch
}

export type OmoNativeForgetResult = TelemetryForgetResult | { readonly status: "skipped"; readonly reason: "no_install_id" }

/**
 * The client half of `omo telemetry forget`: sends this install's id and, when it can be derived,
 * the PostHog distinct id the omo-native events were sent under. An install that never created an
 * install id has nothing to forget, so nothing is sent and no id is created.
 */
export async function forgetOmoNativeInstall(input: ForgetOmoNativeInstallInput = {}): Promise<OmoNativeForgetResult> {
  const env = input.env ?? process.env
  const installId = readOmoNativeInstallId({ env, stateDir: input.stateDir })
  if (installId === undefined) return { status: "skipped", reason: "no_install_id" }

  return requestTelemetryForget({
    env,
    fetchFn: input.fetchFn,
    installId,
    legacyDistinctId: legacyPostHogDistinctId(input.osProvider ?? getDefaultTelemetryOsProvider()),
  })
}

function legacyPostHogDistinctId(osProvider: TelemetryOsProvider): string | undefined {
  try {
    return getTelemetryDistinctId(createOmoNativeProductConfig().machineIdPrefix, osProvider)
  } catch {
    // No readable hostname means no PostHog distinct id can be re-derived; forget the install id alone.
    return undefined
  }
}

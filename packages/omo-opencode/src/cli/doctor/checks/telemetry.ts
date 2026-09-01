import { existsSync, readFileSync } from "node:fs"
import {
  getTelemetryActivityStateFilePath,
  getTelemetryHost,
  resolveTelemetryStateDir,
} from "@oh-my-opencode/telemetry-core"
import { validatePluginConfig } from "../../../config/validate"
import { createOpencodeTelemetryProductConfig } from "../../../shared/telemetry-product-identity"
import { shouldDisablePostHog } from "../../../shared/posthog"
import { CHECK_IDS, CHECK_NAMES } from "../framework/constants"
import type { CheckResult } from "../framework/types"

type TelemetryState = {
  readonly lastActiveDayUTC?: string
}

function isTelemetryState(value: unknown): value is TelemetryState {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function readLastActiveDay(stateFilePath: string): string {
  if (!existsSync(stateFilePath)) {
    return "never"
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(stateFilePath, "utf-8"))
  } catch (error) {
    if (error instanceof Error) {
      return "unreadable"
    }
    throw error
  }
  if (!isTelemetryState(parsed)) {
    return "unreadable"
  }

  return parsed.lastActiveDayUTC ?? "never"
}

function describeTelemetryStatus(configEnabled: boolean | undefined): string {
  return shouldDisablePostHog(process.env, configEnabled) ? "disabled" : "enabled"
}

export async function checkTelemetry(): Promise<CheckResult> {
  const product = createOpencodeTelemetryProductConfig()
  const validation = validatePluginConfig(process.cwd())
  const status = describeTelemetryStatus(validation.config.telemetry)
  const stateFilePath = getTelemetryActivityStateFilePath(resolveTelemetryStateDir(product))
  const lastActiveDay = readLastActiveDay(stateFilePath)

  return {
    name: CHECK_NAMES[CHECK_IDS.TELEMETRY],
    status: "pass",
    message: `Telemetry: ${status}`,
    details: [
      `PostHog host: ${getTelemetryHost(process.env, product.defaultHost)}`,
      `Last daily active date: ${lastActiveDay}`,
      `State file: ${stateFilePath}`,
    ],
    issues: [],
  }
}

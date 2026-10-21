import {
  getTelemetryApiKey,
  getTelemetryHost,
  hasTelemetryApiKey,
  readTelemetryConsentEnabled,
  resolveTelemetryConsentStatePath,
  shouldDisableTelemetry,
} from "@oh-my-opencode/telemetry-core"

import { createCodexTelemetryProductConfig } from "./product-identity"

export function shouldDisablePostHog(): boolean {
  return shouldDisableTelemetry({
    consentEnabled: readTelemetryConsentEnabled(resolveTelemetryConsentStatePath()),
    productEnvPrefix: createCodexTelemetryProductConfig().productEnvPrefix,
  })
}

export function getPostHogApiKey(): string {
  return getTelemetryApiKey(process.env, createCodexTelemetryProductConfig().defaultApiKey)
}

export function hasPostHogApiKey(): boolean {
  return hasTelemetryApiKey(process.env, createCodexTelemetryProductConfig().defaultApiKey)
}

export function getPostHogHost(): string {
  return getTelemetryHost(process.env, createCodexTelemetryProductConfig().defaultHost)
}
